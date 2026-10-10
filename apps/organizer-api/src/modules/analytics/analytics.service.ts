import { memoryStore } from '../../store/memory.store';
import type { OrganizerAnalytics } from '../../domain/types';

export class AnalyticsService {
  async getAnalytics(hackathonId: string, organizerId: string): Promise<OrganizerAnalytics> {
    const hackathon = memoryStore.hackathons.get(hackathonId);
    if (!hackathon) throw Object.assign(new Error('Hackathon not found'), { statusCode: 404 });
    if (hackathon.organizerId !== organizerId) {
      const user = memoryStore.users.get(organizerId);
      if (user?.role !== 'ADMIN') throw Object.assign(new Error('Not owner'), { statusCode: 403 });
    }
    const participants = Array.from(memoryStore.participants.values()).filter((p) => p.hackathonId === hackathonId);
    const teams = Array.from(memoryStore.teams.values()).filter((t) => t.hackathonId === hackathonId);
    const projects = Array.from(memoryStore.projects.values()).filter((p) => p.hackathonId === hackathonId);
    const phases = Array.from(memoryStore.phases.values())
      .filter((p) => p.hackathonId === hackathonId)
      .sort((a, b) => a.order - b.order)
      .map((p) => ({ phaseId: p.id, name: p.name, status: p.status, startsAt: p.startsAt, endsAt: p.endsAt }));
    const feedbacks = Array.from(memoryStore.mentorFeedbacks.values()).filter((f) => f.hackathonId === hackathonId);
    const assignments = Array.from(memoryStore.mentorAssignments.values()).filter((a) => a.hackathonId === hackathonId);
    const submitted = projects.filter((p) => (p as any).status === 'SUBMITTED' || (p as any).demoUrl || (p as any).repoUrl).length;
    const notSubmitted = teams.length - submitted;
    // Clamp: submitted counts projects while denominator counts teams — a team
    // with multiple projects could otherwise push the rate above 1.
    const submissionRate = teams.length === 0 ? 0 : Math.min(submitted / teams.length, 1);
    const published = feedbacks.filter((f) => f.publicationStatus === 'PUBLISHED').length;
    const pendingReview = feedbacks.filter((f) => f.publicationStatus === 'MENTOR_SUBMITTED').length;
    const unpublished = feedbacks.filter((f) => f.publicationStatus !== 'PUBLISHED').length;
    const completed = feedbacks.filter((f) => f.score !== null && f.remarks).length;
    const totalAssignments = assignments.length;
    const completionRate = totalAssignments === 0 ? 0 : Math.min(feedbacks.length / totalAssignments, 1);
    const analytics: OrganizerAnalytics = {
      hackathonId,
      participantCount: participants.length,
      teamCount: teams.length,
      projectCount: projects.length,
      phaseProgress: phases,
      submissionStatus: { totalTeams: teams.length, submitted, notSubmitted: Math.max(notSubmitted, 0), submissionRate: Number(submissionRate.toFixed(2)) },
      evaluationStatus: { totalFeedbacks: feedbacks.length, published, pendingReview, unpublished },
      feedbackCompletion: { totalAssignments, completed, completionRate: Number(completionRate.toFixed(2)) },
      generatedAt: new Date().toISOString(),
    };
    return analytics;
  }
}

export const analyticsService = new AnalyticsService();
