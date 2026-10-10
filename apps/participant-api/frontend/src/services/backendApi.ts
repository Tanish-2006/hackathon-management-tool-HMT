// Centralized Participant API client — Shared system (Agent 3)
// Base: participant-api Nest (port 3000, prefix /api/v1). See api-config.ts.
// Handles: base URL, auth headers, request IDs, timeout, typed contracts, error handling
import { PARTICIPANT_API_BASE, API_TIMEOUT_MS } from '@/services/api-config';
const BASE_URL = PARTICIPANT_API_BASE;

const REQUEST_TIMEOUT_MS = API_TIMEOUT_MS;
export const ACCESS_TOKEN_KEY = 'hmt_access_token';
export const REFRESH_TOKEN_KEY = 'hmt_refresh_token';

// Unified API error with status code for friendly handling
export class ApiError extends Error {
  status: number;
  code?: string;
  details?: unknown;
  constructor(message: string, status: number, code?: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function friendlyMessage(status: number, raw?: string, code?: string): string {
  // TOKEN_REUSE detection is critical UX: keep precise message
  if (code === 'TOKEN_REUSE_DETECTED' || raw?.includes('TOKEN_REUSE') || raw?.includes('Token reuse')) {
    return 'Security alert: token reuse detected. All sessions have been revoked. Please sign in again.';
  }
  if (raw && raw.length < 180 && !raw.includes('stack') && !raw.includes(' at ') ) return raw;
  switch (status) {
    case 400: return raw || 'Invalid request. Please check your input.';
    case 401: return raw?.includes('Invalid credentials') ? 'Invalid email or password.' : (raw || 'Session expired. Please sign in again.');
    case 403: return 'You do not have permission for this action.';
    case 404: return 'Requested resource was not found.';
    case 409: return raw || 'Conflict — already exists or already in team.';
    case 422: return raw || 'Validation failed. Please check your input.';
    case 429: return 'Too many requests. Please wait a moment.';
    case 500: return 'Server error. Please try again later.';
    default: return raw || 'Something went wrong. Please try again.';
  }
}

function getRequestId(): string {
  try {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return (crypto as any).randomUUID();
  } catch {}
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function getTokens() {
  if (typeof window === 'undefined') return { access: null, refresh: null } as const;
  return {
    access: localStorage.getItem(ACCESS_TOKEN_KEY),
    refresh: localStorage.getItem(REFRESH_TOKEN_KEY),
  };
}

export function setAuthTokens(tokens: { accessToken?: string; refreshToken?: string; token?: string }) {
  if (typeof window === 'undefined') return;
  const access = tokens.accessToken || tokens.token;
  if (access) localStorage.setItem(ACCESS_TOKEN_KEY, access);
  if (tokens.refreshToken) localStorage.setItem(REFRESH_TOKEN_KEY, tokens.refreshToken);
}

export function clearAuthTokens() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
  // also clear legacy variants for safety
  localStorage.removeItem('hmt_refresh_token_legacy');
}

function isTokenReuseError(message?: string, code?: string) {
  return code === 'TOKEN_REUSE_DETECTED' || !!message?.includes('TOKEN_REUSE') || !!message?.includes('Token reuse');
}

export async function fetchWithAuth(endpoint: string, options: RequestInit = {}) {
  const { access } = getTokens();
  const hasBody = options.body !== undefined && options.body !== null;
  const requestId = getRequestId();
  const headers: Record<string, string> = {
    ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
    'X-Request-Id': requestId,
    'X-Correlation-Id': requestId,
    ...(access ? { Authorization: `Bearer ${access}` } : {}),
    ...(options.headers as Record<string, string>),
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${endpoint}`, {
      ...options,
      headers,
      signal: controller.signal,
    });
  } catch (e: any) {
    clearTimeout(timeout);
    if (e?.name === 'AbortError') {
      throw new ApiError('Request timed out. Please check your connection and try again.', 408, 'TIMEOUT');
    }
    throw new ApiError(e?.message || 'Network error. Please check your connection.', 0, 'NETWORK_ERROR');
  }
  clearTimeout(timeout);

  // propagate request id from response if available
  const responseRequestId = response.headers.get('x-request-id');

  if (!response.ok) {
    let body: any = {};
    let rawMessage: string | undefined;
    let code: string | undefined;
    try {
      const text = await response.text();
      if (text) {
        try { body = JSON.parse(text); } catch { body = { message: text }; }
      }
    } catch { body = { message: response.statusText }; }
    rawMessage = body?.error?.message || body?.message || body?.error || response.statusText;
    code = body?.error?.code || body?.code || body?.errorCode;
    // handle wrapped error object like { error:{code, message}}
    if (body?.error && typeof body.error === 'string') rawMessage = body.error;
    // TOKEN_REUSE_DETECTED handling — clear tokens immediately for security
    if (response.status === 401 && isTokenReuseError(rawMessage, code)) {
      clearAuthTokens();
      throw new ApiError(friendlyMessage(response.status, rawMessage, 'TOKEN_REUSE_DETECTED'), response.status, 'TOKEN_REUSE_DETECTED', { ...body, requestId: responseRequestId || requestId });
    }
    // 401 expired session — let caller redirect; do not auto-clear unless reuse
    const msg = friendlyMessage(response.status, rawMessage, code);
    throw new ApiError(msg, response.status, code, { ...body, requestId: responseRequestId || requestId });
  }

  // 204 no content
  if (response.status === 204) return null;
  const text = await response.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text as any; }
}

// Helpers to extract data shape safely (some endpoints wrap in {data: ...})
function unwrap<T>(res: any): T {
  if (res == null) return res as T;
  if (res.data !== undefined) return res.data as T;
  return res as T;
}

// ---------- Typed contracts ----------
export type RegisterInput = { email: string; password: string; fullName: string; phoneNumber: string };
export type LoginInput = { email: string; password: string };
export type MeResponse = { id: string; email: string; fullName: string; role: string; isEmailVerified?: boolean; phoneNumber?: string | null; isPhoneVerified?: boolean; profile?: any; teamMemberships?: any[]; [k:string]: any };
export type AuthResponse = {
  user: MeResponse;
  accessToken: string;
  refreshToken: string;
  expiresIn?: number;
  sessionId?: string;
  jti?: string;
  verificationToken?: string;
  phoneOtp?: string; // Phase 1: dev-only raw OTP (absent in production)
  token?: string; // legacy
};

export const hmtBackendService = {
  // ---------- Auth ----------
  async register(data: RegisterInput): Promise<AuthResponse> {
    const res: any = await fetchWithAuth('/auth/register', { method: 'POST', body: JSON.stringify(data) });
    const tokens = { accessToken: res.accessToken || res.token, refreshToken: res.refreshToken };
    if (tokens.accessToken) localStorage.setItem(ACCESS_TOKEN_KEY, tokens.accessToken);
    if (tokens.refreshToken) localStorage.setItem(REFRESH_TOKEN_KEY, tokens.refreshToken);
    // legacy support
    if (res.token && !tokens.accessToken) localStorage.setItem(ACCESS_TOKEN_KEY, res.token);
    return res as AuthResponse;
  },
  async login(credentials: LoginInput): Promise<AuthResponse> {
    const res: any = await fetchWithAuth('/auth/login', { method: 'POST', body: JSON.stringify(credentials) });
    const tokens = { accessToken: res.accessToken || res.token, refreshToken: res.refreshToken };
    if (tokens.accessToken) localStorage.setItem(ACCESS_TOKEN_KEY, tokens.accessToken);
    if (tokens.refreshToken) localStorage.setItem(REFRESH_TOKEN_KEY, tokens.refreshToken);
    if (res.token && !tokens.accessToken) localStorage.setItem(ACCESS_TOKEN_KEY, res.token);
    return res as AuthResponse;
  },
  async getMe(): Promise<MeResponse> {
    const res = await fetchWithAuth('/auth/me');
    // backend returns user object directly
    return unwrap<MeResponse>(res);
  },
  async refresh(refreshToken?: string): Promise<AuthResponse> {
    const token = refreshToken || (typeof window !== 'undefined' ? localStorage.getItem(REFRESH_TOKEN_KEY) : null);
    if (!token) throw new ApiError('Missing refresh token. Please sign in again.', 401, 'MISSING_REFRESH_TOKEN');
    const res: any = await fetchWithAuth('/auth/refresh', { method: 'POST', body: JSON.stringify({ refreshToken: token }) });
    if (res.accessToken) localStorage.setItem(ACCESS_TOKEN_KEY, res.accessToken);
    if (res.token) localStorage.setItem(ACCESS_TOKEN_KEY, res.token);
    if (res.refreshToken) localStorage.setItem(REFRESH_TOKEN_KEY, res.refreshToken);
    return res as AuthResponse;
  },
  async requestVerification(): Promise<{ message: string; verificationToken?: string; expiresIn?: string }> {
    return fetchWithAuth('/auth/request-verification', { method: 'POST', body: JSON.stringify({}) });
  },
  async verifyEmail(token: string): Promise<{ message: string }> {
    return fetchWithAuth('/auth/verify-email', { method: 'POST', body: JSON.stringify({ token }) });
  },
  // Phase 1 phone identity: OTP resend + verify (JWT required).
  async requestPhoneOtp(phoneNumber: string): Promise<{ message: string; expiresIn?: string; phoneOtp?: string }> {
    return fetchWithAuth('/auth/phone/request-otp', { method: 'POST', body: JSON.stringify({ phoneNumber }) });
  },
  async verifyPhoneOtp(phoneNumber: string, otp: string): Promise<{ message: string }> {
    return fetchWithAuth('/auth/phone/verify', { method: 'POST', body: JSON.stringify({ phoneNumber, otp }) });
  },
  async forgotPassword(email: string): Promise<{ message: string; resetToken?: string }> {
    return fetchWithAuth('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) });
  },
  async resetPassword(token: string, newPassword: string): Promise<{ message: string }> {
    return fetchWithAuth('/auth/reset-password', { method: 'POST', body: JSON.stringify({ token, newPassword }) });
  },
  async logout(): Promise<{ message: string } | null> {
    const refresh = typeof window !== 'undefined' ? localStorage.getItem(REFRESH_TOKEN_KEY) : null;
    try {
      const res = await fetchWithAuth('/auth/logout', { method: 'POST', body: JSON.stringify(refresh ? { refreshToken: refresh } : {}) });
      clearAuthTokens();
      return res;
    } catch (e) {
      clearAuthTokens();
      throw e;
    }
  },
  async logoutAll(): Promise<{ message: string } | null> {
    try {
      const res = await fetchWithAuth('/auth/logout-all', { method: 'POST', body: JSON.stringify({}) });
      clearAuthTokens();
      return res;
    } catch (e) {
      clearAuthTokens();
      throw e;
    }
  },
  async getSessions(): Promise<any> {
    return fetchWithAuth('/auth/sessions');
  },
  async revokeSession(familyId: string): Promise<any> {
    return fetchWithAuth('/auth/sessions/revoke', { method: 'POST', body: JSON.stringify({ familyId }) });
  },
  logoutLocal() { clearAuthTokens(); },

  // ---------- Hackathons (Discover → Details → Register → My) ----------
  async getCurrentHackathon(): Promise<any> { const res = await fetchWithAuth('/hackathons/current'); return unwrap<any>(res); },
  async listHackathons(params: Record<string,string|number>={}): Promise<any> {
    const qs = new URLSearchParams(Object.fromEntries(Object.entries(params).map(([k,v])=>[k,String(v)]))).toString();
    const res = await fetchWithAuth(`/hackathons${qs?'?'+qs:''}`);
    // Preserve the {data, pagination} envelope (unwrap() would drop pagination,
    // breaking total counts). The sole caller handles both shapes.
    if (res && Array.isArray(res.data)) return res;
    return unwrap<any>(res);
  },
  async getHackathonById(id: string): Promise<any> { const res = await fetchWithAuth(`/hackathons/${id}`); return unwrap<any>(res); },
  async getHackathonResources(id: string): Promise<any> { const res = await fetchWithAuth(`/hackathons/${id}/resources`); return unwrap<any>(res); },
  async getHackathonAnnouncements(id: string): Promise<any> { const res = await fetchWithAuth(`/hackathons/${id}/announcements`); return unwrap<any>(res); },
  async getHackathonPhases(id: string): Promise<any> { const res = await fetchWithAuth(`/hackathons/${id}/phases`); return unwrap<any>(res); },
  async getProblemStatement(id: string): Promise<any> { const res = await fetchWithAuth(`/hackathons/${id}/problem-statement`); return unwrap<any>(res); },
  async registerForHackathon(id: string, data: { teamChoice?: string; teamId?: string }={}): Promise<any> {
    const res = await fetchWithAuth(`/hackathons/${id}/register`, { method: 'POST', body: JSON.stringify(data) }); return unwrap<any>(res);
  },
  async getMyHackathons(bucket?: string): Promise<any> {
    const qs = bucket ? `?bucket=${encodeURIComponent(bucket)}` : '';
    const res = await fetchWithAuth(`/hackathons/my${qs}`); return unwrap<any>(res);
  },
  async getMyRegistrations(): Promise<any> { const res = await fetchWithAuth('/hackathons/registrations/me'); return unwrap<any>(res); },
  // Sync recovery: ask the participant backend to pull the organizer outbox
  // (server defaults for organizer address + shared secret apply). Used when
  // discovery is unexpectedly empty — never fabricates records.
  async pullSync(limit = 50): Promise<any> { const res = await fetchWithAuth('/sync/pull', { method: 'POST', body: JSON.stringify({ limit }) }); return unwrap<any>(res); },
  async getAiAccessStatus(projectId?: string, hackathonId?: string): Promise<any> {
    const params = new URLSearchParams({
      ...(projectId ? { projectId } : {}),
      ...(hackathonId ? { hackathonId } : {}),
    }).toString();
    const res = await fetchWithAuth(`/ai/access-status${params ? `?${params}` : ''}`); return unwrap<any>(res);
  },

  // ---------- Profile & SkillProfile ----------
  async getProfile(): Promise<any> { const res = await fetchWithAuth('/profile'); return unwrap<any>(res); },
  async updateProfile(profileData: any): Promise<any> { const res = await fetchWithAuth('/profile', { method: 'PUT', body: JSON.stringify(profileData) }); return unwrap<any>(res); },
  async getSkillProfile(): Promise<any> { try { const res = await fetchWithAuth('/skill-profile/me'); return unwrap<any>(res);} catch { return null; } },
  async upsertSkillProfile(data: any): Promise<any> { const res = await fetchWithAuth('/skill-profile', { method: 'PUT', body: JSON.stringify(data) }); return unwrap<any>(res); },

  // ---------- Teams (hackathon-scoped: pass hackathonId to stay in context) ----------
  async getMyTeam(hackathonId?: string): Promise<any> {
    const qs = hackathonId ? `?hackathonId=${encodeURIComponent(hackathonId)}` : '';
    const res = await fetchWithAuth(`/team/me${qs}`); return unwrap<any>(res);
  },
  async createTeam(teamData: any): Promise<any> { const res = await fetchWithAuth('/team', { method: 'POST', body: JSON.stringify(teamData) }); return unwrap<any>(res); },
  async discoverTeams(params: Record<string,string>={}): Promise<any> {
    const qs = new URLSearchParams(params).toString();
    const res = await fetchWithAuth(`/team/discover${qs?'?'+qs:''}`); return unwrap<any>(res);
  },
  async getTeamById(id: string): Promise<any> { const res = await fetchWithAuth(`/team/${id}`); return unwrap<any>(res); },
  async getMatchCandidates(hackathonId?: string): Promise<any> {
    const qs = hackathonId ? `?hackathonId=${encodeURIComponent(hackathonId)}` : '';
    const res = await fetchWithAuth(`/team/match/candidates${qs}`); return unwrap<any>(res);
  },
  async joinTeam(teamId: string): Promise<any> { const res = await fetchWithAuth('/team/join', { method: 'POST', body: JSON.stringify({ teamId }) }); return unwrap<any>(res); },
  async joinByCode(data: { teamName: string; tid: string; hackathonId: string }): Promise<any> { const res = await fetchWithAuth('/team/join-by-code', { method: 'POST', body: JSON.stringify(data) }); return unwrap<any>(res); },
  // Join requests (leader-approved; TID-less path)
  async requestToJoinTeam(teamId: string, data: { message?: string; skillRole?: string; skillLanguages?: string; skillExperience?: string; skillContribution?: string } = {}): Promise<any> { const res = await fetchWithAuth('/team/join-requests', { method: 'POST', body: JSON.stringify({ teamId, ...data }) }); return unwrap<any>(res); },
  async getMyJoinRequests(): Promise<any> { const res = await fetchWithAuth('/team/join-requests/me'); return unwrap<any>(res); },
  async getTeamJoinRequests(teamId: string): Promise<any> { const res = await fetchWithAuth(`/team/${teamId}/join-requests`); return unwrap<any>(res); },
  async acceptJoinRequest(requestId: string): Promise<any> { const res = await fetchWithAuth(`/team/join-requests/${requestId}/accept`, { method: 'POST', body: JSON.stringify({}) }); return unwrap<any>(res); },
  async rejectJoinRequest(requestId: string): Promise<any> { const res = await fetchWithAuth(`/team/join-requests/${requestId}/reject`, { method: 'POST', body: JSON.stringify({}) }); return unwrap<any>(res); },
  // Leave requests (member → leader approval; no immediate removal)
  async requestToLeaveTeam(teamId: string): Promise<any> { const res = await fetchWithAuth('/team/leave-requests', { method: 'POST', body: JSON.stringify({ teamId }) }); return unwrap<any>(res); },
  async getMyLeaveRequests(): Promise<any> { const res = await fetchWithAuth('/team/leave-requests/me'); return unwrap<any>(res); },
  async getTeamLeaveRequests(teamId: string): Promise<any> { const res = await fetchWithAuth(`/team/${teamId}/leave-requests`); return unwrap<any>(res); },
  async acceptLeaveRequest(requestId: string): Promise<any> { const res = await fetchWithAuth(`/team/leave-requests/${requestId}/accept`, { method: 'POST', body: JSON.stringify({}) }); return unwrap<any>(res); },
  async rejectLeaveRequest(requestId: string): Promise<any> { const res = await fetchWithAuth(`/team/leave-requests/${requestId}/reject`, { method: 'POST', body: JSON.stringify({}) }); return unwrap<any>(res); },
  async cancelLeaveRequest(requestId: string): Promise<any> { const res = await fetchWithAuth(`/team/leave-requests/${requestId}/cancel`, { method: 'POST', body: JSON.stringify({}) }); return unwrap<any>(res); },
  // Notifications (persisted inbox; drives the bell badge)
  async getNotifications(): Promise<any> { const res = await fetchWithAuth('/notifications'); return unwrap<any>(res); },
  async getUnreadCount(): Promise<any> { const res = await fetchWithAuth('/notifications/unread-count'); return unwrap<any>(res); },
  async markNotificationRead(id: string): Promise<any> { const res = await fetchWithAuth(`/notifications/${id}/read`, { method: 'POST', body: JSON.stringify({}) }); return unwrap<any>(res); },
  async markAllNotificationsRead(): Promise<any> { const res = await fetchWithAuth('/notifications/read-all', { method: 'POST', body: JSON.stringify({}) }); return unwrap<any>(res); },
  async transferLeadership(teamId: string, toUserId: string): Promise<any> { const res = await fetchWithAuth(`/team/${teamId}/transfer`, { method: 'POST', body: JSON.stringify({ toUserId }) }); return unwrap<any>(res); },
  async deleteTeam(teamId: string): Promise<any> { const res = await fetchWithAuth(`/team/${teamId}`, { method: 'DELETE' }); return unwrap<any>(res); },
  async leaveTeam(hackathonId?: string, teamId?: string): Promise<any> {
    const params = new URLSearchParams({
      ...(hackathonId ? { hackathonId } : {}),
      ...(teamId ? { teamId } : {}),
    }).toString();
    const res = await fetchWithAuth(`/team/leave${params ? `?${params}` : ''}`, { method: 'POST', body: JSON.stringify({}) }); return unwrap<any>(res);
  },
  async getMyInvitations(): Promise<any> { const res = await fetchWithAuth('/team/invitations/me'); return unwrap<any>(res); },
  async acceptInvitation(inviteId: string): Promise<any> { const res = await fetchWithAuth(`/team/invitations/${inviteId}/accept`, { method: 'POST', body: JSON.stringify({}) }); return unwrap<any>(res); },
  async declineInvitation(inviteId: string): Promise<any> { const res = await fetchWithAuth(`/team/invitations/${inviteId}/decline`, { method: 'POST', body: JSON.stringify({}) }); return unwrap<any>(res); },
  async inviteToTeam(teamId: string, data: { inviteeEmail: string; message?: string }): Promise<any> { const res = await fetchWithAuth(`/team/${teamId}/invite`, { method: 'POST', body: JSON.stringify(data) }); return unwrap<any>(res); },
  async expressInterest(teamId: string, message?: string): Promise<any> { const res = await fetchWithAuth(`/team/${teamId}/interest`, { method: 'POST', body: JSON.stringify({ message }) }); return unwrap<any>(res); },
  async getTeamInterests(teamId: string): Promise<any> { const res = await fetchWithAuth(`/team/${teamId}/interests`); return unwrap<any>(res); },

  // ---------- Projects (hackathon-scoped: pass hackathonId to stay in context) ----------
  async getMyProject(hackathonId?: string): Promise<any> {
    const qs = hackathonId ? `?hackathonId=${encodeURIComponent(hackathonId)}` : '';
    const res = await fetchWithAuth(`/project/me${qs}`); return unwrap<any>(res);
  },
  async createProject(data: any): Promise<any> { const res = await fetchWithAuth('/project', { method: 'POST', body: JSON.stringify(data) }); return unwrap<any>(res); },
  async updateProject(id: string, data: any): Promise<any> { const res = await fetchWithAuth(`/project/${id}`, { method: 'PUT', body: JSON.stringify(data) }); return unwrap<any>(res); },
  async getProjectById(id: string): Promise<any> { const res = await fetchWithAuth(`/project/${id}`); return unwrap<any>(res); },
  async getProjectMilestones(projectId: string): Promise<any> { const res = await fetchWithAuth(`/project/${projectId}/milestones`); return unwrap<any>(res); },
  async createMilestone(projectId: string, data: any): Promise<any> { const res = await fetchWithAuth(`/project/${projectId}/milestones`, { method: 'POST', body: JSON.stringify(data) }); return unwrap<any>(res); },
  async connectRepo(repoData: any): Promise<any> { const res = await fetchWithAuth('/team/repository', { method: 'POST', body: JSON.stringify(repoData) }); return unwrap<any>(res); },
  async connectRepositoryAccess(data: any): Promise<any> { const res = await fetchWithAuth('/repository-access/connect', { method: 'POST', body: JSON.stringify(data) }); return unwrap<any>(res); },

  // ---------- AI Teammate (hackathon-scoped: pass hackathonId so one
  // hackathon's team/project is never used to authorize another's) ----------
  async askAITeammate(message: string, opts?: { projectId?: string; conversationId?: string; hackathonId?: string }): Promise<any> {
    const res = await fetchWithAuth('/ai/chat', { method: 'POST', body: JSON.stringify({ message, projectId: opts?.projectId, conversationId: opts?.conversationId, hackathonId: opts?.hackathonId }) });
    return unwrap<any>(res);
  },
  async getAIRecommendations(): Promise<any> { const res = await fetchWithAuth('/ai/recommendations'); return unwrap<any>(res); },
  async getAIConversations(projectId?: string, hackathonId?: string): Promise<any> {
    const params = new URLSearchParams({
      ...(projectId ? { projectId } : {}),
      ...(hackathonId ? { hackathonId } : {}),
    }).toString();
    const res = await fetchWithAuth(`/ai/conversations${params ? `?${params}` : ''}`);
    return unwrap<any>(res);
  },
  async getAIConversation(id: string): Promise<any> { const res = await fetchWithAuth(`/ai/conversations/${id}`); return unwrap<any>(res); },
  async createAIConversation(data: { title?: string; initialMessage: string; projectId?: string; hackathonId?: string }): Promise<any> { const res = await fetchWithAuth('/ai/conversations', { method: 'POST', body: JSON.stringify(data) }); return unwrap<any>(res); },
  async postAIConversationMessage(conversationId: string, message: string, projectId?: string, hackathonId?: string): Promise<any> { const res = await fetchWithAuth(`/ai/conversations/${conversationId}/messages`, { method: 'POST', body: JSON.stringify({ message, projectId, hackathonId }) }); return unwrap<any>(res); },
  async createAnalysisJob(projectId: string, type?: string, hackathonId?: string): Promise<any> { const res = await fetchWithAuth('/ai/analysis-jobs', { method: 'POST', body: JSON.stringify({ projectId, type, hackathonId }) }); return unwrap<any>(res); },
  async getAnalysisJob(id: string): Promise<any> { const res = await fetchWithAuth(`/ai/analysis-jobs/${id}`); return unwrap<any>(res); },
  async listAnalysisJobs(projectId?: string, hackathonId?: string): Promise<any> {
    const params = new URLSearchParams({
      ...(projectId ? { projectId } : {}),
      ...(hackathonId ? { hackathonId } : {}),
    }).toString();
    const res = await fetchWithAuth(`/ai/analysis-jobs${params ? `?${params}` : ''}`);
    return unwrap<any>(res);
  },

  // ---------- GitHub (real backend via backendApi) ----------
  async getGitHubAuthUrl(): Promise<{ authorizationUrl: string; provider?: string }> {
    const res = await fetchWithAuth('/github/auth'); return unwrap<any>(res);
  },
  async getGitHubAppInstallUrl(): Promise<{ installationUrl: string; provider?: string }> {
    try { const res = await fetchWithAuth('/github/app/install'); return unwrap<any>(res);} catch { // fallback to auth url
      const res = await fetchWithAuth('/github/auth'); const r = unwrap<any>(res); return { installationUrl: r.authorizationUrl, provider: r.provider };
    }
  },
  async handleGitHubCallback(code: string, state: string): Promise<any> {
    const qs = new URLSearchParams({ code, state }).toString();
    const res = await fetchWithAuth(`/github/callback?${qs}`); return unwrap<any>(res);
  },
  async getGitHubMe(): Promise<any> { const res = await fetchWithAuth('/github/me'); return unwrap<any>(res); },
  async getGitHubRepositories(): Promise<any[]> { const res = await fetchWithAuth('/github/repositories'); const d = unwrap<any>(res); return Array.isArray(d) ? d : (d.repositories || d.repos || []); },
  async getGitHubConnections(): Promise<any[]> { const res = await fetchWithAuth('/github/connections'); const d = unwrap<any>(res); return Array.isArray(d) ? d : (d.connections || []); },
  async connectGitHubRepository(data: { teamId: string; projectId: string; repoFullName: string }): Promise<any> { const res = await fetchWithAuth('/github/connections', { method: 'POST', body: JSON.stringify(data) }); return unwrap<any>(res); },
  async grantAiAccess(data: { teamId: string; projectId: string }): Promise<any> { const res = await fetchWithAuth('/github/grants', { method: 'POST', body: JSON.stringify(data) }); return unwrap<any>(res); },
  async revokeAiAccess(grantId: string, data: { teamId: string; projectId: string }): Promise<any> { const res = await fetchWithAuth(`/github/grants/${grantId}/revoke`, { method: 'POST', body: JSON.stringify(data) }); return unwrap<any>(res); },
  async grantRepositoryAccess(projectId: string): Promise<any> { const res = await fetchWithAuth('/repository-access/grant', { method: 'POST', body: JSON.stringify({ projectId }) }); return unwrap<any>(res); },
  async revokeRepositoryAccess(grantId: string): Promise<any> { const res = await fetchWithAuth('/repository-access/revoke', { method: 'POST', body: JSON.stringify({ grantId }) }); return unwrap<any>(res); },
  async checkRepositoryAccess(projectId: string): Promise<any> { const res = await fetchWithAuth(`/repository-access/check/${projectId}`); return unwrap<any>(res); },
  async getRepositoryAccessHistory(projectId: string): Promise<any> { const res = await fetchWithAuth(`/repository-access/history/${projectId}`); return unwrap<any>(res); },

  // ---------- Repository analysis ----------
  async analyzeRepo(): Promise<any> { const res = await fetchWithAuth('/repository/analyze', { method: 'POST', body: JSON.stringify({}) }); return unwrap<any>(res); },
  async getFindings(): Promise<any> { const res = await fetchWithAuth('/repository/findings'); return unwrap<any>(res); },

  // ---------- Performance & Feedback ----------
  async getTimeline(projectId?: string): Promise<any> {
    const qs = projectId ? `?projectId=${encodeURIComponent(projectId)}` : '';
    const res = await fetchWithAuth(`/performance/timeline${qs}`); return unwrap<any>(res);
  },
  async getPerformanceFeedback(projectId?: string): Promise<any> {
    const qs = projectId ? `?projectId=${projectId}` : '';
    const res = await fetchWithAuth(`/performance/feedback${qs}`); return unwrap<any>(res);
  },
  async getPerformanceEvaluations(projectId?: string): Promise<any> {
    const qs = projectId ? `?projectId=${projectId}` : '';
    const res = await fetchWithAuth(`/performance/evaluations${qs}`); return unwrap<any>(res);
  },
  async getPerformanceMistakes(projectId?: string): Promise<any> {
    const qs = projectId ? `?projectId=${projectId}` : '';
    const res = await fetchWithAuth(`/performance/mistakes${qs}`); return unwrap<any>(res);
  },
  async getPerformancePhaseProgress(projectId?: string): Promise<any> {
    const qs = projectId ? `?projectId=${projectId}` : '';
    const res = await fetchWithAuth(`/performance/phase-progress${qs}`); return unwrap<any>(res);
  },
  async getImprovementAreas(projectId?: string): Promise<any> {
    const qs = projectId ? `?projectId=${projectId}` : '';
    const res = await fetchWithAuth(`/performance/improvement-areas${qs}`); return unwrap<any>(res);
  },
  async getPerformanceHistory(projectId?: string): Promise<any> {
    const qs = projectId ? `?projectId=${encodeURIComponent(projectId)}` : '';
    const res = await fetchWithAuth(`/performance/history${qs}`); return unwrap<any>(res);
  },
  async getPerformanceHistoryByProject(projectId: string): Promise<any> { const res = await fetchWithAuth(`/performance/history/${projectId}`); return unwrap<any>(res); },
  async getEliminationAnalysis(projectId?: string): Promise<any> {
    const qs = projectId ? `?projectId=${encodeURIComponent(projectId)}` : '';
    const res = await fetchWithAuth(`/performance/elimination-analysis${qs}`); return unwrap<any>(res);
  },

  async getIdeation(hackathonId: string): Promise<IdeationState> { const res = await fetchWithAuth(`/ideation/${encodeURIComponent(hackathonId)}`); return unwrap<IdeationState>(res); },

  // ---------- Post-hackathon ----------
  async getRoadmap(): Promise<any> { const res = await fetchWithAuth('/post-hackathon/roadmap', { method: 'POST', body: JSON.stringify({}) }); return unwrap<any>(res); },
};

// Helpers for outside usage (guards, checks)
export function isApiError(e: unknown): e is ApiError { return e instanceof ApiError; }
export function getStoredAccessToken(): string | null { return typeof window !== 'undefined' ? localStorage.getItem(ACCESS_TOKEN_KEY) : null; }
export function getStoredRefreshToken(): string | null { return typeof window !== 'undefined' ? localStorage.getItem(REFRESH_TOKEN_KEY) : null; }
export function isTokenReuseDetected(e: unknown): boolean {
  if (e instanceof ApiError) return e.code === 'TOKEN_REUSE_DETECTED';
  const msg = (e as Error)?.message || '';
  return msg.includes('TOKEN_REUSE') || msg.includes('Token reuse');
}

export type IdeationScope = 'team' | 'personal';
export type IdeationRound = { title: string; goal: string; questions: string[]; exitCriteria: string };
export type IdeationConfig = { currentRound: number; rounds: IdeationRound[]; extraInstructions?: string };
export type IdeationMessage = { id: string; role: 'user' | 'assistant'; content: string; round: number; authorId: string | null; authorName: string | null; createdAt: string };
export type IdeationTeam = { id: string; name: string; members: Array<{ id: string; name: string }> };
export type IdeationState = {
  hackathon: { id: string; title: string };
  ideation: IdeationConfig;
  currentRound: number;
  configured: boolean;
  team: IdeationTeam | null;
  teamThread: IdeationMessage[] | null;
  personalThread: IdeationMessage[];
};
export type IdeationStreamEvent =
  | { event: 'start'; data: { round: number; scope: IdeationScope } }
  | { event: 'delta'; data: { text: string } }
  | { event: 'done'; data: { userMessageId: string; assistantMessageId: string | null; round: number } }
  | { event: 'error'; data: { message: string } };

export async function streamIdeationMessage(
  hackathonId: string,
  body: { scope: IdeationScope; content: string },
  onEvent: (event: IdeationStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const send = () => {
    const { access } = getTokens();
    return fetch(`${BASE_URL}/ideation/${encodeURIComponent(hackathonId)}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', 'X-Request-Id': getRequestId(), ...(access ? { Authorization: `Bearer ${access}` } : {}) },
      body: JSON.stringify(body),
      signal,
    });
  };
  let response = await send();
  if (response.status === 401 && getTokens().refresh) {
    await hmtBackendService.refresh();
    response = await send();
  }
  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => '');
    let parsed: any = {};
    try { parsed = text ? JSON.parse(text) : {}; } catch { parsed = { message: text }; }
    const raw = parsed?.error?.message ?? parsed?.message;
    const message = Array.isArray(raw) ? raw.join(', ') : raw;
    throw new ApiError(friendlyMessage(response.status, message), response.status, parsed?.error?.code);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
    let boundary = buffer.indexOf('\n\n');
    while (boundary !== -1) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf('\n\n');
      const event = block.match(/^event: ?(.*)$/m)?.[1]?.trim();
      const data = block.match(/^data: ?(.*)$/m)?.[1];
      if (!event || data === undefined) continue;
      let payload: unknown;
      try { payload = JSON.parse(data); } catch { continue; }
      onEvent({ event, data: payload } as IdeationStreamEvent);
    }
  }
}
