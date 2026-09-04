import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { callRpc } from "@/lib/rpc";
import { uploadEvidenceFile, evidenceError } from "@/features/attachments/attachments.api";
import {
  attendanceError,
  isOpenStatusRow,
  useClockStaffIn,
  useClockStaffOut,
  useEventAttendanceStatus,
  type AttendanceMethod,
  type AttendanceStatusRow,
} from "../staff.api";
import {
  resolveFaceProvider,
  type FaceCandidate,
  type FaceRecognitionProvider,
} from "./provider";
import {
  clearFaceTemplates,
  loadFaceTemplates,
  saveFaceTemplates,
} from "./localTemplates";

const db = supabase;

// ---------------------------------------------------------------------------
// Enrollment state (server contract)
// ---------------------------------------------------------------------------

export interface FaceEnrollmentState {
  status: "ACTIVE" | "NONE" | "REVOKED";
  provider_code: string | null;
  model_version: string | null;
  capture_count: number | null;
  updated_at: string | null;
}

export function faceEnrollmentQueryKey(orgId: string | null, staffMemberId: string | null) {
  return ["staff-face-enrollment", orgId, staffMemberId] as const;
}

export function useStaffFaceEnrollment(orgId: string | null, staffMemberId: string | null) {
  return useQuery({
    queryKey: faceEnrollmentQueryKey(orgId, staffMemberId),
    enabled: !!orgId && !!staffMemberId,
    queryFn: async () => {
      const { data, error } = await db.rpc("get_staff_face_enrollment", {
        p_org_id: orgId!,
        p_staff_member_id: staffMemberId!,
      });
      if (error) throw error;
      return (data ?? { status: "NONE" }) as unknown as FaceEnrollmentState;
    },
  });
}

export function useEnrollStaffFace(orgId: string | null) {
  const q = useQueryClient();
  return useMutation({
    mutationFn: (v: {
      staffMemberId: string;
      providerCode: string;
      modelVersion: string;
      templateReference: string;
      captureCount: number;
    }) =>
      callRpc<Record<string, unknown>>("enroll_staff_face", {
        p_org_id: orgId,
        p_staff_member_id: v.staffMemberId,
        p_provider_code: v.providerCode,
        p_model_version: v.modelVersion,
        p_template_reference: v.templateReference,
        p_capture_count: v.captureCount,
        p_idempotency_key: crypto.randomUUID(),
      }),
    onSuccess: (_d, v) => {
      void q.invalidateQueries({ queryKey: faceEnrollmentQueryKey(orgId, v.staffMemberId) });
      void q.invalidateQueries({ queryKey: ["event-attendance-candidates", orgId] });
    },
  });
}

export function useRevokeStaffFace(orgId: string | null) {
  const q = useQueryClient();
  return useMutation({
    mutationFn: (v: { staffMemberId: string; reason: string }) =>
      callRpc<Record<string, unknown>>("revoke_staff_face", {
        p_org_id: orgId,
        p_staff_member_id: v.staffMemberId,
        p_reason: v.reason,
        p_idempotency_key: crypto.randomUUID(),
      }),
    onSuccess: (_d, v) => {
      clearFaceTemplates(orgId ?? "", v.staffMemberId);
      void q.invalidateQueries({ queryKey: faceEnrollmentQueryKey(orgId, v.staffMemberId) });
      void q.invalidateQueries({ queryKey: ["event-attendance-candidates", orgId] });
    },
  });
}

// ---------------------------------------------------------------------------
// Candidate scoping — organization → event → assigned ACTIVE staff (+ flag)
// ---------------------------------------------------------------------------

export interface AttendanceCandidate {
  assignment_id: string;
  staff_member_id: string;
  staff_name: string;
  assignment_role: string;
  /** Server enrollment flag (ACTIVE enrollment row for this staff member). */
  enrollment_active: boolean;
  /** True while this staff currently holds an open punch (inside). */
  is_open: boolean;
  open_check_in: string | null;
}

export function eventCandidatesQueryKey(orgId: string | null, eventId: string) {
  return ["event-attendance-candidates", orgId, eventId] as const;
}

/**
 * The candidate universe for BOTH assisted matching and the manual roster.
 * The server scopes it to the event's ACTIVE assignments — face matching
 * never searches the complete staff database, and the manual fallback lists
 * exactly these people.
 */
export function useEventAttendanceCandidates(orgId: string | null, eventId: string) {
  return useQuery({
    queryKey: eventCandidatesQueryKey(orgId, eventId),
    enabled: !!orgId && !!eventId,
    queryFn: async () => {
      const { data, error } = await db.rpc("event_attendance_candidates", {
        p_org_id: orgId!,
        p_event_id: eventId!,
      });
      if (error) throw error;
      return (data ?? []) as AttendanceCandidate[];
    },
  });
}

// ---------------------------------------------------------------------------
// Match attempt ledger (the manager-confirmation handshake)
// ---------------------------------------------------------------------------

export type MatchAttemptOutcome = "MATCH" | "NO_MATCH";

/**
 * Records what the provider actually returned for a frame so a confirmation
 * can reference it. Recording an attempt NEVER creates attendance — the punch
 * command re-validates (organization, event, candidate, unconsumed) at WRITE
 * time. NO_MATCH attempts are recorded too: they are the audit evidence that
 * recognition was attempted and honestly failed, not skipped.
 */
export function useRecordFaceMatchAttempt(orgId: string | null, eventId: string) {
  return useMutation({
    mutationFn: (v: {
      outcome: MatchAttemptOutcome;
      staffMemberId: string | null;
      providerCode: string;
      confidence: number | null;
    }) =>
      callRpc<{ id: string }>("record_face_match_attempt", {
        p_org_id: orgId,
        p_event_id: eventId,
        p_outcome: v.outcome,
        p_staff_member_id: v.staffMemberId,
        p_provider_code: v.providerCode,
        p_confidence: v.confidence,
        p_idempotency_key: crypto.randomUUID(),
      }),
  });
}

// ---------------------------------------------------------------------------
// Provider state (single hook for every assisted surface)
// ---------------------------------------------------------------------------

export type FaceProviderState =
  | { status: "loading" }
  | { status: "available"; provider: FaceRecognitionProvider }
  | { status: "unavailable" };

/**
 * Resolve the provider once per mount. `unavailable` is an OPERATIONAL state,
 * not an error: every assisted surface keeps working through the manual
 * first-class path while showing the honest provider state.
 */
export function useFaceProvider(): FaceProviderState {
  const [state, setState] = useState<FaceProviderState>({ status: "loading" });
  useEffect(() => {
    let active = true;
    void resolveFaceProvider().then((provider) => {
      if (!active) return;
      setState(provider ? { status: "available", provider } : { status: "unavailable" });
    });
    return () => {
      active = false;
    };
  }, []);
  return state;
}

// ---------------------------------------------------------------------------
// Enrollment flow (guided multi-frame capture)
// ---------------------------------------------------------------------------

export const ENROLLMENT_CAPTURE_COUNT = 4;

export type EnrollmentPhase =
  | "idle"
  | "capturing"
  | "no-face"
  | "provider-unavailable"
  | "done"
  | "error";

/**
 * Guided enrollment: capture ENROLLMENT_CAPTURE_COUNT frames; each frame is
 * run through the provider's extractor and only the resulting descriptors
 * stay on THIS device (raw training frames are never stored — see
 * localTemplates). The server record carries provider code + model version +
 * capture count + opaque device token; nothing biometric is uploaded.
 */
export function useFaceEnrollmentFlow(orgId: string | null, staffMemberId: string) {
  const providerState = useFaceProvider();
  const enroll = useEnrollStaffFace(orgId);
  const [captured, setCaptured] = useState(0);
  const [phase, setPhase] = useState<EnrollmentPhase>("idle");
  const [error, setError] = useState("");

  const bufferRef = useRef<{ code: string; version: string; list: number[][] }>({
    code: "",
    version: "",
    list: [],
  });

  function begin() {
    setError("");
    if (providerState.status !== "available") {
      setPhase("provider-unavailable");
      return;
    }
    bufferRef.current = {
      code: providerState.provider.code,
      version: providerState.provider.modelVersion,
      list: [],
    };
    setCaptured(0);
    setPhase("capturing");
  }

  async function submitFrame(file: File): Promise<"more" | "done" | "retry"> {
    if (providerState.status !== "available") {
      setPhase("provider-unavailable");
      return "retry";
    }
    try {
      const descriptor = await providerState.provider.extractDescriptor(file);
      if (!descriptor) {
        setPhase("no-face");
        return "retry";
      }
      bufferRef.current.list.push([...descriptor]);
      const next = bufferRef.current.list.length;
      setCaptured(next);
      if (next < ENROLLMENT_CAPTURE_COUNT) {
        setPhase("capturing");
        return "more";
      }
      const token = crypto.randomUUID();
      saveFaceTemplates(orgId ?? "", staffMemberId, {
        providerCode: bufferRef.current.code,
        modelVersion: bufferRef.current.version,
        token,
        descriptors: bufferRef.current.list,
      });
      await enroll.mutateAsync({
        staffMemberId,
        providerCode: bufferRef.current.code,
        modelVersion: bufferRef.current.version,
        templateReference: token,
        captureCount: bufferRef.current.list.length,
      });
      setPhase("done");
      return "done";
    } catch (cause) {
      setError(attendanceError(cause) || String(cause));
      setPhase("error");
      return "retry";
    }
  }

  function cancel() {
    setPhase("idle");
    setCaptured(0);
    bufferRef.current.list = [];
    setError("");
  }

  return {
    providerState,
    phase,
    captured,
    total: ENROLLMENT_CAPTURE_COUNT,
    error,
    begin,
    submitFrame,
    cancel,
    busy: enroll.isPending,
  };
}

// ---------------------------------------------------------------------------
// Assisted attendance flow (candidate → manager confirmation → punch)
// ---------------------------------------------------------------------------

export type FaceAction = "CHECK_IN" | "CHECK_OUT";

export type MatchPhase =
  | "idle"
  /** provider ran on a frame and NO candidate crossed its policy */
  | "unrecognized"
  /** provider returned a candidate — the manager must confirm */
  | "candidate"
  /** no deployable engine — manual roster is the honest path */
  | "provider-unavailable"
  | "error";

export interface PendingCandidate {
  staffMemberId: string;
  staffName: string;
  assignmentId: string;
  /** Human-readable confidence relayed from the provider; never synthesized. */
  confidenceLabel: string | null;
  attemptId: string | null;
  evidence: UploadedEvidenceRef;
}

export interface UploadedEvidenceRef {
  storagePath: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

/**
 * The assisted attendance flow for one event surface, check-in or check-out.
 *
 * Non-negotiables enforced here AND on the server:
 *  1. a camera capture NEVER mutates attendance by itself — capture() only
 *     produces a CANDIDATE for the manager to confirm;
 *  2. a MATCH is recorded as an attempt and the punch confirmation carries the
 *     attempt id, which the server re-validates at WRITE time (organization,
 *     event, candidate identity, unconsumed);
 *  3. every context change (organization, event, roster revision, action
 *     switch, close) discards the pending candidate and captured frame —
 *     a stale frame can never authorize a punch (§61);
 *  4. manual selection from the assigned roster is a FIRST-CLASS path with
 *     the same evidence capture and the same confirmation requirement —
 *     recognition failure must never stop event operations.
 */
export function useFaceAttendanceFlow(input: {
  orgId: string | null;
  eventId: string;
  action: FaceAction;
  candidates: AttendanceCandidate[];
  rosterRows: AttendanceStatusRow[];
}) {
  const { orgId, eventId, action, candidates, rosterRows } = input;
  const providerState = useFaceProvider();
  const recordAttempt = useRecordFaceMatchAttempt(orgId, eventId);
  const clockIn = useClockStaffIn(orgId, eventId);
  const clockOut = useClockStaffOut(orgId, eventId);
  const [phase, setPhase] = useState<MatchPhase>("idle");
  const [candidate, setCandidate] = useState<PendingCandidate | null>(null);
  const [manualStaffId, setManualStaffId] = useState("");
  const [manualEvidence, setManualEvidence] = useState<UploadedEvidenceRef | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // (§60/61) The whole matching context is keyed by org + event + action +
  // roster signature. Any shift under the camera resets pending state before
  // a confirmation could be attempted against stale identifiers.
  const rosterSignature = useMemo(
    () =>
      candidates
        .map(
          (c) =>
            `${c.staff_member_id}:${c.enrollment_active ? 1 : 0}:${c.is_open ? 1 : 0}`,
        )
        .join("|"),
    [candidates],
  );
  const contextKey = `${orgId}|${eventId}|${action}|${rosterSignature}`;
  const contextRef = useRef(contextKey);

  function reset() {
    setPhase("idle");
    setCandidate(null);
    setManualStaffId("");
    setManualEvidence(null);
    setError("");
  }

  useEffect(() => {
    if (contextRef.current === contextKey) return;
    contextRef.current = contextKey;
    reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextKey]);

  /**
   * Staff the manager may act on for THIS action right now: check-in targets
   * assigned staff who are NOT already inside; check-out targets the open
   * punches. This list is both the manual roster and the provider universe.
   */
  const actionable = useMemo(() => {
    const openIds = new Set(rosterRows.filter(isOpenStatusRow).map((r) => r.staff_member_id));
    return candidates.filter((c) =>
      action === "CHECK_OUT" ? openIds.has(c.staff_member_id) : !openIds.has(c.staff_member_id),
    );
  }, [action, candidates, rosterRows]);

  /**
   * Run one captured frame through the provider. Never touches attendance
   * records — it can only end in: candidate presented, or unrecognized
   * (after which the manual path remains available).
   */
  async function capture(file: File): Promise<void> {
    setError("");
    if (providerState.status !== "available") {
      setPhase("provider-unavailable");
      return;
    }
    setBusy(true);
    try {
      const provider = providerState.provider;
      const universe: FaceCandidate[] = [];
      for (const c of actionable) {
        if (!c.enrollment_active) continue;
        const stored = loadFaceTemplates(orgId ?? "", c.staff_member_id, provider.code, provider.modelVersion);
        if (stored) universe.push({ staffMemberId: c.staff_member_id, descriptors: stored.descriptors });
      }
      if (universe.length === 0) {
        // No enrolled candidate on this device: nothing to compare against.
        // This is the honest "not recognized" state — never a fake score.
        setPhase("unrecognized");
        return;
      }
      const evidence = await uploadEvidence(orgId, action, file);
      const descriptor = await provider.extractDescriptor(file);
      if (!descriptor) {
        setPhase("unrecognized");
        return;
      }
      const result = await provider.match(descriptor, universe);
      if (result.outcome === "NO_MATCH") {
        // Keep the frame for a later manual confirmation of the SAME capture;
        // the attempt is recorded so the failure is auditable.
        await recordAttempt
          .mutateAsync({
            outcome: "NO_MATCH",
            staffMemberId: null,
            providerCode: provider.code,
            confidence: null,
          })
          .catch(() => undefined);
        setCandidate(null);
        setPhase("unrecognized");
        return;
      }
      const matched = actionable.find((c) => c.staff_member_id === result.staffMemberId);
      if (!matched) {
        // Defensive: a provider that somehow surfaces an out-of-scope id is
        // treated as no-match, never promoted to a candidate.
        setPhase("unrecognized");
        return;
      }
      const confidence = Number.isFinite(result.confidence) ? clampConfidence(result.confidence) : null;
      const attempt = await recordAttempt.mutateAsync({
        outcome: "MATCH",
        staffMemberId: matched.staff_member_id,
        providerCode: provider.code,
        confidence,
      });
      setCandidate({
        staffMemberId: matched.staff_member_id,
        staffName: matched.staff_name,
        assignmentId: matched.assignment_id,
        confidenceLabel:
          confidence !== null ? `تشابه ${Math.round(confidence * 100)}٪` : null,
        attemptId: attempt?.id ?? null,
        evidence,
      });
      setPhase("candidate");
    } catch (cause) {
      setError(attendanceError(cause) || evidenceError(cause) || String(cause));
      setPhase("error");
    } finally {
      setBusy(false);
    }
  }

  /** “ليس هو” — reject the presented candidate; manual roster stays open. */
  function rejectCandidate() {
    setCandidate(null);
    setPhase("unrecognized");
  }

  /** Pick a roster row for the manual path (evidence capture follows). */
  function selectManual(staffMemberId: string) {
    setManualStaffId(staffMemberId);
    setManualEvidence(null);
  }

  /** Upload the manual path's evidence frame (optional camera per policy). */
  async function attachManualEvidence(file: File) {
    setError("");
    try {
      setManualEvidence(await uploadEvidence(orgId, action, file));
    } catch (cause) {
      setError(evidenceError(cause) || String(cause));
    }
  }

  /**
   * Final confirmation — the ONLY place an attendance mutation is issued,
   * whether the path was assisted or manual. The assisted path carries the
   * attempt id so the server can re-validate the candidate identity.
   */
  async function confirm(): Promise<boolean> {
    setError("");
    const method: AttendanceMethod = candidate ? "FACE_ASSISTED" : "MANUAL";
    const evidence = candidate?.evidence ?? manualEvidence;
    if (!evidence) {
      setError("صورة الحضور مطلوبة قبل التأكيد");
      return false;
    }
    const staffId = candidate?.staffMemberId ?? manualStaffId;
    const rosterRow = actionable.find((c) => c.staff_member_id === staffId);
    if (!staffId || !rosterRow) {
      setError("اختر مضيفاً مسنداً لهذه المناسبة");
      return false;
    }
    setBusy(true);
    try {
      if (action === "CHECK_IN") {
        await clockIn.mutateAsync({
          staffMemberId: staffId,
          assignmentId: candidate?.assignmentId ?? rosterRow.assignment_id,
          evidencePath: evidence.storagePath,
          evidenceFileName: evidence.fileName,
          evidenceMimeType: evidence.mimeType,
          evidenceSizeBytes: evidence.sizeBytes,
          attendanceMethod: method,
          matchAttemptId: candidate?.attemptId ?? null,
        });
      } else {
        await clockOut.mutateAsync({
          staffMemberId: staffId,
          evidencePath: evidence.storagePath,
          evidenceFileName: evidence.fileName,
          evidenceMimeType: evidence.mimeType,
          evidenceSizeBytes: evidence.sizeBytes,
          attendanceMethod: method,
          matchAttemptId: candidate?.attemptId ?? null,
        });
      }
      reset();
      return true;
    } catch (cause) {
      setError(attendanceError(cause) || String(cause));
      return false;
    } finally {
      setBusy(false);
    }
  }

  return {
    providerState,
    phase,
    candidate,
    actionable,
    error,
    busy,
    manualStaffId,
    manualEvidenceReady: manualEvidence !== null,
    selectManual,
    attachManualEvidence,
    capture,
    rejectCandidate,
    confirm,
    reset,
  };
}

function clampConfidence(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Upload the confirmation frame as attendance evidence (private bucket). */
async function uploadEvidence(
  orgId: string | null,
  action: FaceAction,
  file: File,
): Promise<UploadedEvidenceRef> {
  if (!orgId) throw new Error("لا توجد منظمة محددة");
  const kind = action === "CHECK_IN" ? "ATTENDANCE_CHECKIN" : "ATTENDANCE_CHECKOUT";
  const uploaded = await uploadEvidenceFile(orgId, kind, "staff_attendance", file);
  return {
    storagePath: uploaded.storagePath,
    fileName: uploaded.fileName,
    mimeType: uploaded.mimeType,
    sizeBytes: uploaded.sizeBytes,
  };
}

/** Re-export so surfaces consume ONE attendance data entry point. */
export { useEventAttendanceStatus };
export type { AttendanceStatusRow };
