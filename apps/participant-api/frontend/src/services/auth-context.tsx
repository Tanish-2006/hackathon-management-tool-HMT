// Centralized auth state — backend is the source of truth for identity + role.
// Startup flow: initialize -> validate token via /auth/me -> populate user -> render guards.
// Never falls back to a demo role. Invalid/expired session clears state -> login.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { hmtBackendService, clearAuthTokens, getStoredAccessToken, type MeResponse } from '@/services/backendApi';
import { organizerApi } from '@/services/organizerApi';

export type HmtRole = 'PARTICIPANT' | 'ORGANIZER' | 'MENTOR' | 'ADMIN';

export interface AuthUser {
  id: string;
  email: string;
  fullName?: string;
  displayName?: string;
  role: HmtRole;
  raw: any;
  source: 'participant' | 'organizer';
}

interface AuthState {
  user: AuthUser | null;
  role: HmtRole | null;
  initializing: boolean;
  error: string | null;
  refreshAuth: () => Promise<void>;
  logout: () => Promise<void>;
  setSessionUser: (u: AuthUser | null) => void;
}

const AuthContext = createContext<AuthState | null>(null);

function normalizeRole(r: unknown): HmtRole | null {
  if (r === 'PARTICIPANT' || r === 'ORGANIZER' || r === 'MENTOR' || r === 'ADMIN') return r;
  return null;
}

function toAuthUser(me: any, source: 'participant' | 'organizer'): AuthUser | null {
  if (!me) return null;
  const role = normalizeRole(me.role ?? me.user?.role);
  if (!role) return null;
  const id = String(me.id ?? me.user?.id ?? '');
  const email = String(me.email ?? me.user?.email ?? '');
  if (!id || !email) return null;
  return {
    id,
    email,
    fullName: me.fullName ?? me.user?.fullName,
    displayName: me.displayName ?? me.user?.displayName,
    role,
    raw: me,
    source,
  };
}

async function fetchSessionUser(): Promise<AuthUser | null> {
  // Prefer participant API (canonical identity), fall back to organizer API.
  // Both use the shared hmt_access_token key; backend validates signature + role.
  try {
    const me = await hmtBackendService.getMe();
    const u = toAuthUser(me as any, 'participant');
    if (u) return u;
  } catch (e: any) {
    const status = e?.status;
    // On 401 try a single refresh before giving up (expired access token path).
    if (status === 401 && !String(e?.message || '').includes('reuse')) {
      try {
        await hmtBackendService.refresh();
        const me = await hmtBackendService.getMe();
        const u = toAuthUser(me as any, 'participant');
        if (u) return u;
      } catch { /* fall through to organizer check */ }
    } else if (status !== 401 && status !== 403 && status !== 0) {
      // Non-auth error (e.g. 500) — do not silently clear; let caller decide.
    }
  }
  try {
    const me = await organizerApi.getMe();
    const u = toAuthUser(me as any, 'organizer');
    if (u) return u;
  } catch (e: any) {
    const status = (e as any)?.status;
    if (status === 401) {
      try {
        await organizerApi.refresh();
        const me = await organizerApi.getMe();
        const u = toAuthUser(me as any, 'organizer');
        if (u) return u;
      } catch { /* session invalid */ }
    }
  }
  return null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const refreshAuth = useCallback(async () => {
    const token = getStoredAccessToken();
    if (!token) {
      if (mounted.current) {
        setUser(null);
        setInitializing(false);
      }
      return;
    }
    if (mounted.current) setError(null);
    try {
      const u = await fetchSessionUser();
      if (!mounted.current) return;
      if (u) {
        setUser(u);
      } else {
        // Invalid/expired session — clear stale state so guards redirect to login.
        clearAuthTokens();
        organizerApi.logoutLocal();
        setUser(null);
      }
    } catch {
      if (!mounted.current) return;
      clearAuthTokens();
      organizerApi.logoutLocal();
      setUser(null);
      setError('Session validation failed. Please sign in again.');
    } finally {
      if (mounted.current) setInitializing(false);
    }
  }, []);

  useEffect(() => {
    void refreshAuth();
  }, [refreshAuth]);

  const logout = useCallback(async () => {
    try {
      // Best-effort server invalidation on both APIs; always clear local state.
      await Promise.allSettled([hmtBackendService.logout(), organizerApi.logout()]);
    } finally {
      clearAuthTokens();
      organizerApi.logoutLocal();
      if (mounted.current) setUser(null);
    }
  }, []);

  const setSessionUser = useCallback((u: AuthUser | null) => {
    setUser(u);
    setInitializing(false);
  }, []);

  const value = useMemo<AuthState>(
    () => ({ user, role: user?.role ?? null, initializing, error, refreshAuth, logout, setSessionUser }),
    [user, initializing, error, refreshAuth, logout, setSessionUser],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

/** Display name derived ONLY from the authenticated user — no demo fallback. */
export function displayNameOf(user: AuthUser | null | undefined): string {
  if (!user) return '';
  return user.fullName || user.displayName || user.email.split('@')[0] || 'Account';
}

export function initialsOf(user: AuthUser | null | undefined): string {
  const name = displayNameOf(user);
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}
