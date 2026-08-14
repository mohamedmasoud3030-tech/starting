import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { AppRole } from "@/lib/domain";
import {
  clearSession,
  loadSession,
  loginAs,
  type Session,
} from "@/engine/engine";

interface SessionContextValue {
  session: Session | null;
  login: (role: AppRole, fullName: string) => void;
  logout: () => void;
  switchRole: (role: AppRole) => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(() => loadSession());

  const value = useMemo<SessionContextValue>(
    () => ({
      session,
      login: (role, fullName) => setSession(loginAs(role, fullName)),
      logout: () => {
        clearSession();
        setSession(null);
      },
      switchRole: (role) => {
        if (!session) return;
        setSession(loginAs(role, session.fullName));
      },
    }),
    [session],
  );

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within SessionProvider");
  return ctx;
}
