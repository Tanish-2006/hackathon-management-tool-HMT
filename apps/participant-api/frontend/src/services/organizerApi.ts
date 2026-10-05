// Organizer + Mentor API client — separate from participant API (Agent 3 shared system)
// Base: organizer-api Fastify (port 3002, prefix /api/v1). See api-config.ts.
// Handles: base URL, auth headers, request IDs, timeout, typed contracts, error handling, organizer auth
import { ORGANIZER_API_BASE, API_TIMEOUT_MS } from '@/services/api-config';
const ORGANIZER_BASE = ORGANIZER_API_BASE;

const REQUEST_TIMEOUT_MS = API_TIMEOUT_MS;
export const ORGANIZER_ACCESS_KEY = 'hmt_access_token';
export const ORGANIZER_REFRESH_KEY = 'hmt_refresh_token';

export class OrganizerApiError extends Error {
  status: number;
  code?: string;
  details?: unknown;
  constructor(message: string, status: number, code?: string, details?: unknown) {
    super(message);
    this.name = 'OrganizerApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function friendlyOrganizerMessage(status: number, raw?: string, code?: string): string {
  if (code === 'TOKEN_REUSE_DETECTED' || raw?.includes('TOKEN_REUSE') || raw?.includes('Token reuse')) {
    return 'Security alert: token reuse detected. All sessions revoked. Please sign in again.';
  }
  // Never expose raw JWT internals (e.g. "jwt expired") — show a clean session message.
  if (status === 401 && raw && /jwt|token expired|expired token|invalid token|unauthorized/i.test(raw) && !raw.includes('Invalid credentials')) {
    return 'Session expired. Please sign in again.';
  }
  if (raw && raw.length < 180 && !raw.includes('stack') && !raw.includes('at ')) return raw;
  switch (status) {
    case 400: return raw || 'Invalid request. Please check your input.';
    case 401: return raw?.includes('Invalid credentials') ? 'Invalid email or password.' : (raw || 'Session expired. Please sign in again.');
    case 403: return 'You do not have permission for this action.';
    case 404: return 'Requested resource was not found.';
    case 409: return raw || 'Conflict — already exists.';
    case 429: return 'Too many requests. Please wait a moment.';
    case 500: return 'Server error. Please try again later.';
    default: return raw || 'Something went wrong. Please try again.';
  }
}

function getRequestId(): string {
  try { if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return (crypto as any).randomUUID(); } catch {}
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function isTokenReuse(message?: string, code?: string) {
  return code === 'TOKEN_REUSE_DETECTED' || !!message?.includes('TOKEN_REUSE') || !!message?.includes('Token reuse');
}

// Single in-flight refresh shared by concurrent 401s: parallel refreshes with the
// same token would trip server-side reuse detection and nuke the session.
let pendingRefresh: Promise<boolean> | null = null;

async function refreshOrganizerSession(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  if (!pendingRefresh) {
    pendingRefresh = (async () => {
      try {
        const refreshToken = localStorage.getItem(ORGANIZER_REFRESH_KEY);
        if (!refreshToken) return false;
        const res: any = await fetchOrganizer('/auth/refresh', { method: 'POST', body: JSON.stringify({ refreshToken }) }, { retried: true });
        if (res?.accessToken) localStorage.setItem(ORGANIZER_ACCESS_KEY, res.accessToken);
        if (res?.token) localStorage.setItem(ORGANIZER_ACCESS_KEY, res.token);
        if (res?.refreshToken) localStorage.setItem(ORGANIZER_REFRESH_KEY, res.refreshToken);
        return true;
      } catch {
        return false;
      } finally {
        pendingRefresh = null;
      }
    })();
  }
  return pendingRefresh;
}

export async function fetchOrganizer(endpoint: string, options: RequestInit = {}, retry?: { retried: boolean }) {
  const token = typeof window !== 'undefined' ? localStorage.getItem(ORGANIZER_ACCESS_KEY) : null;
  const hasBody = options.body !== undefined && options.body !== null;
  const requestId = getRequestId();
  const headers: Record<string, string> = {
    ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
    'X-Request-Id': requestId,
    'X-Correlation-Id': requestId,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers as Record<string, string>),
  };
  const url = `${ORGANIZER_BASE}${endpoint}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(url, { ...options, headers, signal: controller.signal });
  } catch (e: any) {
    clearTimeout(timeout);
    if (e?.name === 'AbortError') throw new OrganizerApiError('Request timed out. Please try again.', 408, 'TIMEOUT');
    throw new OrganizerApiError(e?.message || 'Network error. Please check your connection.', 0, 'NETWORK_ERROR');
  }
  clearTimeout(timeout);
  const responseRequestId = response.headers.get('x-request-id');
  if (!response.ok) {
    let body: any = {};
    try { body = await response.json(); } catch { try { body = { message: await response.text() }; } catch { body = { message: response.statusText }; } }
    const msgRaw = body?.error?.message || body?.message || body?.error || response.statusText;
    const code = body?.error?.code || body?.code || body?.errorCode;
    if (response.status === 401 && isTokenReuse(msgRaw, code)) {
      if (typeof window !== 'undefined') {
        localStorage.removeItem(ORGANIZER_ACCESS_KEY);
        localStorage.removeItem(ORGANIZER_REFRESH_KEY);
      }
      throw new OrganizerApiError(friendlyOrganizerMessage(response.status, msgRaw, 'TOKEN_REUSE_DETECTED'), response.status, 'TOKEN_REUSE_DETECTED', { ...body, requestId: responseRequestId || requestId });
    }
    // Expired access token: refresh once and retry the original request.
    // 401s are raised by the auth guard before any mutation, so a single retry
    // cannot duplicate anything. Auth endpoints and reuse cases never retry.
    if (response.status === 401 && !retry?.retried && !endpoint.startsWith('/auth/') && !isTokenReuse(msgRaw, code)) {
      const refreshed = await refreshOrganizerSession();
      if (refreshed) return fetchOrganizer(endpoint, options, { retried: true });
      if (typeof window !== 'undefined') {
        localStorage.removeItem(ORGANIZER_ACCESS_KEY);
        localStorage.removeItem(ORGANIZER_REFRESH_KEY);
      }
    }
    const msg = friendlyOrganizerMessage(response.status, msgRaw, code);
    throw new OrganizerApiError(msg, response.status, code, { ...body, requestId: responseRequestId || requestId });
  }
  if (response.status === 204) return null;
  const text = await response.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text as any; }
}

function unwrapData<T>(res: any): T {
  if (res == null) return res as T;
  if (res.data !== undefined) return res.data as T;
  return res as T;
}

export type OrganizerMe = { id: string; email: string; role: string; displayName?: string; fullName?: string; [k:string]: any };
export type OrganizerAuthResponse = { user?: OrganizerMe; accessToken: string; refreshToken?: string; token?: string; expiresIn?: number; [k:string]: any };

export const organizerApi = {
  // ---------- Auth (organizer backend — real) ----------
  async register(data: { email: string; password: string; displayName?: string; fullName?: string; role?: string; phoneNumber: string }): Promise<OrganizerAuthResponse> {
    // Creation default only (organizer API creates ORGANIZER-role accounts).
    // This is NOT an authenticated-session fallback — session role always comes from /auth/me.
    const requestedRole = data.role || 'ORGANIZER';
    const payload: any = {
      email: data.email,
      password: data.password,
      displayName: data.displayName || data.fullName,
      fullName: data.fullName || data.displayName,
      role: requestedRole,
      // Phase 1 phone identity: ONE verified phone number = ONE HMT identity.
      phoneNumber: data.phoneNumber,
    };
    const res: any = await fetchOrganizer('/auth/register', { method: 'POST', body: JSON.stringify(payload) });
    const token = res.accessToken || res.token;
    if (token && typeof window !== 'undefined') localStorage.setItem(ORGANIZER_ACCESS_KEY, token);
    if (res.refreshToken && typeof window !== 'undefined') localStorage.setItem(ORGANIZER_REFRESH_KEY, res.refreshToken);
    return res as OrganizerAuthResponse;
  },
  async login(data: { email: string; password: string }): Promise<OrganizerAuthResponse> {
    const res: any = await fetchOrganizer('/auth/login', { method: 'POST', body: JSON.stringify(data) });
    const token = res.accessToken || res.token;
    if (token && typeof window !== 'undefined') localStorage.setItem(ORGANIZER_ACCESS_KEY, token);
    if (res.refreshToken && typeof window !== 'undefined') localStorage.setItem(ORGANIZER_REFRESH_KEY, res.refreshToken);
    return res as OrganizerAuthResponse;
  },
  async getMe(): Promise<OrganizerMe> {
    const res = await fetchOrganizer('/auth/me');
    // server may return user directly or {user:{...}}
    const unwrapped: any = unwrapData<any>(res);
    if (unwrapped?.user) return unwrapped.user as OrganizerMe;
    return unwrapped as OrganizerMe;
  },
  async refresh(refreshToken?: string): Promise<OrganizerAuthResponse> {
    const token = refreshToken || (typeof window !== 'undefined' ? localStorage.getItem(ORGANIZER_REFRESH_KEY) : null);
    if (!token) throw new OrganizerApiError('Missing refresh token. Please sign in again.', 401, 'MISSING_REFRESH_TOKEN');
    const res: any = await fetchOrganizer('/auth/refresh', { method: 'POST', body: JSON.stringify({ refreshToken: token }) });
    if (res.accessToken && typeof window !== 'undefined') localStorage.setItem(ORGANIZER_ACCESS_KEY, res.accessToken);
    if (res.token && typeof window !== 'undefined') localStorage.setItem(ORGANIZER_ACCESS_KEY, res.token);
    if (res.refreshToken && typeof window !== 'undefined') localStorage.setItem(ORGANIZER_REFRESH_KEY, res.refreshToken);
    return res as OrganizerAuthResponse;
  },
  async requestVerification(): Promise<any> {
    // organizer may not support; fallback to participant-style but treat as no-op
    try { return await fetchOrganizer('/auth/request-verification', { method: 'POST', body: JSON.stringify({}) }); }
    catch { return { message: 'Verification not required for organizer accounts' } as any; }
  },
  async verifyEmail(token: string): Promise<any> {
    return fetchOrganizer('/auth/verify-email', { method: 'POST', body: JSON.stringify({ token }) });
  },
  // Phase 1 phone identity: OTP resend + verify (JWT required, same contract as participant API).
  async requestPhoneOtp(phoneNumber: string): Promise<{ message: string; expiresIn?: string; phoneOtp?: string }> {
    return fetchOrganizer('/auth/phone/request-otp', { method: 'POST', body: JSON.stringify({ phoneNumber }) });
  },
  async verifyPhoneOtp(phoneNumber: string, otp: string): Promise<{ message: string }> {
    return fetchOrganizer('/auth/phone/verify', { method: 'POST', body: JSON.stringify({ phoneNumber, otp }) });
  },
  async forgotPassword(email: string): Promise<any> {
    return fetchOrganizer('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) });
  },
  async resetPassword(token: string, newPassword: string): Promise<any> {
    return fetchOrganizer('/auth/reset-password', { method: 'POST', body: JSON.stringify({ token, newPassword }) });
  },
  async logout(): Promise<any> {
    try {
      const res = await fetchOrganizer('/auth/logout', { method: 'POST', body: JSON.stringify({}) });
      if (typeof window !== 'undefined') {
        localStorage.removeItem(ORGANIZER_ACCESS_KEY);
        localStorage.removeItem(ORGANIZER_REFRESH_KEY);
      }
      return res;
    } catch (e) {
      if (typeof window !== 'undefined') {
        localStorage.removeItem(ORGANIZER_ACCESS_KEY);
        localStorage.removeItem(ORGANIZER_REFRESH_KEY);
      }
      throw e;
    }
  },
  async logoutAll(): Promise<any> {
    try {
      const res = await fetchOrganizer('/auth/logout-all', { method: 'POST', body: JSON.stringify({}) });
      if (typeof window !== 'undefined') {
        localStorage.removeItem(ORGANIZER_ACCESS_KEY);
        localStorage.removeItem(ORGANIZER_REFRESH_KEY);
      }
      return res;
    } catch (e) {
      if (typeof window !== 'undefined') {
        localStorage.removeItem(ORGANIZER_ACCESS_KEY);
        localStorage.removeItem(ORGANIZER_REFRESH_KEY);
      }
      throw e;
    }
  },
  logoutLocal() {
    if (typeof window !== 'undefined') {
      localStorage.removeItem(ORGANIZER_ACCESS_KEY);
      localStorage.removeItem(ORGANIZER_REFRESH_KEY);
    }
  },

  // ---------- Hackathons ----------
  async listHackathons(): Promise<any[]> { const res = await fetchOrganizer('/hackathons'); return unwrapData<any[]>(res) ?? []; },
  async getHackathon(id: string): Promise<any> { const res = await fetchOrganizer(`/hackathons/${id}`); return unwrapData<any>(res); },
  async createHackathonManual(data: any): Promise<any> { const res = await fetchOrganizer('/hackathons', { method: 'POST', body: JSON.stringify(data) }); return unwrapData<any>(res); },
  async generateDraft(data: any): Promise<{ hackathon: any; draft: any }> { const res = await fetchOrganizer('/hackathons/draft/generate', { method: 'POST', body: JSON.stringify(data) }); const d = unwrapData<any>(res); return d; },
  // Quick-create wizard: 5 organizer answers -> complete AI draft (DRAFT only, never auto-published)
  async generateWizard(data: { mode: string; about: string; hackathonType: string; eligibility: string[]; customEligibility?: string | null; durationPlus: string }): Promise<{ hackathon: any; draft: any }> {
    const res = await fetchOrganizer('/hackathons/wizard/generate', { method: 'POST', body: JSON.stringify(data) });
    return unwrapData<any>(res);
  },
  // Section-level regeneration: ONLY the requested section changes
  async regenerateSection(id: string, section: string, instruction?: string | null): Promise<{ hackathon: any; section: string; provenance: string }> {
    const res = await fetchOrganizer(`/hackathons/${id}/regenerate-section`, { method: 'POST', body: JSON.stringify({ section, instruction: instruction ?? null }) });
    return unwrapData<any>(res);
  },
  async updateHackathon(id: string, data: any): Promise<any> { const res = await fetchOrganizer(`/hackathons/${id}`, { method: 'PATCH', body: JSON.stringify(data) }); return unwrapData<any>(res); },
  async transitionReview(id: string): Promise<any> { const res = await fetchOrganizer(`/hackathons/${id}/review`, { method: 'POST', body: JSON.stringify({}) }); return unwrapData<any>(res); },
  async transitionConfirm(id: string): Promise<any> { const res = await fetchOrganizer(`/hackathons/${id}/confirm`, { method: 'POST', body: JSON.stringify({}) }); return unwrapData<any>(res); },
  async transitionPublish(id: string): Promise<{ hackathon: any; publishedEvent: any }> { const res = await fetchOrganizer(`/hackathons/${id}/publish`, { method: 'POST', body: JSON.stringify({}) }); const d = unwrapData<any>(res); if (d?.hackathon) return d as any; return d as any; },
  async transitionArchive(id: string): Promise<any> { const res = await fetchOrganizer(`/hackathons/${id}/archive`, { method: 'POST', body: JSON.stringify({}) }); return unwrapData<any>(res); },
  async directPublishBlocked(id: string): Promise<any> { return fetchOrganizer(`/hackathons/${id}/direct-publish`, { method: 'POST', body: JSON.stringify({}) }); },

  // ---------- Themes ----------
  async listThemes(): Promise<any[]> { const res = await fetchOrganizer('/themes'); return unwrapData<any[]>(res) ?? []; },
  async getTheme(id: string): Promise<any> { const res = await fetchOrganizer(`/themes/${id}`); return unwrapData<any>(res); },
  async createTheme(data: { name: string; description?: string }): Promise<any> { const res = await fetchOrganizer('/themes', { method: 'POST', body: JSON.stringify(data) }); return unwrapData<any>(res); },
  async assignThemeToHackathon(hackathonId: string, themeId: string): Promise<any> { return fetchOrganizer(`/hackathons/${hackathonId}/themes`, { method: 'POST', body: JSON.stringify({ themeId }) }); },
  async seedThemes(): Promise<any[]> { const res = await fetchOrganizer('/themes/seed-defaults', { method: 'POST', body: JSON.stringify({}) }); return unwrapData<any[]>(res) ?? []; },

  // ---------- Resources ----------
  async createResource(hackathonId: string, data: any): Promise<any> { const res = await fetchOrganizer(`/hackathons/${hackathonId}/resources`, { method: 'POST', body: JSON.stringify(data) }); return unwrapData<any>(res); },
  async listResources(hackathonId: string): Promise<any[]> { const res = await fetchOrganizer(`/hackathons/${hackathonId}/resources`); return unwrapData<any[]>(res) ?? []; },
  async updateResource(resourceId: string, data: any): Promise<any> { const res = await fetchOrganizer(`/resources/${resourceId}`, { method: 'PATCH', body: JSON.stringify(data) }); return unwrapData<any>(res); },
  async deleteResource(resourceId: string): Promise<any> { return fetchOrganizer(`/resources/${resourceId}`, { method: 'DELETE' }); },

  // ---------- Timeline / Phases ----------
  async createPhase(hackathonId: string, data: { name: string; order: number; startsAt: string; endsAt: string; description?: string }): Promise<any> { const res = await fetchOrganizer(`/hackathons/${hackathonId}/phases`, { method: 'POST', body: JSON.stringify(data) }); return unwrapData<any>(res); },
  async listPhases(hackathonId: string): Promise<any[]> { const res = await fetchOrganizer(`/hackathons/${hackathonId}/phases`); return unwrapData<any[]>(res) ?? []; },
  async updatePhase(phaseId: string, data: any): Promise<any> { const res = await fetchOrganizer(`/phases/${phaseId}`, { method: 'PATCH', body: JSON.stringify(data) }); return unwrapData<any>(res); },
  async deletePhase(phaseId: string): Promise<any> { return fetchOrganizer(`/phases/${phaseId}`, { method: 'DELETE' }); },

  // ---------- Evaluation criteria ----------
  async createCriteria(hackathonId: string, data: { name: string; description?: string; weight: number; maxScore?: number }): Promise<any> { const res = await fetchOrganizer(`/hackathons/${hackathonId}/evaluation-criteria`, { method: 'POST', body: JSON.stringify(data) }); return unwrapData<any>(res); },
  async listCriteria(hackathonId: string): Promise<any[]> { const res = await fetchOrganizer(`/hackathons/${hackathonId}/evaluation-criteria`); return unwrapData<any[]>(res) ?? []; },
  async updateCriteria(criteriaId: string, data: any): Promise<any> { const res = await fetchOrganizer(`/evaluation-criteria/${criteriaId}`, { method: 'PATCH', body: JSON.stringify(data) }); return unwrapData<any>(res); },
  async deleteCriteria(criteriaId: string): Promise<any> { return fetchOrganizer(`/evaluation-criteria/${criteriaId}`, { method: 'DELETE' }); },

  // ---------- Participants / Teams / Projects ----------
  async listParticipants(hackathonId: string): Promise<any[]> { const res = await fetchOrganizer(`/hackathons/${hackathonId}/participants`); return unwrapData<any[]>(res) ?? []; },
  async listTeams(hackathonId: string): Promise<any[]> { const res = await fetchOrganizer(`/hackathons/${hackathonId}/teams`); return unwrapData<any[]>(res) ?? []; },
  async listProjects(hackathonId: string): Promise<any[]> { const res = await fetchOrganizer(`/hackathons/${hackathonId}/projects`); return unwrapData<any[]>(res) ?? []; },
  async getPrivateRepo(teamId: string): Promise<any> { return fetchOrganizer(`/teams/${teamId}/private-repo`); },
  async seedDemo(hackathonId: string): Promise<any> { return fetchOrganizer(`/hackathons/${hackathonId}/seed-demo`, { method: 'POST', body: JSON.stringify({}) }); },

  // ---------- Mentor assignments ----------
  async assignMentor(hackathonId: string, data: { mentorId: string; teamId: string }): Promise<any> { const res = await fetchOrganizer(`/hackathons/${hackathonId}/mentor-assignments`, { method: 'POST', body: JSON.stringify(data) }); return unwrapData<any>(res); },
  async listMentorAssignments(hackathonId: string): Promise<any[]> { const res = await fetchOrganizer(`/hackathons/${hackathonId}/mentor-assignments`); return unwrapData<any[]>(res) ?? []; },
  async listMentorTeams(mentorId: string): Promise<any[]> { const res = await fetchOrganizer(`/mentors/${mentorId}/teams`); return unwrapData<any[]>(res) ?? []; },

  // ---------- Mentor feedback ----------
  async submitFeedback(data: { teamId: string; projectId?: string | null; hackathonId: string; score: number; remarks: string; reason: string; strengths?: string[]; weaknesses?: string[]; technicalFeedback?: string | null; productFeedback?: string | null; recommendation?: string | null; phase: string }): Promise<any> { const res = await fetchOrganizer('/mentor/feedback', { method: 'POST', body: JSON.stringify(data) }); return unwrapData<any>(res); },
  async getFeedback(id: string): Promise<any> { const res = await fetchOrganizer(`/mentor/feedback/${id}`); return unwrapData<any>(res); },
  async listFeedbacks(hackathonId: string): Promise<any[]> { const res = await fetchOrganizer(`/hackathons/${hackathonId}/feedbacks`); return unwrapData<any[]>(res) ?? []; },
  async correctFeedback(id: string, data: any): Promise<any> { const res = await fetchOrganizer(`/mentor/feedback/${id}/correct`, { method: 'POST', body: JSON.stringify(data) }); return unwrapData<any>(res); },
  async reviewFeedback(id: string): Promise<any> { const res = await fetchOrganizer(`/mentor/feedback/${id}/review`, { method: 'POST', body: JSON.stringify({}) }); return unwrapData<any>(res); },
  async publishFeedback(id: string): Promise<any> { const res = await fetchOrganizer(`/mentor/feedback/${id}/publish`, { method: 'POST', body: JSON.stringify({}) }); return unwrapData<any>(res); },
  async illegalUpdateFeedback(id: string, data: any): Promise<any> { return fetchOrganizer(`/mentor/feedback/${id}`, { method: 'PUT', body: JSON.stringify(data) }); },
  async listFeedbackVersions(id: string): Promise<any[]> { const res = await fetchOrganizer(`/mentor/feedback/${id}/versions`); return unwrapData<any[]>(res) ?? []; },

  // ---------- Analytics ----------
  async getAnalytics(hackathonId: string): Promise<any> { const res = await fetchOrganizer(`/hackathons/${hackathonId}/analytics`); return unwrapData<any>(res); },

  // ---------- Organizer Home command center (single-call overview) ----------
  async getOverview(): Promise<any> { const res = await fetchOrganizer('/organizer/overview'); return unwrapData<any>(res); },

  // ---------- Audit ----------
  async listAuditLogs(params?: { actorId?: string; action?: string; resourceType?: string; limit?: number }): Promise<any[]> {
    const qs = new URLSearchParams();
    if (params?.actorId) qs.set('actorId', params.actorId);
    if (params?.action) qs.set('action', params.action);
    if (params?.resourceType) qs.set('resourceType', params.resourceType);
    if (params?.limit) qs.set('limit', String(params.limit));
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    const res = await fetchOrganizer(`/audit/logs${suffix}`);
    return unwrapData<any[]>(res) ?? [];
  },
  async getAuditLog(id: string): Promise<any> { const res = await fetchOrganizer(`/audit/logs/${id}`); return unwrapData<any>(res); },
  async tryUpdateAuditLog(id: string): Promise<any> { return fetchOrganizer(`/audit/logs/${id}`, { method: 'PUT', body: JSON.stringify({}) }); },
  async tryDeleteAuditLog(id: string): Promise<any> { return fetchOrganizer(`/audit/logs/${id}`, { method: 'DELETE' }); },

  // ---------- Sync ----------
  async getPublishedEvent(hackathonId: string): Promise<any> { const res = await fetchOrganizer(`/hackathons/${hackathonId}/published-event`); return unwrapData<any>(res); },
  async getParticipantContext(hackathonId: string): Promise<any> { const res = await fetchOrganizer(`/hackathons/${hackathonId}/participant-context`); return unwrapData<any>(res); },
  async getContractSchema(): Promise<any> { const res = await fetchOrganizer('/sync/contract-schema'); return unwrapData<any>(res); },
  async listPublished(): Promise<any[]> { const res = await fetchOrganizer('/sync/published'); return unwrapData<any[]>(res) ?? []; },
  async directDbWrite(): Promise<any> { return fetchOrganizer('/sync/direct-db-write', { method: 'POST', body: JSON.stringify({}) }); },
};

// Friendly status helper for UI
export function isOrganizerApiError(e: unknown): e is OrganizerApiError { return e instanceof OrganizerApiError; }
export function organizerErrorMessage(e: unknown): string {
  if (e instanceof OrganizerApiError) return e.message;
  return (e as Error)?.message || 'Something went wrong';
}
export function isOrganizerTokenReuse(e: unknown): boolean {
  return e instanceof OrganizerApiError && e.code === 'TOKEN_REUSE_DETECTED';
}
