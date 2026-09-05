import type { ReactNode } from "react";
import { useAuth } from "@/app/authContext";
import type { Capability } from "@/lib/capabilities";

/**
 * Capability-aware rendering.
 *
 * The DATABASE is the security boundary: hiding something in the UI is
 * presentation only and never replaces server-side authorization. These
 * wrappers exist so that unavailable actions do not clutter (or confuse) an
 * operator whose role cannot perform them, and so a disabled-with-reason
 * affordance can explain why an action is unavailable.
 *
 * Capability names come from the canonical `CAPABILITIES` list (migration
 * 0079), e.g. `<Can capability="payment.record">…</Can>`.
 */

/**
 * Renders `children` only when the current member holds `capability`.
 * Returns `null` otherwise. Use for action buttons/menus the role must never
 * see. For a "disabled with explanation" affordance use `<CanGate>`.
 */
export function Can({
  capability,
  children,
}: {
  capability: Capability;
  children: ReactNode;
}) {
  const { hasCapability } = useAuth();
  if (!hasCapability(capability)) return null;
  return <>{children}</>;
}

/**
 * Always renders its render-prop child, passing `allowed` so a trigger can
 * stay VISIBLE but render disabled with a `title` explaining the missing
 * permission. Prefer this over `<Can>` when the affordance should remain
 * discoverable to a limited role.
 *
 * @example
 * <CanGate capability="finance.manage">
 *   {(allowed) => (
 *     <Button disabled={!allowed} title={allowed ? undefined : "تتطلب صلاحية مالية"}>
 *       تسوية
 *     </Button>
 *   )}
 * </CanGate>
 */
export function CanGate({
  capability,
  children,
}: {
  capability: Capability;
  children: (allowed: boolean) => ReactNode;
}) {
  const { hasCapability } = useAuth();
  return <>{children(hasCapability(capability))}</>;
}
