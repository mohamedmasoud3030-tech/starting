import { useEffect, useRef, useState } from "react";

/**
 * A stable idempotency key for the lifetime of one form/dialog session.
 *
 * Server commands replay safely only when a retry carries the SAME key and
 * payload. Generating the key inside the submit handler (the previous
 * create-event behavior) made every retry after a lost response look like a
 * brand-new request, so an ambiguous failure could create duplicate rows.
 *
 * This hook hands out one key while `active` is true and rotates it whenever
 * the dialog/session reopens, so a genuine new session never reuses a spent
 * key (defect F6).
 */
export function useStableIdempotencyKey(active: boolean): string {
  const [key, setKey] = useState(() => crypto.randomUUID());
  const wasActive = useRef(active);

  useEffect(() => {
    if (active && !wasActive.current) {
      setKey(crypto.randomUUID());
    }
    wasActive.current = active;
  }, [active]);

  return key;
}
