"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, tokenStore, UNAUTHORIZED_EVENT } from "@/lib/api";
import type { User } from "@/types";

type AuthStatus = "loading" | "authenticated" | "unauthenticated";

interface AuthContextValue {
  status: AuthStatus;
  user: User | null;
  login: (accountId: string, username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  /** True after the user signed out themselves (as opposed to an expired or revoked session). */
  signedOut: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<User | null>(null);
  const [signedOut, setSignedOut] = useState(false);

  const clear = useCallback(() => {
    tokenStore.clear();
    setUser(null);
    setStatus("unauthenticated");
  }, []);

  // Restore the session on first load (session persistence across refreshes).
  useEffect(() => {
    if (!tokenStore.get()) {
      setStatus("unauthenticated");
      return;
    }
    api.auth
      .session()
      .then((s) => {
        setUser(s.user);
        setStatus("authenticated");
      })
      .catch(clear);
  }, [clear]);

  // Any 401 from the API (expired/revoked session) signs the user out.
  useEffect(() => {
    window.addEventListener(UNAUTHORIZED_EVENT, clear);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, clear);
  }, [clear]);

  const login = useCallback(async (accountId: string, username: string, password: string) => {
    const s = await api.auth.login(accountId, username, password);
    tokenStore.set(s.token);
    setSignedOut(false);
    setUser(s.user);
    setStatus("authenticated");
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.auth.logout();
    } catch {
      /* session may already be gone server-side */
    }
    setSignedOut(true);
    clear();
  }, [clear]);

  const value = useMemo(
    () => ({ status, user, login, logout, signedOut }),
    [status, user, login, logout, signedOut],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
