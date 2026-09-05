import { createContext, useContext } from "react";

/**
 * Toast feedback contract. The provider/UI live in `Toast.tsx`; this file
 * holds the context + hook so a component-only file (`Toast.tsx`) does not
 * mix hook exports (keeps React Fast Refresh clean, matching the
 * `authContext.ts` / `AuthContext.tsx` split used elsewhere).
 */
export interface ToastApi {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

export const ToastContext = createContext<ToastApi | null>(null);

/**
 * Access the toast notifier. Fails SOFT (no-op) when used outside the
 * provider — pre-auth screens render without the app shell, and isolated
 * panel tests must not crash on a missing provider.
 */
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    return { success: () => {}, error: () => {}, info: () => {} };
  }
  return ctx;
}
