import { useEffect, useState } from "react";

/**
 * Tracks browser connectivity.
 *
 * `navigator.onLine` only proves the device has *a* network interface, not
 * that Supabase is reachable — so this drives an informational banner only and
 * is never used to gate a write. Commands stay idempotent and the database
 * stays authoritative; the banner exists so an operator on a weak site
 * connection understands why data may not be refreshing.
 */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  return online;
}
