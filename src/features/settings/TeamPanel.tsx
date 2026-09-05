import { useState, type FormEvent } from "react";
import { Check, Copy, ShieldCheck, Trash2, UserPlus } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { LoadingState } from "@/components/ui/LoadingState";
import { Select } from "@/components/ui/Select";
import { Spinner } from "@/components/ui/Spinner";
import { useAuth } from "@/app/authContext";
import type { AppRole } from "@/lib/dbTypes";
import {
  APP_ROLE_LABELS_AR,
  CAPABILITIES,
  CAPABILITY_LABELS_AR,
  INVITABLE_ROLES,
} from "@/lib/capabilities";
import {
  useClearMemberPermission,
  useCreateOrgInvitation,
  useMemberCapabilities,
  useOrgInvitations,
  useOrgMembers,
  useRevokeOrgInvitation,
  useSetMemberPermission,
  type OrgMember,
} from "./team.api";

/**
 * Team & delegated permissions (Pillar A, migration 0079).
 *
 * OWNER-only surface (user.manage is OWNER-only server-side): the owner sees
 * every member with their effective capabilities and grants/denies business
 * capabilities per member. The database enforces everything — this panel is
 * configuration UX, never an authorization boundary. Owner members are
 * immutable (protect_owner_membership) and rendered read-only.
 */
export function TeamPanel() {
  const { currentOrganization, currentRole } = useAuth();
  const orgId = currentOrganization?.id ?? null;

  if (orgId === null || currentRole !== "OWNER") return null;

  return (
    <Card className="p-5">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-5 w-5 text-brand-700" />
        <h2 className="font-black">الفريق والصلاحيات</h2>
      </div>
      <p className="mt-1 text-sm leading-6 text-slate-500">
        أضف مساعدين موثوقين بدعوات بريدية، واضبط لكل واحد منهم الصلاحيات
        التشغيلية التي يملكها — تبقى كل الصلاحيات النهائية ملكك، وتُطبّق على
        مستوى قاعدة البيانات.
      </p>

      <div className="mt-5 space-y-6">
        <MembersSection orgId={orgId} />
        <InvitationsSection orgId={orgId} />
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Members + per-member capability grid
// ---------------------------------------------------------------------------

function MembersSection({ orgId }: { orgId: string }) {
  const members = useOrgMembers(orgId);

  if (members.isLoading) {
    return <LoadingState label="جارٍ تحميل الأعضاء…" />;
  }

  if (members.isError) {
    return (
      <ErrorState
        title="تعذّر تحميل الأعضاء"
        message="حدث خطأ أثناء تحميل أعضاء الفريق. أعد المحاولة."
        onRetry={() => void members.refetch()}
      />
    );
  }

  const rows = members.data ?? [];
  if (rows.length === 0) {
    return (
      <EmptyState
        title="لا يوجد أعضاء"
        description="أضف مساعدينك من قسم الدعوات أدناه."
      />
    );
  }

  return (
    <ul className="space-y-3">
      {rows.map((m) => (
        <MemberRow key={m.userId} orgId={orgId} member={m} />
      ))}
    </ul>
  );
}

function MemberRow({ orgId, member }: { orgId: string; member: OrgMember }) {
  const isOwner = member.role === "OWNER";
  const [expanded, setExpanded] = useState(false);
  const caps = useMemberCapabilities(orgId, member.userId, expanded && !isOwner);

  return (
    <li className="rounded-xl border border-slate-200">
      <div className="flex flex-wrap items-center justify-between gap-2 p-3">
        <div className="flex items-center gap-2">
          <p className="font-bold">
            {member.fullName || "عضو"}
          </p>
          <Badge tone={isOwner ? "brand" : "neutral"}>
            {APP_ROLE_LABELS_AR[member.role]}
          </Badge>
        </div>
        {!isOwner && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? "إخفاء الصلاحيات" : "الصلاحيات"}
          </Button>
        )}
      </div>
      {isOwner && (
        <p className="border-t border-slate-100 px-3 pb-3 text-xs text-slate-400">
          صلاحيات المالك كاملة وثابتة ولا يمكن تعديلها.
        </p>
      )}
      {expanded && !isOwner && <CapabilityGrid orgId={orgId} member={member} caps={caps} />}
    </li>
  );
}

function CapabilityGrid({
  orgId,
  member,
  caps,
}: {
  orgId: string;
  member: OrgMember;
  caps: ReturnType<typeof useMemberCapabilities>;
}) {
  const setPerm = useSetMemberPermission(orgId);
  const clearPerm = useClearMemberPermission(orgId);

  if (caps.isLoading) {
    return (
      <div className="flex justify-center border-t border-slate-100 py-6">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }
  if (caps.isError) {
    return (
      <p className="border-t border-slate-100 px-3 py-4 text-sm font-bold text-red-700">
        تعذّر تحميل صلاحيات العضو.
      </p>
    );
  }

  const byCap = new Map((caps.data ?? []).map((r) => [r.capability, r]));

  async function toggle(capability: string, currentlyAllowed: boolean) {
    try {
      if (currentlyAllowed) {
        await setPerm.mutateAsync({
          userId: member.userId,
          capability,
          allowed: false,
        });
      } else {
        await setPerm.mutateAsync({
          userId: member.userId,
          capability,
          allowed: true,
        });
      }
    } catch (cause) {
      // The server is authoritative; surface the refusal verbatim.
      window.alert(
        cause instanceof Error ? cause.message : "تعذّر حفظ الصلاحية",
      );
    }
  }

  return (
    <div className="grid grid-cols-1 gap-x-6 gap-y-2 border-t border-slate-100 p-3 sm:grid-cols-2">
      {CAPABILITIES.map((cap) => {
        const row = byCap.get(cap);
        const allowed = row?.allowed ?? false;
        const overridden = row?.source === "OVERRIDE";
        return (
          <label
            key={cap}
            className="flex cursor-pointer items-center justify-between gap-2 text-sm"
          >
            <span className="flex items-center gap-2">
              <input
                type="checkbox"
                className="h-4 w-4 accent-brand-700"
                checked={allowed}
                disabled={setPerm.isPending}
                onChange={() => void toggle(cap, allowed)}
              />
              {CAPABILITY_LABELS_AR[cap]}
              {overridden && (
                <button
                  type="button"
                  className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-500 hover:bg-slate-200"
                  title="إلغاء التعديل والعودة لصلاحية الدور الافتراضية"
                  onClick={(e) => {
                    e.preventDefault();
                    void clearPerm
                      .mutateAsync({ userId: member.userId, capability: cap })
                      .catch((cause: unknown) =>
                        window.alert(
                          cause instanceof Error
                            ? cause.message
                            : "تعذّر إلغاء التعديل",
                        ),
                      );
                  }}
                >
                  مخصّص
                </button>
              )}
            </span>
            <span
              className={
                allowed ? "text-[11px] font-bold text-emerald-600" : "text-[11px] font-bold text-slate-400"
              }
            >
              {allowed ? "مسموح" : "مرفوض"}
            </span>
          </label>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Invitations (single-use codes, claimed out-of-band)
// ---------------------------------------------------------------------------

function InvitationsSection({ orgId }: { orgId: string }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<AppRole>("SUPERVISOR");
  const [formError, setFormError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ email: string; code: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const invitations = useOrgInvitations(orgId);
  const createInvitation = useCreateOrgInvitation(orgId);
  const revokeInvitation = useRevokeOrgInvitation(orgId);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(null);
    setCreated(null);
    try {
      const data = await createInvitation.mutateAsync({ email, role });
      setCreated({ email: email.trim(), code: data.code });
      setEmail("");
    } catch (cause) {
      setFormError(
        cause instanceof Error ? cause.message : "تعذّر إنشاء الدعوة",
      );
    }
  }

  function copyCode(code: string) {
    void navigator.clipboard?.writeText(code).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  }

  const pending = invitations.data ?? [];

  return (
    <div className="rounded-xl border border-slate-200 p-4">
      <div className="flex items-center gap-2">
        <UserPlus className="h-4 w-4 text-brand-700" />
        <h3 className="font-black">دعوة مساعدين</h3>
      </div>
      <p className="mt-1 text-xs leading-5 text-slate-500">
        أدخل بريد المساعد ودوره، ثم شارك معه رمز الدعوة. يُنشئ المساعد حسابه
        بنفس بريده، ويدخل ثم يفعّل الرمز من شاشة الترحيب — لا يوجد إنشاء مستخدمين
        من المتصفح.
      </p>

      <form
        onSubmit={submit}
        className="mt-3 grid gap-3 sm:grid-cols-[1fr_10rem_auto]"
      >
        <Field label="البريد الإلكتروني" htmlFor="inv-email">
          <Input
            id="inv-email"
            dir="ltr"
            type="email"
            required
            placeholder="assistant@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Field label="الدور" htmlFor="inv-role">
          <Select
            id="inv-role"
            value={role}
            onChange={(e) => setRole(e.target.value as AppRole)}
          >
            {INVITABLE_ROLES.map((r) => (
              <option key={r} value={r}>
                {APP_ROLE_LABELS_AR[r]}
              </option>
            ))}
          </Select>
        </Field>
        <div className="flex items-end">
          <Button type="submit" disabled={createInvitation.isPending}>
            {createInvitation.isPending ? "جارٍ الإنشاء…" : "إنشاء دعوة"}
          </Button>
        </div>
      </form>

      {formError && (
        <p role="alert" className="mt-2 text-sm font-bold text-red-700">
          {formError}
        </p>
      )}

      {created && (
        <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm">
          <p className="font-bold text-emerald-800">
            دُعِي {created.email} — شارك معه الرمز:
          </p>
          <div className="mt-1 flex items-center gap-2">
            <code dir="ltr" className="rounded bg-white px-2 py-1 font-mono text-base font-black tracking-wider">
              {created.code}
            </code>
            <Button variant="outline" size="sm" onClick={() => copyCode(created.code)}>
              {copied ? (
                <Check className="h-4 w-4" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
              {copied ? "نُسخ" : "نسخ"}
            </Button>
          </div>
        </div>
      )}

      <h4 className="mt-4 text-sm font-black text-slate-600">
        دعوات معلقة ({pending.length})
      </h4>
      {invitations.isLoading ? (
        <div className="flex justify-center py-4">
          <Spinner className="h-5 w-5" />
        </div>
      ) : pending.length === 0 ? (
        <p className="mt-1 text-xs text-slate-400">لا توجد دعوات معلقة.</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {pending.map((inv) => (
            <li
              key={inv.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm"
            >
              <div>
                <span dir="ltr" className="font-mono text-xs">
                  {inv.email}
                </span>
                <span className="mr-2 text-xs text-slate-500">
                  {APP_ROLE_LABELS_AR[inv.role]}
                </span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                disabled={revokeInvitation.isPending}
                onClick={() =>
                  void revokeInvitation
                    .mutateAsync(inv.id)
                    .catch((cause: unknown) =>
                      window.alert(
                        cause instanceof Error ? cause.message : "تعذّر إلغاء الدعوة",
                      ),
                    )
                }
              >
                <Trash2 className="h-4 w-4" />
                إلغاء
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
