import { ORGANIZER_API_BASE } from '@/services/api-config';
import { ApiClient, unwrap } from '@/services/backendApi';

export { ApiError as OrganizerApiError, ACCESS_TOKEN_KEY as ORGANIZER_ACCESS_KEY, REFRESH_TOKEN_KEY as ORGANIZER_REFRESH_KEY } from '@/services/backendApi';

const organizerClient = new ApiClient(ORGANIZER_API_BASE, 'organizer');
const fetchOrganizer = (endpoint: string, init?: RequestInit) => organizerClient.request(endpoint, init);

export type OrganizerMe = { id: string; email: string; role: string; displayName?: string; fullName?: string; [k:string]: any };
export type OrganizerAuthResponse = { user?: OrganizerMe; accessToken: string; refreshToken?: string; expiresIn?: number; [k:string]: any };

export const organizerApi = {
  async register(data: { email: string; password: string; displayName?: string; fullName?: string; role?: string; phoneNumber: string }): Promise<OrganizerAuthResponse> {
    return organizerClient.startSession('/auth/register', {
      email: data.email,
      password: data.password,
      displayName: data.displayName || data.fullName,
      fullName: data.fullName || data.displayName,
      role: data.role || 'ORGANIZER',
      phoneNumber: data.phoneNumber,
    });
  },
  async login(data: { email: string; password: string }): Promise<OrganizerAuthResponse> { return organizerClient.startSession('/auth/login', data); },
  async getMe(): Promise<OrganizerMe> {
    const unwrapped: any = unwrap<any>(await fetchOrganizer('/auth/me'));
    return unwrapped?.user ?? unwrapped;
  },
  async refresh(refreshToken?: string): Promise<OrganizerAuthResponse> { return organizerClient.refresh(refreshToken); },
  async requestPhoneOtp(phoneNumber: string): Promise<{ message: string; expiresIn?: string; phoneOtp?: string }> {
    return fetchOrganizer('/auth/phone/request-otp', { method: 'POST', body: JSON.stringify({ phoneNumber }) });
  },
  async verifyPhoneOtp(phoneNumber: string, otp: string): Promise<{ message: string }> {
    return fetchOrganizer('/auth/phone/verify', { method: 'POST', body: JSON.stringify({ phoneNumber, otp }) });
  },
  async forgotPassword(email: string): Promise<any> {
    return fetchOrganizer('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) });
  },
  async logout(): Promise<any> { return organizerClient.endSession('/auth/logout'); },

  async listHackathons(): Promise<any[]> { const res = await fetchOrganizer('/hackathons'); return unwrap<any[]>(res) ?? []; },
  async getHackathon(id: string): Promise<any> { const res = await fetchOrganizer(`/hackathons/${id}`); return unwrap<any>(res); },
  async createHackathonManual(data: any): Promise<any> { const res = await fetchOrganizer('/hackathons', { method: 'POST', body: JSON.stringify(data) }); return unwrap<any>(res); },
  async generateDraft(data: any): Promise<{ hackathon: any; draft: any }> { const res = await fetchOrganizer('/hackathons/draft/generate', { method: 'POST', body: JSON.stringify(data) }); return unwrap<any>(res); },
  async generateWizard(data: { mode: string; about: string; hackathonType: string; eligibility: string[]; customEligibility?: string | null; durationPlus: string }): Promise<{ hackathon: any; draft: any }> {
    const res = await fetchOrganizer('/hackathons/wizard/generate', { method: 'POST', body: JSON.stringify(data) });
    return unwrap<any>(res);
  },
  async regenerateSection(id: string, section: string, instruction?: string | null): Promise<{ hackathon: any; section: string; provenance: string }> {
    const res = await fetchOrganizer(`/hackathons/${id}/regenerate-section`, { method: 'POST', body: JSON.stringify({ section, instruction: instruction ?? null }) });
    return unwrap<any>(res);
  },
  async updateHackathon(id: string, data: any): Promise<any> { const res = await fetchOrganizer(`/hackathons/${id}`, { method: 'PATCH', body: JSON.stringify(data) }); return unwrap<any>(res); },
  async transitionReview(id: string): Promise<any> { const res = await fetchOrganizer(`/hackathons/${id}/review`, { method: 'POST', body: JSON.stringify({}) }); return unwrap<any>(res); },
  async transitionConfirm(id: string): Promise<any> { const res = await fetchOrganizer(`/hackathons/${id}/confirm`, { method: 'POST', body: JSON.stringify({}) }); return unwrap<any>(res); },
  async transitionPublish(id: string): Promise<{ hackathon: any; publishedEvent: any }> { const res = await fetchOrganizer(`/hackathons/${id}/publish`, { method: 'POST', body: JSON.stringify({}) }); return unwrap<any>(res); },
  async transitionArchive(id: string): Promise<any> { const res = await fetchOrganizer(`/hackathons/${id}/archive`, { method: 'POST', body: JSON.stringify({}) }); return unwrap<any>(res); },
  async getIdeation(id: string): Promise<OrganizerIdeationConfig> { const res = await fetchOrganizer(`/hackathons/${id}/ideation`); return unwrap<OrganizerIdeationConfig>(res); },
  async updateIdeation(id: string, config: OrganizerIdeationConfig): Promise<OrganizerIdeationConfig> { const res = await fetchOrganizer(`/hackathons/${id}/ideation`, { method: 'PUT', body: JSON.stringify(config) }); return unwrap<OrganizerIdeationConfig>(res); },

  async listThemes(): Promise<any[]> { const res = await fetchOrganizer('/themes'); return unwrap<any[]>(res) ?? []; },
  async createTheme(data: { name: string; description?: string }): Promise<any> { const res = await fetchOrganizer('/themes', { method: 'POST', body: JSON.stringify(data) }); return unwrap<any>(res); },
  async assignThemeToHackathon(hackathonId: string, themeId: string): Promise<any> { return fetchOrganizer(`/hackathons/${hackathonId}/themes`, { method: 'POST', body: JSON.stringify({ themeId }) }); },
  async seedThemes(): Promise<any[]> { const res = await fetchOrganizer('/themes/seed-defaults', { method: 'POST', body: JSON.stringify({}) }); return unwrap<any[]>(res) ?? []; },

  async createResource(hackathonId: string, data: any): Promise<any> { const res = await fetchOrganizer(`/hackathons/${hackathonId}/resources`, { method: 'POST', body: JSON.stringify(data) }); return unwrap<any>(res); },
  async listResources(hackathonId: string): Promise<any[]> { const res = await fetchOrganizer(`/hackathons/${hackathonId}/resources`); return unwrap<any[]>(res) ?? []; },

  async createPhase(hackathonId: string, data: { name: string; order: number; startsAt: string; endsAt: string; description?: string }): Promise<any> { const res = await fetchOrganizer(`/hackathons/${hackathonId}/phases`, { method: 'POST', body: JSON.stringify(data) }); return unwrap<any>(res); },
  async listPhases(hackathonId: string): Promise<any[]> { const res = await fetchOrganizer(`/hackathons/${hackathonId}/phases`); return unwrap<any[]>(res) ?? []; },
  async materializeTimeline(hackathonId: string, window: { eventStart: string; eventEnd: string }): Promise<{ hackathon: any; phases: any[] }> { const res = await fetchOrganizer(`/hackathons/${hackathonId}/timeline/materialize`, { method: 'POST', body: JSON.stringify(window) }); return unwrap<any>(res); },
  async updatePhase(phaseId: string, data: any): Promise<any> { const res = await fetchOrganizer(`/phases/${phaseId}`, { method: 'PATCH', body: JSON.stringify(data) }); return unwrap<any>(res); },
  async deletePhase(phaseId: string): Promise<any> { return fetchOrganizer(`/phases/${phaseId}`, { method: 'DELETE' }); },

  async createCriteria(hackathonId: string, data: { name: string; description?: string; weight: number; maxScore?: number }): Promise<any> { const res = await fetchOrganizer(`/hackathons/${hackathonId}/evaluation-criteria`, { method: 'POST', body: JSON.stringify(data) }); return unwrap<any>(res); },
  async listCriteria(hackathonId: string): Promise<any[]> { const res = await fetchOrganizer(`/hackathons/${hackathonId}/evaluation-criteria`); return unwrap<any[]>(res) ?? []; },
  async updateCriteria(criteriaId: string, data: any): Promise<any> { const res = await fetchOrganizer(`/evaluation-criteria/${criteriaId}`, { method: 'PATCH', body: JSON.stringify(data) }); return unwrap<any>(res); },
  async deleteCriteria(criteriaId: string): Promise<any> { return fetchOrganizer(`/evaluation-criteria/${criteriaId}`, { method: 'DELETE' }); },

  async listParticipants(hackathonId: string): Promise<any[]> { const res = await fetchOrganizer(`/hackathons/${hackathonId}/participants`); return unwrap<any[]>(res) ?? []; },
  async listTeams(hackathonId: string): Promise<any[]> { const res = await fetchOrganizer(`/hackathons/${hackathonId}/teams`); return unwrap<any[]>(res) ?? []; },
  async getPrivateRepo(teamId: string): Promise<any> { return fetchOrganizer(`/teams/${teamId}/private-repo`); },
  async seedDemo(hackathonId: string): Promise<any> { return fetchOrganizer(`/hackathons/${hackathonId}/seed-demo`, { method: 'POST', body: JSON.stringify({}) }); },

  async assignMentor(hackathonId: string, data: { mentorId: string; teamId: string }): Promise<any> { const res = await fetchOrganizer(`/hackathons/${hackathonId}/mentor-assignments`, { method: 'POST', body: JSON.stringify(data) }); return unwrap<any>(res); },
  async listMentorAssignments(hackathonId: string): Promise<any[]> { const res = await fetchOrganizer(`/hackathons/${hackathonId}/mentor-assignments`); return unwrap<any[]>(res) ?? []; },
  async listMentorTeams(mentorId: string): Promise<any[]> { const res = await fetchOrganizer(`/mentors/${mentorId}/teams`); return unwrap<any[]>(res) ?? []; },

  async submitFeedback(data: { teamId: string; projectId?: string | null; hackathonId: string; score: number; remarks: string; reason: string; strengths?: string[]; weaknesses?: string[]; technicalFeedback?: string | null; productFeedback?: string | null; recommendation?: string | null; phase: string }): Promise<any> { const res = await fetchOrganizer('/mentor/feedback', { method: 'POST', body: JSON.stringify(data) }); return unwrap<any>(res); },
  async listFeedbacks(hackathonId: string): Promise<any[]> { const res = await fetchOrganizer(`/hackathons/${hackathonId}/feedbacks`); return unwrap<any[]>(res) ?? []; },
  async correctFeedback(id: string, data: any): Promise<any> { const res = await fetchOrganizer(`/mentor/feedback/${id}/correct`, { method: 'POST', body: JSON.stringify(data) }); return unwrap<any>(res); },
  async reviewFeedback(id: string): Promise<any> { const res = await fetchOrganizer(`/mentor/feedback/${id}/review`, { method: 'POST', body: JSON.stringify({}) }); return unwrap<any>(res); },
  async publishFeedback(id: string): Promise<any> { const res = await fetchOrganizer(`/mentor/feedback/${id}/publish`, { method: 'POST', body: JSON.stringify({}) }); return unwrap<any>(res); },
  async illegalUpdateFeedback(id: string, data: any): Promise<any> { return fetchOrganizer(`/mentor/feedback/${id}`, { method: 'PUT', body: JSON.stringify(data) }); },
  async listFeedbackVersions(id: string): Promise<any[]> { const res = await fetchOrganizer(`/mentor/feedback/${id}/versions`); return unwrap<any[]>(res) ?? []; },

  async getAnalytics(hackathonId: string): Promise<any> { const res = await fetchOrganizer(`/hackathons/${hackathonId}/analytics`); return unwrap<any>(res); },

  async getOverview(): Promise<any> { const res = await fetchOrganizer('/organizer/overview'); return unwrap<any>(res); },

  async listAuditLogs(params?: { actorId?: string; action?: string; resourceType?: string; limit?: number }): Promise<any[]> {
    const qs = new URLSearchParams();
    if (params?.actorId) qs.set('actorId', params.actorId);
    if (params?.action) qs.set('action', params.action);
    if (params?.resourceType) qs.set('resourceType', params.resourceType);
    if (params?.limit) qs.set('limit', String(params.limit));
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    const res = await fetchOrganizer(`/audit/logs${suffix}`);
    return unwrap<any[]>(res) ?? [];
  },
  async getAuditLog(id: string): Promise<any> { const res = await fetchOrganizer(`/audit/logs/${id}`); return unwrap<any>(res); },
  async tryUpdateAuditLog(id: string): Promise<any> { return fetchOrganizer(`/audit/logs/${id}`, { method: 'PUT', body: JSON.stringify({}) }); },
  async tryDeleteAuditLog(id: string): Promise<any> { return fetchOrganizer(`/audit/logs/${id}`, { method: 'DELETE' }); },
};

export type OrganizerIdeationRound = { title: string; goal: string; questions: string[]; exitCriteria: string };
export type OrganizerIdeationConfig = { currentRound: number; rounds: OrganizerIdeationRound[]; extraInstructions?: string };
