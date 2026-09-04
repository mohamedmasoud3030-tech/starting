import { useEffect, useMemo, useSyncExternalStore } from "react";
import { AssistantSpeechEngine } from "./assistant-speech";

export interface AssistantVoiceController {
  supported: boolean;
  speaking: boolean;
  speak: (text: string) => boolean;
  stop: () => void;
}

/**
 * React bridge to the assistant speech engine. Never speaks on mount; the
 * engine is only set to speak by an explicit user action. Stops on unmount.
 */
export function useAssistantVoice(
  engine?: AssistantSpeechEngine,
): AssistantVoiceController {
  const instance = useMemo(() => engine ?? new AssistantSpeechEngine(), [engine]);
  const state = useSyncExternalStore(
    (onChange) => instance.subscribe(onChange),
    () => instance.getSnapshot(),
  );

  useEffect(() => () => instance.dispose(), [instance]);

  return useMemo<AssistantVoiceController>(
    () => ({
      supported: state.supported,
      speaking: state.status === "speaking",
      speak: (text) => instance.speak(text),
      stop: () => instance.cancel(),
    }),
    [instance, state],
  );
}
