import { randomUUID } from 'crypto';
import type { MentorAssignment, MentorFeedback, FeedbackPublicationStatus } from '../../domain/types';
import { memoryStore } from '../../store/memory.store';
import { auditService } from '../audit/audit.service';

export interface AssignMentorDto {
  mentorId: string;
  teamId: string;
}

export interface SubmitFeedbackDto {
  teamId: string;
  projectId?: string | null;
  hackathonId: string;
  score: number;
  remarks: string;
  reason: string;
  strengths?: string[];
  weaknesses?: string[];
  technicalFeedback?: string | null;
  productFeedback?: string | null;
  recommendation?: string | null;
  phase: string;
}

export class MentorService {
  async assignMentor(hackathonId: string, dto: AssignMentorDto, assignedById: string): Promise<MentorAssignment> {
    const hackathon = memoryStore.hackathons.get(hackathonId);
    if (!hackathon) throw Object.assign(new Error('Hackathon not found'), { statusCode: 404 });
    if (hackathon.organizerId !== assignedById) {
      const user = memoryStore.users.get(assignedById);
      if (user?.role !== 'ADMIN') throw Object.assign(new Error('Not owner'), { statusCode: 403 });
    }
    const mentorUser = memoryStore.users.get(dto.mentorId);
    if (!mentorUser) throw Object.assign(new Error('Mentor user not found'), { statusCode: 404 });
    if (!['MENTOR', 'ADMIN', 'ORGANIZER'].includes(mentorUser.role)) {
      // Allow MENTOR or ADMIN, but also permit ORGANIZER mentors
      throw Object.assign(new Error('User is not a mentor'), { statusCode: 400 });
    }
    const team = memoryStore.teams.get(dto.teamId);
    // If no team in store, allow assignment anyway for flexibility? Create stub team if needed for testing
    // For robustness, create team stub if missing
    if (!team) {
      const stubId = dto.teamId;
      memoryStore.teams.set(stubId, {
        id: stubId,
        hackathonId,
        name: `Team-${stubId.slice(0, 8)}`,
        memberIds: [],
        projectId: null,
        createdAt: new Date().toISOString(),
      });
    } else if (team.hackathonId !== hackathonId) {
      throw Object.assign(new Error('Team does not belong to this hackathon'), { statusCode: 400 });
    }

    const existing = Array.from(memoryStore.mentorAssignments.values()).find(
      (a) => a.hackathonId === hackathonId && a.mentorId === dto.mentorId && a.teamId === dto.teamId,
    );
    if (existing) throw Object.assign(new Error('Mentor already assigned to this team'), { statusCode: 409 });

    const id = randomUUID();
    const assignment: MentorAssignment = {
      id,
      hackathonId,
      mentorId: dto.mentorId,
      teamId: dto.teamId,
      assignedById,
      assignedAt: new Date().toISOString(),
    };
    memoryStore.mentorAssignments.set(id, assignment);
    await auditService.log({
      actorId: assignedById,
      actorRole: 'ORGANIZER',
      action: 'mentor.assigned',
      resourceType: 'mentor_assignment',
      resourceId: id,
      outcome: 'success',
      metadata: { hackathonId, mentorId: dto.mentorId, teamId: dto.teamId },
    });
    return assignment;
  }

  async listAssignments(hackathonId: string): Promise<MentorAssignment[]> {
    return Array.from(memoryStore.mentorAssignments.values()).filter((a) => a.hackathonId === hackathonId);
  }

  async listMentorTeams(mentorId: string): Promise<MentorAssignment[]> {
    return Array.from(memoryStore.mentorAssignments.values()).filter((a) => a.mentorId === mentorId);
  }

  // Mentor submits feedback - must be assigned to team
  async submitFeedback(dto: SubmitFeedbackDto, mentorId: string, authorRole: string): Promise<MentorFeedback> {
    // Check assignment exists
    const assigned = Array.from(memoryStore.mentorAssignments.values()).some(
      (a) => a.hackathonId === dto.hackathonId && a.teamId === dto.teamId && a.mentorId === mentorId,
    );
    if (!assigned && authorRole !== 'ADMIN') {
      // Allow ORGANIZER mentors as well?
      throw Object.assign(new Error('Mentor not assigned to this team'), { statusCode: 403 });
    }

    if (typeof dto.score !== 'number' || dto.score < 0 || dto.score > 10) throw Object.assign(new Error('Score must be 0-10'), { statusCode: 400 });
    if (!dto.remarks?.trim()) throw Object.assign(new Error('remarks required'), { statusCode: 400 });
    if (!dto.reason?.trim()) throw Object.assign(new Error('reason required'), { statusCode: 400 });

    // Ensure hackathon and team exist
    const hackathon = memoryStore.hackathons.get(dto.hackathonId);
    if (!hackathon) throw Object.assign(new Error('Hackathon not found'), { statusCode: 404 });
    const team = memoryStore.teams.get(dto.teamId);
    if (!team) throw Object.assign(new Error('Team not found'), { statusCode: 404 });

    const id = randomUUID();
    const now = new Date().toISOString();
    const feedback: MentorFeedback = {
      id,
      hackathonId: dto.hackathonId,
      teamId: dto.teamId,
      projectId: dto.projectId ?? team.projectId ?? null,
      mentorId,
      authorId: mentorId,
      authorRole: authorRole as any,
      phase: dto.phase,
      score: dto.score,
      remarks: dto.remarks,
      reason: dto.reason,
      strengths: dto.strengths ?? [],
      weaknesses: dto.weaknesses ?? [],
      technicalFeedback: dto.technicalFeedback ?? null,
      productFeedback: dto.productFeedback ?? null,
      recommendation: dto.recommendation ?? null,
      version: 1,
      parentId: null,
      publicationStatus: 'MENTOR_SUBMITTED',
      createdAt: now,
      updatedAt: now,
      isCorrection: false,
    };
    memoryStore.mentorFeedbacks.set(id, feedback);
    await auditService.log({
      actorId: mentorId,
      actorRole: authorRole,
      action: 'mentor.feedback_submitted',
      resourceType: 'mentor_feedback',
      resourceId: id,
      outcome: 'success',
      metadata: { teamId: dto.teamId, hackathonId: dto.hackathonId, score: dto.score, phase: dto.phase },
    });
    // Also emit hackathon feedback audit
    await auditService.log({
      actorId: mentorId,
      actorRole: authorRole,
      action: 'evaluation.created',
      resourceType: 'evaluation',
      resourceId: id,
      outcome: 'success',
      metadata: { hackathonId: dto.hackathonId, teamId: dto.teamId },
    });
    return feedback;
  }

  async getFeedback(id: string, requester: { id: string; role: string }): Promise<MentorFeedback | null> {
    const fb = memoryStore.mentorFeedbacks.get(id);
    if (!fb) return null;
    // Transparency: never expose unpublished to participants
    if (requester.role === 'PARTICIPANT') {
      if (fb.publicationStatus !== 'PUBLISHED') return null; // hide
    }
    // For MENTOR: can see own feedback or assigned teams?
    // ORGANIZER/ADMIN see all in hackathon if owner else via assignment
    return fb;
  }

  async listFeedbacks(hackathonId: string, requester: { id: string; role: string }): Promise<MentorFeedback[]> {
    let list = Array.from(memoryStore.mentorFeedbacks.values()).filter((f) => f.hackathonId === hackathonId);
    if (requester.role === 'PARTICIPANT') {
      list = list.filter((f) => f.publicationStatus === 'PUBLISHED');
      // Only return score, remarks, reason, improvement feedback but not internal?
      // For now filter to published and strip nothing; route will handle projection
    }
    if (requester.role === 'MENTOR') {
      // Mentor sees only own feedbacks or feedbacks for assigned teams
      const assignedTeams = Array.from(memoryStore.mentorAssignments.values())
        .filter((a) => a.mentorId === requester.id && a.hackathonId === hackathonId)
        .map((a) => a.teamId);
      list = list.filter((f) => f.mentorId === requester.id || assignedTeams.includes(f.teamId));
    }
    if (requester.role === 'ORGANIZER') {
      const hackathon = memoryStore.hackathons.get(hackathonId);
      if (hackathon && hackathon.organizerId !== requester.id) {
        const user = memoryStore.users.get(requester.id);
        if (user?.role !== 'ADMIN') {
          // Non-owner organizer sees only published? For simplicity, they see none
          return [];
        }
      }
      // Owner sees all
    }
    // Sort by version descending, then createdAt
    list.sort((a, b) => b.version - a.version || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return list;
  }

  // Immutable correction: create new version, original remains
  async correctFeedback(feedbackId: string, mentorId: string, corrections: Partial<SubmitFeedbackDto> & { score?: number; remarks?: string; reason?: string }): Promise<MentorFeedback> {
    const original = memoryStore.mentorFeedbacks.get(feedbackId);
    if (!original) throw Object.assign(new Error('Feedback not found'), { statusCode: 404 });
    if (original.authorId !== mentorId && memoryStore.users.get(mentorId)?.role !== 'ADMIN') {
      throw Object.assign(new Error('Only original author can correct'), { statusCode: 403 });
    }
    // Ensure original is immutable: we do NOT mutate it, we create new version
    const latestVersion = Math.max(
      ...Array.from(memoryStore.mentorFeedbacks.values())
        .filter((f) => f.id === feedbackId || f.parentId === feedbackId || (f.parentId && this.findRootId(f) === feedbackId))
        .map((f) => f.version),
      original.version,
    );
    // Also need to consider chain: find latest in chain
    const chain = Array.from(memoryStore.mentorFeedbacks.values()).filter(
      (f) => f.id === feedbackId || f.parentId === feedbackId || this.isInChain(f, feedbackId),
    );
    const maxVersion = chain.reduce((max, f) => Math.max(max, f.version), original.version);

    const id = randomUUID();
    const now = new Date().toISOString();
    const corrected: MentorFeedback = {
      ...original,
      id,
      score: corrections.score ?? original.score,
      remarks: corrections.remarks ?? original.remarks,
      reason: corrections.reason ?? original.reason,
      strengths: (corrections as any).strengths ?? original.strengths,
      weaknesses: (corrections as any).weaknesses ?? original.weaknesses,
      technicalFeedback: (corrections as any).technicalFeedback !== undefined ? (corrections as any).technicalFeedback : original.technicalFeedback,
      productFeedback: (corrections as any).productFeedback !== undefined ? (corrections as any).productFeedback : original.productFeedback,
      recommendation: (corrections as any).recommendation !== undefined ? (corrections as any).recommendation : original.recommendation,
      version: maxVersion + 1,
      parentId: feedbackId,
      publicationStatus: 'MENTOR_SUBMITTED', // corrections start at submitted again
      createdAt: now,
      updatedAt: now,
      isCorrection: true,
    };
    memoryStore.mentorFeedbacks.set(id, corrected);
    await auditService.log({
      actorId: mentorId,
      actorRole: memoryStore.users.get(mentorId)?.role ?? 'MENTOR',
      action: 'mentor.feedback_corrected',
      resourceType: 'mentor_feedback',
      resourceId: id,
      outcome: 'success',
      metadata: { originalId: feedbackId, newVersion: corrected.version, parentId: feedbackId },
    });
    return corrected;
  }

  private findRootId(feedback: MentorFeedback): string {
    let cur: MentorFeedback | undefined = feedback;
    while (cur?.parentId) {
      const parent = memoryStore.mentorFeedbacks.get(cur.parentId);
      if (!parent) break;
      cur = parent;
    }
    return cur?.id ?? feedback.id;
  }

  private isInChain(feedback: MentorFeedback, rootId: string): boolean {
    let cur: MentorFeedback | undefined = feedback;
    const visited = new Set<string>();
    while (cur) {
      if (visited.has(cur.id)) break;
      visited.add(cur.id);
      if (cur.id === rootId) return true;
      if (!cur.parentId) break;
      cur = memoryStore.mentorFeedbacks.get(cur.parentId);
      if (!cur) break;
      if (cur.id === rootId) return true;
    }
    return false;
  }

  // Organizer reviews feedback: MENTOR_SUBMITTED -> ORGANIZER_REVIEWED
  async reviewFeedback(feedbackId: string, organizerId: string): Promise<MentorFeedback> {
    const fb = memoryStore.mentorFeedbacks.get(feedbackId);
    if (!fb) throw Object.assign(new Error('Feedback not found'), { statusCode: 404 });
    const hackathon = memoryStore.hackathons.get(fb.hackathonId);
    if (!hackathon) throw Object.assign(new Error('Hackathon not found'), { statusCode: 404 });
    if (hackathon.organizerId !== organizerId) {
      const user = memoryStore.users.get(organizerId);
      if (user?.role !== 'ADMIN') throw Object.assign(new Error('Not owner'), { statusCode: 403 });
    }
    if (fb.publicationStatus !== 'MENTOR_SUBMITTED') {
      throw Object.assign(new Error(`Feedback is ${fb.publicationStatus}, only MENTOR_SUBMITTED can be reviewed`), { statusCode: 400 });
    }
    const updated: MentorFeedback = { ...fb, publicationStatus: 'ORGANIZER_REVIEWED', updatedAt: new Date().toISOString() };
    memoryStore.mentorFeedbacks.set(feedbackId, updated);
    await auditService.log({
      actorId: organizerId,
      actorRole: 'ORGANIZER',
      action: 'mentor.feedback_reviewed',
      resourceType: 'mentor_feedback',
      resourceId: feedbackId,
      outcome: 'success',
      metadata: { teamId: fb.teamId, mentorId: fb.mentorId },
    });
    await auditService.log({
      actorId: organizerId,
      actorRole: 'ORGANIZER',
      action: 'feedback.publication',
      resourceType: 'mentor_feedback',
      resourceId: feedbackId,
      outcome: 'success',
      metadata: { stage: 'ORGANIZER_REVIEWED' },
    });
    return updated;
  }

  // Organizer publishes feedback: ORGANIZER_REVIEWED -> PUBLISHED
  async publishFeedback(feedbackId: string, organizerId: string): Promise<MentorFeedback> {
    const fb = memoryStore.mentorFeedbacks.get(feedbackId);
    if (!fb) throw Object.assign(new Error('Feedback not found'), { statusCode: 404 });
    const hackathon = memoryStore.hackathons.get(fb.hackathonId);
    if (!hackathon) throw Object.assign(new Error('Hackathon not found'), { statusCode: 404 });
    if (hackathon.organizerId !== organizerId) {
      const user = memoryStore.users.get(organizerId);
      if (user?.role !== 'ADMIN') throw Object.assign(new Error('Not owner'), { statusCode: 403 });
    }
    if (fb.publicationStatus !== 'ORGANIZER_REVIEWED') {
      throw Object.assign(new Error(`Feedback is ${fb.publicationStatus}, must be ORGANIZER_REVIEWED before publishing`), { statusCode: 400 });
    }
    const updated: MentorFeedback = { ...fb, publicationStatus: 'PUBLISHED', updatedAt: new Date().toISOString() };
    memoryStore.mentorFeedbacks.set(feedbackId, updated);
    await auditService.log({
      actorId: organizerId,
      actorRole: 'ORGANIZER',
      action: 'mentor.feedback_published',
      resourceType: 'mentor_feedback',
      resourceId: feedbackId,
      outcome: 'success',
      metadata: { teamId: fb.teamId, publishedAt: updated.updatedAt },
    });
    await auditService.log({
      actorId: organizerId,
      actorRole: 'ORGANIZER',
      action: 'feedback.publication',
      resourceType: 'mentor_feedback',
      resourceId: feedbackId,
      outcome: 'success',
      metadata: { stage: 'PUBLISHED', visibleTo: 'participant' },
    });
    return updated;
  }

  // Attempt to illegally edit original directly (should be blocked)
  async illegalDirectEdit(feedbackId: string, organizerId: string, _updates: any): Promise<never> {
    const fb = memoryStore.mentorFeedbacks.get(feedbackId);
    if (!fb) throw Object.assign(new Error('Feedback not found'), { statusCode: 404 });
    // Organizer CANNOT edit mentor's original evaluation directly
    throw Object.assign(new Error("Organizer cannot edit mentor's original evaluation. Create a correction record instead."), { statusCode: 403 });
  }

  async listFeedbackVersions(rootId: string): Promise<MentorFeedback[]> {
    const all = Array.from(memoryStore.mentorFeedbacks.values());
    // Find chain
    const chain = all.filter((f) => f.id === rootId || f.parentId === rootId || this.isInChain(f, rootId));
    // Include newer corrections that have parentId chain
    // Also need to find leaf corrections
    // Simplify: collect all that are connected via parentId traversal
    const resultSet = new Map<string, MentorFeedback>();
    for (const f of chain) resultSet.set(f.id, f);
    // Also traverse from any feedback that eventually leads to root
    for (const f of all) {
      if (this.isInChain(f, rootId)) resultSet.set(f.id, f);
    }
    const sorted = Array.from(resultSet.values()).sort((a, b) => a.version - b.version);
    return sorted;
  }
}

export const mentorService = new MentorService();
