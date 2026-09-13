import { useCallback, useRef, useState } from "react";
import { transcribeVoice } from "./assistant-api";

/**
 * Voice input for «لينا» (mic button).
 *
 * Strategy (hybrid):
 *  1. If the browser ships native Arabic speech recognition
 *     (`SpeechRecognition`), transcribe in place — no network, live on
 *     Chrome/Edge/Android and Safari.
 *  2. Otherwise record with MediaRecorder, convert to a WAV clip and send it
 *     to the ai-assistant edge function for provider transcription.
 *
 * The hook exposes a minimal controller so the launcher stays declarative.
 */

export type VoiceInputStatus = "idle" | "listening" | "recording" | "transcribing" | "error";

export interface VoiceInputController {
  supported: boolean;
  status: VoiceInputStatus;
  error: string | null;
  /** Begin listening/recording; the handler receives the final transcript. */
  start: (onText?: (text: string) => void) => void;
  stop: () => void;
}

type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  continuous: boolean;
  onresult: ((event: { resultIndex: number; results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> }) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

function resolveSpeechRecognition(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Convert any decodable audio blob (e.g. webm/opus) into mono 16-bit WAV. */
export async function blobToWavBase64(blob: Blob): Promise<{ b64: string; mime: string }> {
  const AudioContextCtor =
    (typeof window !== "undefined" &&
      (window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)) ??
    null;
  if (!AudioContextCtor) throw new Error("المتصفح لا يدعم معالجة الصوت.");
  const context = new AudioContextCtor();
  try {
    const arrayBuffer = await blob.arrayBuffer();
    const audioBuffer = await context.decodeAudioData(arrayBuffer);
    const sampleRate = audioBuffer.sampleRate;
    const channels = 1;
    const frameCount = audioBuffer.length;
    const channelData = audioBuffer.getChannelData(0);
    const pcm = new Int16Array(frameCount);
    for (let i = 0; i < frameCount; i++) {
      const sample = Math.max(-1, Math.min(1, channelData[i] ?? 0));
      pcm[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    }
    const bytes = new Uint8Array(pcm.buffer);
    const header = new ArrayBuffer(44);
    const view = new DataView(header);
    const writeStr = (offset: number, value: string) => {
      for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
    };
    writeStr(0, "RIFF");
    view.setUint32(4, 36 + bytes.length, true);
    writeStr(8, "WAVE");
    writeStr(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, channels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * channels * 2, true);
    view.setUint16(32, channels * 2, true);
    view.setUint16(34, 16, true);
    writeStr(36, "data");
    view.setUint32(40, bytes.length, true);
    const wav = new Uint8Array(header.byteLength + bytes.length);
    wav.set(new Uint8Array(header), 0);
    wav.set(bytes, 44);
    let binary = "";
    for (let i = 0; i < wav.length; i += 0x8000) {
      binary += String.fromCharCode(...wav.subarray(i, i + 0x8000));
    }
    return { b64: btoa(binary), mime: "audio/wav" };
  } finally {
    void context.close().catch(() => undefined);
  }
}

type MediaRecorderLike = {
  ondataavailable: ((event: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
  onerror: ((event: { error?: unknown }) => void) | null;
  start: () => void;
  stop: () => void;
};

function resolveMediaRecorder(): (new (stream: MediaStream) => MediaRecorderLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { MediaRecorder?: new (stream: MediaStream) => MediaRecorderLike };
  return w.MediaRecorder ?? null;
}

/** True when at least one usable input path exists. */
export function voiceInputSupported(): boolean {
  return resolveSpeechRecognition() !== null || resolveMediaRecorder() !== null;
}

export function useVoiceInput(): VoiceInputController {
  const [status, setStatus] = useState<VoiceInputStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const transcriptRef = useRef<((text: string) => void) | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const mediaRef = useRef<{ stream: MediaStream; recorder: MediaRecorderLike; chunks: Blob[] } | null>(null);

  const supported = voiceInputSupported();

  const cleanupRecognition = useCallback(() => {
    const recognition = recognitionRef.current;
    if (recognition) {
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      try { recognition.abort(); } catch { /* noop */ }
      recognitionRef.current = null;
    }
  }, []);

  const startNative = useCallback((): boolean => {
    const Ctor = resolveSpeechRecognition();
    if (!Ctor) return false;
    const recognition = new Ctor();
    recognition.lang = "ar-OM-u-nu-latn";
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.continuous = false;
    recognition.onresult = (event) => {
      let finalText = "";
      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i];
        if (result?.isFinal) finalText += result[0]?.transcript ?? "";
      }
      if (finalText.trim()) transcriptRef.current?.(finalText.trim());
    };
    recognition.onerror = (event) => {
      setError(event.error === "not-allowed" ? "لم يُسمح بالوصول إلى الميكروفون." : "تعذّر سماعك، أعد المحاولة أو اكتب رسالتك.");
      setStatus("idle");
    };
    recognition.onend = () => {
      setStatus("idle");
      recognitionRef.current = null;
    };
    recognitionRef.current = recognition;
    try {
      recognition.start();
      setStatus("listening");
      setError(null);
      return true;
    } catch {
      setError("تعذّر بدء الاستماع.");
      setStatus("idle");
      recognitionRef.current = null;
      return false;
    }
  }, []);

  const stopNative = useCallback(() => {
    try { recognitionRef.current?.stop(); } catch { /* noop */ }
    cleanupRecognition();
    setStatus("idle");
  }, [cleanupRecognition]);

  const sendForTranscription = useCallback(async (blob: Blob) => {
    setStatus("transcribing");
    setError(null);
    try {
      const { b64 } = await blobToWavBase64(blob);
      const text = await transcribeVoice(b64, "audio/wav");
      if (text.trim()) transcriptRef.current?.(text.trim());
    } catch (cause) {
      setError(cause instanceof Error && cause.message ? cause.message : "تعذّر تحويل التسجيل إلى نص.");
    } finally {
      setStatus("idle");
    }
  }, []);

  const startRecording = useCallback(async (): Promise<void> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const Recorder = resolveMediaRecorder();
      if (!Recorder) {
        stream.getTracks().forEach((track) => track.stop());
        setError("المتصفح لا يدعم تسجيل الصوت.");
        setStatus("idle");
        return;
      }
      const chunks: Blob[] = [];
      const recorder = new Recorder(stream);
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) chunks.push(event.data);
      };
      recorder.onerror = () => {
        setError("حدث خطأ أثناء التسجيل.");
        setStatus("idle");
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(chunks, { type: "audio/webm" });
        mediaRef.current = null;
        void sendForTranscription(blob);
      };
      mediaRef.current = { stream, recorder, chunks };
      recorder.start();
      setStatus("recording");
      setError(null);
    } catch {
      setError("لم يُسمح بالوصول إلى الميكروفون.");
      setStatus("idle");
    }
  }, [sendForTranscription]);

  const stopRecording = useCallback(() => {
    mediaRef.current?.recorder.stop();
  }, []);

  const start = useCallback(
    (onText?: (text: string) => void) => {
      if (onText) transcriptRef.current = onText;
      setError(null);
      const usedNative = startNative();
      if (!usedNative) void startRecording();
    },
    [startNative, startRecording],
  );

  const stop = useCallback(() => {
    if (status === "recording") stopRecording();
    else stopNative();
  }, [status, stopRecording, stopNative]);

  return {
    supported,
    status,
    error,
    start,
    stop,
  };
}
