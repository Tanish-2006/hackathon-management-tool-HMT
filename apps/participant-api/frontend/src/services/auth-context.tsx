import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { hmtBackendService, clearAuthTokens, getSessionApi, getStoredAccessToken, markSessionApi, type AuthApi } from '@/services/backendApi';
import { organizerApi } from '@/services/organizerApi';

export type HmtRole = 'PARTICIPANT' | 'ORGANIZER' | 'MENTOR' | 'ADMIN';

export interface AuthUser {
  id: string;
  email: string;
  fullName?: string;
  displayName?: string;
  role: HmtRole;
  phoneNumber?: string | null;
  isPhoneVerified?: boolean;
  raw: any;
  source: AuthApi;
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

function toAuthUser(me: any, source: AuthApi): AuthUser | null {
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
    phoneNumber: me.phoneNumber ?? me.user?.phoneNumber ?? null,
    isPhoneVerified: me.isPhoneVerified ?? me.user?.isPhoneVerified ?? false,
    raw: me,
    source,
  };
}

const sessionClients = { participant: hmtBackendService, organizer: organizerApi };

const SESSION_CHECK_ATTEMPTS = 3;

async function loadSessionUser(api: AuthApi): Promise<AuthUser | null> {
  return toAuthUser(await sessionClients[api].getMe(), api);
}

async function probeLegacySession(api: AuthApi): Promise<AuthUser | null> {
  try {
    return await loadSessionUser(api);
  } catch (e: any) {
    if (e?.status !== 401 || e?.code === 'TOKEN_REUSE_DETECTED') return null;
  }
  try {
    await sessionClients[api].refresh();
    return await loadSessionUser(api);
  } catch {
    return null;
  }
}

async function fetchSessionUser(): Promise<AuthUser | null> {
  const api = getSessionApi();
  if (api) return loadSessionUser(api);
  for (const candidate of ['participant', 'organizer'] as const) {
    const user = await probeLegacySession(candidate);
    if (user) {
      markSessionApi(candidate);
      return user;
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
      for (let attempt = 1; attempt <= SESSION_CHECK_ATTEMPTS; attempt++) {
        try {
          const u = await fetchSessionUser();
          if (!mounted.current) return;
          if (!u) clearAuthTokens();
          setUser(u);
          return;
        } catch (e: any) {
          if (!mounted.current) return;
          if (e?.status === 401 || e?.code === 'TOKEN_REUSE_DETECTED') {
            clearAuthTokens();
            setUser(null);
            setError('Your session has ended. Please sign in again.');
            return;
          }
          if (attempt < SESSION_CHECK_ATTEMPTS) await new Promise((r) => setTimeout(r, attempt * 1000));
        }
      }
      setUser(null);
      setError('We could not reach the server. Please try again in a moment.');
    } finally {
      if (mounted.current) setInitializing(false);
    }
  }, []);

  useEffect(() => {
    void refreshAuth();
  }, [refreshAuth]);

  const logout = useCallback(async () => {
    try {
      const api = getSessionApi();
      await Promise.allSettled(api ? [sessionClients[api].logout()] : [hmtBackendService.logout(), organizerApi.logout()]);
    } finally {
      clearAuthTokens();
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
