import type {
  Hackathon,
  Theme,
  HackathonResource,
  HackathonPhase,
  EvaluationCriteria,
  MentorAssignment,
  MentorFeedback,
  AuditLogEntry,
  HackathonPublishedEvent,
  HackathonStatus,
} from '../domain/types';
import { randomUUID } from 'crypto';
import { PgMapStore } from '@hmt/common';

// Central in-memory store. All services share this singleton.
// In production this would delegate to @hmt/database Postgres + Prisma.
// For tests / demo we keep it in memory with deterministic behavior.

export class MemoryStore {
  // Core maps
  users = new Map<string, any>();
  sessions = new Map<string, any>(); // sessionId -> { tokenHash etc }
  // Phase 1 phone OTP: otpHash -> { id, userId, phoneNumber, otpHash, expiresAt, attempts, isUsed }
  phoneVerifications = new Map<string, any>();
  // OTP resend cooldown: sha256(phoneNumber) -> cooldown expiry epoch ms
  otpCooldowns = new Map<string, number>();

  hackathons = new Map<string, Hackathon>();
  themes = new Map<string, Theme>();
  resources = new Map<string, HackathonResource>();
  phases = new Map<string, HackathonPhase>();
  evaluationCriteria = new Map<string, EvaluationCriteria>();
  mentorAssignments = new Map<string, MentorAssignment>();
  mentorFeedbacks = new Map<string, MentorFeedback>();
  // For immutability, we keep feedback versions separate but same map
  auditLogs = new Map<string, AuditLogEntry>();
  publishedEvents = new Map<string, HackathonPublishedEvent>(); // hackathonId -> latest event; also store by eventId
  publishedEventsById = new Map<string, HackathonPublishedEvent>();
  // Outbox for organizer → participant sync (canonical transport).
  // Publish appends here; participant consumer drains via GET /sync/outbox or /sync/published.
  // Future: Postgres outbox + Redis Streams; in-memory keeps same contract.
  outbox: Array<{ eventId: string; type: string; hackathonId: string; occurredAt: string; payload: unknown }> = [];

  // Simulated participant/team/project for analytics & participant views
  // These are intentionally shallow to respect privacy boundaries.
  // Organizer can view participants/teams/projects but not private repo contents.
  participants = new Map<string, any>(); // participantId -> { id, userId, hackathonId, teamId, etc }
  teams = new Map<string, any>(); // teamId -> { id, hackathonId, name, memberIds, projectId }
  projects = new Map<string, any>(); // projectId -> { id, teamId, hackathonId, title, description, repoUrlPrivate? }
  // For demo seeding
  teamMembers = new Map<string, any>(); // teamMemberId -> { teamId, userId }

  // Hackathon ownership index
  hackathonBySlug = new Map<string, string>(); // slug -> hackathonId

  clear() {
    this.users.clear();
    this.sessions.clear();
    this.phoneVerifications.clear();
    this.otpCooldowns.clear();
    this.hackathons.clear();
    this.themes.clear();
    this.resources.clear();
    this.phases.clear();
    this.evaluationCriteria.clear();
    this.mentorAssignments.clear();
    this.mentorFeedbacks.clear();
    this.auditLogs.clear();
    this.publishedEvents.clear();
    this.publishedEventsById.clear();
    this.outbox = [];
    this.participants.clear();
    this.teams.clear();
    this.projects.clear();
    this.teamMembers.clear();
    this.hackathonBySlug.clear();
  }

  async persistTo(connectionString: string): Promise<PgMapStore> {
    const store = new PgMapStore(connectionString, 'organizer');
    for (const [name, value] of Object.entries(this)) {
      if (value instanceof Map) await store.attachMap(name, value);
    }
    await store.attachValue(
      'outbox',
      () => this.outbox,
      (value) => {
        this.outbox = value;
      },
    );
    store.start();
    return store;
  }

  // Helpers to enforce append-only audit
  addAudit(entry: AuditLogEntry) {
    // No update/delete allowed, only create
    this.auditLogs.set(entry.id, entry);
  }

  // Hackathon state transition validation
  canTransition(from: HackathonStatus, to: HackathonStatus): boolean {
    // Keep in sync with HackathonService.allowedTransitions: archive is
    // terminal and reachable ONLY from PUBLISHED.
    const allowed: Record<HackathonStatus, HackathonStatus[]> = {
      DRAFT: ['REVIEW'],
      REVIEW: ['DRAFT', 'CONFIRMED'],
      CONFIRMED: ['PUBLISHED', 'REVIEW'],
      PUBLISHED: ['ARCHIVED'],
      ARCHIVED: [], // terminal
    };
    return allowed[from]?.includes(to) ?? false;
  }

  // Generate slug from title
  generateSlug(title: string): string {
    const base = title
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    let slug = base || `hackathon-${randomUUID().slice(0, 8)}`;
    // ensure uniqueness
    let suffix = 0;
    let candidate = slug;
    while (this.hackathonBySlug.has(candidate)) {
      suffix += 1;
      candidate = `${slug}-${suffix}`;
    }
    return candidate;
  }

  // Timeline validation: phases must not overlap, start < end, sequential order
  validateTimeline(phases: Array<{ startsAt: string; endsAt: string; order: number }>): { valid: boolean; error?: string } {
    if (phases.length === 0) return { valid: true };
    // Check each phase start < end
    for (const p of phases) {
      const s = new Date(p.startsAt).getTime();
      const e = new Date(p.endsAt).getTime();
      if (isNaN(s) || isNaN(e)) return { valid: false, error: `Invalid date for phase order ${p.order}` };
      if (s >= e) return { valid: false, error: `Phase order ${p.order}: startsAt must be before endsAt` };
    }
    // Check ordering and no overlap
    const sorted = [...phases].sort((a, b) => a.order - b.order);
    for (let i = 0; i < sorted.length - 1; i++) {
      const curEnd = new Date(sorted[i].endsAt).getTime();
      const nextStart = new Date(sorted[i + 1].startsAt).getTime();
      if (curEnd > nextStart) {
        // Include the actual conflicting ranges so a rejection is self-diagnosing:
        // it shows stored data, which may differ from what the form displayed.
        return { valid: false, error: `Phases overlap between order ${sorted[i].order} (ends ${sorted[i].endsAt}) and ${sorted[i + 1].order} (starts ${sorted[i + 1].startsAt})` };
      }
      // also ensure order sequential
      if (sorted[i + 1].order !== sorted[i].order + 1) {
        // allow gaps? but require strictly increasing; we allow non-consecutive but must be increasing
        if (sorted[i + 1].order <= sorted[i].order) {
          return { valid: false, error: `Phase order must be strictly increasing` };
        }
      }
    }
    return { valid: true };
  }
}

// Singleton instance
export const memoryStore = new MemoryStore();
export type Store = MemoryStore;
