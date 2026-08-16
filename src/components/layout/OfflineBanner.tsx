import { WifiOff } from "lucide-react";
import { useOnlineStatus } from "@/pwa/useOnlineStatus";

/**
 * Connectivity notice for on-site operators.
 *
 * Says exactly two true things: the connection is gone, and what that means
 * for the numbers on screen. It deliberately does NOT block the UI — read-only
 * review of already-loaded data is still useful on a warehouse floor — and it
 * never claims a write succeeded or queues one.
 */
export function OfflineBanner() {
  const online = useOnlineStatus();
  if (online) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center justify-center gap-2 bg-amber-100 px-4 py-2 text-center text-sm font-bold text-amber-900"
    >
      <WifiOff className="h-4 w-4 flex-none" aria-hidden="true" />
      <span>لا يوجد اتصال بالإنترنت — البيانات المعروضة قد لا تكون محدثة، ولا يمكن حفظ أي تغيير الآن.</span>
    </div>
  );
}
