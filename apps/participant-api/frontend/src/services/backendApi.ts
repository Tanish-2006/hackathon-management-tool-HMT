import { PARTICIPANT_API_BASE, API_TIMEOUT_MS } from '@/services/api-config';

export type AuthApi = 'participant' | 'organizer';

export const ACCESS_TOKEN_KEY = 'hmt_access_token';
export const REFRESH_TOKEN_KEY = 'hmt_refresh_token';
const AUTH_API_KEY = 'hmt_auth_api';
const SESSION_REJECTED_STATUSES = new Set([400, 401, 403]);

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string, readonly details?: unknown) {
    super(message);
    this.name = 'ApiError';
  }
}

export function getStoredAccessToken(): string | null { return localStorage.getItem(ACCESS_TOKEN_KEY); }

export function getSessionApi(): AuthApi | null {
  const api = localStorage.getItem(AUTH_API_KEY);
  return api === 'participant' || api === 'organizer' ? api : null;
}

export function markSessionApi(api: AuthApi) { localStorage.setItem(AUTH_API_KEY, api); }

export function clearAuthTokens() {
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
  localStorage.removeItem(AUTH_API_KEY);
}

export function unwrap<T>(res: any): T {
  return res?.data !== undefined ? res.data : res;
}

function isTokenReuse(raw?: string, code?: string) {
  return code === 'TOKEN_REUSE_DETECTED' || !!raw?.includes('TOKEN_REUSE') || !!raw?.includes('Token reuse');
}

function friendlyMessage(status: number, raw?: string, code?: string): string {
  if (isTokenReuse(raw, code)) return 'Security alert: token reuse detected. All sessions have been revoked. Please sign in again.';
  if (status === 401 && raw && /jwt|token expired|expired token|invalid token|unauthorized/i.test(raw) && !raw.includes('Invalid credentials')) {
    return 'Session expired. Please sign in again.';
  }
  if (raw && raw.length < 180 && !raw.includes('stack') && !raw.includes(' at ')) return raw;
  switch (status) {
    case 400: return raw || 'Invalid request. Please check your input.';
    case 401: return raw || 'Session expired. Please sign in again.';
    case 403: return 'You do not have permission for this action.';
    case 404: return 'Requested resource was not found.';
    case 409: return raw || 'Conflict — already exists or already in team.';
    case 422: return raw || 'Validation failed. Please check your input.';
    case 429: return 'Too many requests. Please wait a moment.';
    case 500: return 'Server error. Please try again later.';
    default: return raw || 'Something went wrong. Please try again.';
  }
}

function toApiError(status: number, text: string): ApiError {
  let body: any = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { message: text }; }
  const rawField = body?.error?.message ?? body?.message ?? body?.error;
  const raw = Array.isArray(rawField) ? rawField.join(', ') : typeof rawField === 'string' ? rawField : undefined;
  const code = body?.error?.code ?? body?.code ?? body?.errorCode;
  return new ApiError(friendlyMessage(status, raw, code), status, isTokenReuse(raw, code) ? 'TOKEN_REUSE_DETECTED' : code, body);
}

function newRequestId(): string {
  return globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export class ApiClient {
  private pendingRefresh: Promise<boolean> | null = null;

  constructor(private readonly baseUrl: string, readonly api: AuthApi) {}

  async request(endpoint: string, init: RequestInit = {}, allowRefresh = true): Promise<any> {
    let response: Response;
    let text: string;
    try {
      response = await this.send(endpoint, init, allowRefresh, API_TIMEOUT_MS);
      text = await response.text();
    } catch (e: any) {
      if (e?.name === 'TimeoutError' || e?.name === 'AbortError') throw new ApiError('Request timed out. Please check your connection and try again.', 408, 'TIMEOUT');
      throw new ApiError(e?.message || 'Network error. Please check your connection.', 0, 'NETWORK_ERROR');
    }
    if (!response.ok) {
      const error = toApiError(response.status, text);
      if (error.code === 'TOKEN_REUSE_DETECTED') clearAuthTokens();
      throw error;
    }
    if (!text) return null;
    try { return JSON.parse(text); } catch { return text; }
  }

  async send(endpoint: string, init: RequestInit, allowRefresh = true, timeoutMs?: number): Promise<Response> {
    const sentToken = getStoredAccessToken();
    const response = await this.fetchOnce(endpoint, init, timeoutMs);
    if (response.status !== 401 || !allowRefresh || getSessionApi() !== this.api) return response;
    const renewed = sentToken !== getStoredAccessToken() || (await this.refreshSession());
    return renewed ? this.fetchOnce(endpoint, init, timeoutMs) : response;
  }

  async startSession(endpoint: string, payload: unknown): Promise<any> {
    const res = await this.request(endpoint, { method: 'POST', body: JSON.stringify(payload) }, false);
    if (res?.accessToken) {
      localStorage.setItem(ACCESS_TOKEN_KEY, res.accessToken);
      markSessionApi(this.api);
    }
    if (res?.refreshToken) localStorage.setItem(REFRESH_TOKEN_KEY, res.refreshToken);
    return res;
  }

  async endSession(endpoint: string, payload: unknown = {}): Promise<any> {
    try { return await this.request(endpoint, { method: 'POST', body: JSON.stringify(payload) }); }
    finally { clearAuthTokens(); }
  }

  async refresh(refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY)): Promise<any> {
    if (!refreshToken) throw new ApiError('Missing refresh token. Please sign in again.', 401, 'MISSING_REFRESH_TOKEN');
    return this.startSession('/auth/refresh', { refreshToken });
  }

  private refreshSession(): Promise<boolean> {
    this.pendingRefresh ??= this.refresh()
      .then(() => true, (e) => {
        if (SESSION_REJECTED_STATUSES.has(e?.status)) clearAuthTokens();
        return false;
      })
      .finally(() => { this.pendingRefresh = null; });
    return this.pendingRefresh;
  }

  private fetchOnce(endpoint: string, init: RequestInit, timeoutMs?: number): Promise<Response> {
    const token = getStoredAccessToken();
    const requestId = newRequestId();
    return fetch(`${this.baseUrl}${endpoint}`, {
      ...init,
      headers: {
        ...(init.body != null ? { 'Content-Type': 'application/json' } : {}),
        'X-Request-Id': requestId,
        'X-Correlation-Id': requestId,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init.headers as Record<string, string>),
      },
      signal: timeoutMs ? AbortSignal.timeout(timeoutMs) : init.signal,
    });
  }
}

const participantClient = new ApiClient(PARTICIPANT_API_BASE, 'participant');
const fetchWithAuth = (endpoint: string, init?: RequestInit) => participantClient.request(endpoint, init);

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
  phoneOtp?: string;
};

export const hmtBackendService = {
  async register(data: RegisterInput): Promise<AuthResponse> { return participantClient.startSession('/auth/register', data); },
  async login(credentials: LoginInput): Promise<AuthResponse> { return participantClient.startSession('/auth/login', credentials); },
  async getMe(): Promise<MeResponse> { const res = await fetchWithAuth('/auth/me'); return unwrap<MeResponse>(res); },
  async refresh(refreshToken?: string): Promise<AuthResponse> { return participantClient.refresh(refreshToken); },
  async requestPhoneOtp(phoneNumber: string): Promise<{ message: string; expiresIn?: string; phoneOtp?: string }> {
    return fetchWithAuth('/auth/phone/request-otp', { method: 'POST', body: JSON.stringify({ phoneNumber }) });
  },
  async verifyPhoneOtp(phoneNumber: string, otp: string): Promise<{ message: string }> {
    return fetchWithAuth('/auth/phone/verify', { method: 'POST', body: JSON.stringify({ phoneNumber, otp }) });
  },
  async forgotPassword(email: string): Promise<{ message: string; resetToken?: string }> {
    return fetchWithAuth('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) });
  },
  async logout(): Promise<{ message: string } | null> {
    const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
    return participantClient.endSession('/auth/logout', refreshToken ? { refreshToken } : {});
  },

  async getCurrentHackathon(): Promise<any> { const res = await fetchWithAuth('/hackathons/current'); return unwrap<any>(res); },
  async listHackathons(params: Record<string,string|number>={}): Promise<any> {
    const qs = new URLSearchParams(Object.fromEntries(Object.entries(params).map(([k,v])=>[k,String(v)]))).toString();
    const res = await fetchWithAuth(`/hackathons${qs?'?'+qs:''}`);
    if (res && Array.isArray(res.data)) return res;
    return unwrap<any>(res);
  },
  async getHackathonById(id: string): Promise<any> { const res = await fetchWithAuth(`/hackathons/${id}`); return unwrap<any>(res); },
  async registerForHackathon(id: string, data: { teamChoice?: string; teamId?: string }={}): Promise<any> {
    const res = await fetchWithAuth(`/hackathons/${id}/register`, { method: 'POST', body: JSON.stringify(data) }); return unwrap<any>(res);
  },
  async getMyHackathons(bucket?: string): Promise<any> {
    const qs = bucket ? `?bucket=${encodeURIComponent(bucket)}` : '';
    const res = await fetchWithAuth(`/hackathons/my${qs}`); return unwrap<any>(res);
  },
  async getMyRegistrations(): Promise<any> { const res = await fetchWithAuth('/hackathons/registrations/me'); return unwrap<any>(res); },
  async pullSync(limit = 50): Promise<any> { const res = await fetchWithAuth('/sync/pull', { method: 'POST', body: JSON.stringify({ limit }) }); return unwrap<any>(res); },
  async getAiAccessStatus(projectId?: string, hackathonId?: string): Promise<any> {
    const params = new URLSearchParams({
      ...(projectId ? { projectId } : {}),
      ...(hackathonId ? { hackathonId } : {}),
    }).toString();
    const res = await fetchWithAuth(`/ai/access-status${params ? `?${params}` : ''}`); return unwrap<any>(res);
  },

  async getProfile(): Promise<any> { const res = await fetchWithAuth('/profile'); return unwrap<any>(res); },
  async updateProfile(profileData: any): Promise<any> { const res = await fetchWithAuth('/profile', { method: 'PUT', body: JSON.stringify(profileData) }); return unwrap<any>(res); },
  async getSkillProfile(): Promise<any> { try { const res = await fetchWithAuth('/skill-profile/me'); return unwrap<any>(res);} catch { return null; } },
  async upsertSkillProfile(data: any): Promise<any> { const res = await fetchWithAuth('/skill-profile', { method: 'PUT', body: JSON.stringify(data) }); return unwrap<any>(res); },

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
  async requestToJoinTeam(teamId: string, data: { message?: string; skillRole?: string; skillLanguages?: string; skillExperience?: string; skillContribution?: string } = {}): Promise<any> { const res = await fetchWithAuth('/team/join-requests', { method: 'POST', body: JSON.stringify({ teamId, ...data }) }); return unwrap<any>(res); },
  async getMyJoinRequests(): Promise<any> { const res = await fetchWithAuth('/team/join-requests/me'); return unwrap<any>(res); },
  async getTeamJoinRequests(teamId: string): Promise<any> { const res = await fetchWithAuth(`/team/${teamId}/join-requests`); return unwrap<any>(res); },
  async acceptJoinRequest(requestId: string): Promise<any> { const res = await fetchWithAuth(`/team/join-requests/${requestId}/accept`, { method: 'POST', body: JSON.stringify({}) }); return unwrap<any>(res); },
  async rejectJoinRequest(requestId: string): Promise<any> { const res = await fetchWithAuth(`/team/join-requests/${requestId}/reject`, { method: 'POST', body: JSON.stringify({}) }); return unwrap<any>(res); },
  async requestToLeaveTeam(teamId: string): Promise<any> { const res = await fetchWithAuth('/team/leave-requests', { method: 'POST', body: JSON.stringify({ teamId }) }); return unwrap<any>(res); },
  async getMyLeaveRequests(): Promise<any> { const res = await fetchWithAuth('/team/leave-requests/me'); return unwrap<any>(res); },
  async getTeamLeaveRequests(teamId: string): Promise<any> { const res = await fetchWithAuth(`/team/${teamId}/leave-requests`); return unwrap<any>(res); },
  async acceptLeaveRequest(requestId: string): Promise<any> { const res = await fetchWithAuth(`/team/leave-requests/${requestId}/accept`, { method: 'POST', body: JSON.stringify({}) }); return unwrap<any>(res); },
  async rejectLeaveRequest(requestId: string): Promise<any> { const res = await fetchWithAuth(`/team/leave-requests/${requestId}/reject`, { method: 'POST', body: JSON.stringify({}) }); return unwrap<any>(res); },
  async cancelLeaveRequest(requestId: string): Promise<any> { const res = await fetchWithAuth(`/team/leave-requests/${requestId}/cancel`, { method: 'POST', body: JSON.stringify({}) }); return unwrap<any>(res); },
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

  async getMyProject(hackathonId?: string): Promise<any> {
    const qs = hackathonId ? `?hackathonId=${encodeURIComponent(hackathonId)}` : '';
    const res = await fetchWithAuth(`/project/me${qs}`); return unwrap<any>(res);
  },
  async createProject(data: any): Promise<any> { const res = await fetchWithAuth('/project', { method: 'POST', body: JSON.stringify(data) }); return unwrap<any>(res); },
  async updateProject(id: string, data: any): Promise<any> { const res = await fetchWithAuth(`/project/${id}`, { method: 'PUT', body: JSON.stringify(data) }); return unwrap<any>(res); },
  async getProjectMilestones(projectId: string): Promise<any> { const res = await fetchWithAuth(`/project/${projectId}/milestones`); return unwrap<any>(res); },
  async createMilestone(projectId: string, data: any): Promise<any> { const res = await fetchWithAuth(`/project/${projectId}/milestones`, { method: 'POST', body: JSON.stringify(data) }); return unwrap<any>(res); },

  async askAITeammate(message: string, opts?: { projectId?: string; conversationId?: string; hackathonId?: string }): Promise<any> {
    const res = await fetchWithAuth('/ai/chat', { method: 'POST', body: JSON.stringify({ message, projectId: opts?.projectId, conversationId: opts?.conversationId, hackathonId: opts?.hackathonId }) });
    return unwrap<any>(res);
  },
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

  async getGitHubAuthUrl(): Promise<{ authorizationUrl: string; provider?: string }> {
    const res = await fetchWithAuth('/github/auth'); return unwrap<any>(res);
  },
  async getGitHubMe(): Promise<any> { const res = await fetchWithAuth('/github/me'); return unwrap<any>(res); },
  async getGitHubRepositories(): Promise<any[]> { const res = await fetchWithAuth('/github/repositories'); const d = unwrap<any>(res); return Array.isArray(d) ? d : (d.repositories || d.repos || []); },
  async getGitHubConnections(): Promise<any[]> { const res = await fetchWithAuth('/github/connections'); const d = unwrap<any>(res); return Array.isArray(d) ? d : (d.connections || []); },
  async connectGitHubRepository(data: { teamId: string; projectId: string; repoFullName: string }): Promise<any> { const res = await fetchWithAuth('/github/connections', { method: 'POST', body: JSON.stringify(data) }); return unwrap<any>(res); },
  async grantAiAccess(data: { teamId: string; projectId: string }): Promise<any> { const res = await fetchWithAuth('/github/grants', { method: 'POST', body: JSON.stringify(data) }); return unwrap<any>(res); },
  async revokeAiAccess(grantId: string, data: { teamId: string; projectId: string }): Promise<any> { const res = await fetchWithAuth(`/github/grants/${grantId}/revoke`, { method: 'POST', body: JSON.stringify(data) }); return unwrap<any>(res); },
  async checkRepositoryAccess(projectId: string): Promise<any> { const res = await fetchWithAuth(`/repository-access/check/${projectId}`); return unwrap<any>(res); },
  async getRepositoryAccessHistory(projectId: string): Promise<any> { const res = await fetchWithAuth(`/repository-access/history/${projectId}`); return unwrap<any>(res); },

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
  async getEliminationAnalysis(projectId?: string): Promise<any> {
    const qs = projectId ? `?projectId=${encodeURIComponent(projectId)}` : '';
    const res = await fetchWithAuth(`/performance/elimination-analysis${qs}`); return unwrap<any>(res);
  },

  async getIdeation(hackathonId: string): Promise<IdeationState> { const res = await fetchWithAuth(`/ideation/${encodeURIComponent(hackathonId)}`); return unwrap<IdeationState>(res); },
};

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
  const response = await participantClient.send(`/ideation/${encodeURIComponent(hackathonId)}/messages`, {
    method: 'POST',
    headers: { Accept: 'text/event-stream' },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok || !response.body) throw toApiError(response.status, await response.text().catch(() => ''));
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
