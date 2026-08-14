import { useEffect, useMemo, useSyncExternalStore } from "react";
import { OwnerVoiceEngine, type OwnerVoiceRate } from "./engine";

/**
 * React bridge for the Owner Voice engine.
 *
 * - Never speaks on mount: nothing here calls `speak()` except the explicit
 *   user action that invokes the returned controller.
 * - Stops speech when the owning component unmounts, so a narration never
 *   continues after the owner navigates to another screen.
 * - `supported === false` means the browser has no speechSynthesis; callers
 *   must degrade the UI (the OwnerVoiceButton renders a disabled control).
 */
export interface OwnerVoiceController {
  supported: boolean;
  speaking: boolean;
  lastText: string | null;
  rate: OwnerVoiceRate;
  speak: (text: string) => boolean;
  stop: () => void;
  replay: () => boolean;
  setRate: (rate: OwnerVoiceRate) => void;
}

export function useOwnerVoice(engine?: OwnerVoiceEngine): OwnerVoiceController {
  const instance = useMemo(() => engine ?? new OwnerVoiceEngine(), [engine]);
  const state = useSyncExternalStore(
    (onStoreChange) => instance.subscribe(onStoreChange),
    () => instance.getSnapshot(),
  );

  useEffect(
    () => () => {
      instance.dispose();
    },
    [instance],
  );

  return useMemo<OwnerVoiceController>(
    () => ({
      supported: state.supported,
      speaking: state.speaking,
      lastText: state.lastText,
      rate: state.rate,
      speak: (text) => instance.speak(text),
      stop: () => instance.stop(),
      replay: () => instance.replay(),
      setRate: (rate) => instance.setRate(rate),
    }),
    [instance, state],
  );
}
