import { z } from 'zod';

/**
 * Versioned event contracts for Organizer ↔ Participant communication.
 * These are the ONLY allowed cross-service contracts.
 * Participant backend MUST NOT depend on undocumented organizer DB tables.
 *
 * Transport: Redis Streams / Pub/Sub (future) OR Postgres outbox; here we define the payload shapes.
 * Each event includes: eventId, version, type, occurredAt, actorId, payload.
 */

export const contractVersionSchema = z.enum(['v1']);
export const eventIdSchema = z.string().min(1);
export const isoDateSchema = z.string().datetime();

const baseEventSchema = z.object({
  eventId: eventIdSchema,
  version: contractVersionSchema,
  occurredAt: isoDateSchema,
  actorId: z.string().min(1).nullable(),
});

// --- Hackathon events ---

export const hackathonPublishedSchema = baseEventSchema.extend({
  type: z.literal('HackathonPublished'),
  payload: z.object({
    hackathonId: z.string().min(1),
    slug: z.string().min(1),
    title: z.string().min(1),
    publishedAt: isoDateSchema,
    phases: z.array(
      z.object({
        phaseId: z.string().min(1),
        name: z.string().min(1),
        startsAt: isoDateSchema,
        endsAt: isoDateSchema,
        order: z.number().int().optional(),
        status: z.string().optional(),
      }),
    ),
    // Rich canonical fields (optional for v1 backward-compat; required for new publishers).
    // Organizer rich event maps 1:1 here; participant consumer upserts the same hackathonId/slug.
    description: z.string().optional(),
    hackathonType: z
      .enum(['PROBLEM_STATEMENT_BASED', 'OPEN_INNOVATION', 'HYBRID'])
      .optional(),
    mode: z.enum(['ONLINE', 'OFFLINE', 'HYBRID']).optional(),
    objective: z.string().optional(),
    audience: z.string().optional(),
    problemStatement: z.string().nullable().optional(),
    rules: z.array(z.string()).optional(),
    constraints: z.array(z.string()).optional(),
    expectedOutcomes: z.array(z.string()).optional(),
    theme: z.string().nullable().optional(),
    themeIds: z.array(z.string()).optional(),
    resources: z
      .array(
        z.object({
          id: z.string().min(1),
          title: z.string().min(1),
          type: z.string().optional(),
          url: z.string().nullable().optional(),
          visibility: z.string().optional(),
        }),
      )
      .optional(),
    judgingCriteria: z
      .array(
        z.object({
          id: z.string().min(1),
          name: z.string().min(1),
          weight: z.number().optional(),
          maxScore: z.number().optional(),
        }),
      )
      .optional(),
    announcements: z.array(z.string()).optional(),
    // Discovery windows (Unstop/Hack2Skill pattern: explicit registration + event dates).
    registrationStart: isoDateSchema.nullable().optional(),
    registrationEnd: isoDateSchema.nullable().optional(),
    eventStart: isoDateSchema.nullable().optional(),
    eventEnd: isoDateSchema.nullable().optional(),
    eligibility: z.array(z.string()).optional(),
    teamSize: z
      .object({
        min: z.number().int().min(1).optional(),
        max: z.number().int().min(1).optional(),
      })
      .optional(),
    category: z.string().optional(),
    tags: z.array(z.string()).optional(),
    organizerName: z.string().optional(),
    hackathonVersion: z.number().int().optional(),
    // GitHub repository requirement for team projects (organizer wizard
    // Step 8 participation config). Optional for v1 backward-compat;
    // absent means OPTIONAL. Metadata only — never an access grant.
    repoRequirement: z.enum(['REQUIRED', 'OPTIONAL', 'DISABLED']).optional(),
  }),
});

// Participant discovery query (Discover → Hackathons list; backend-filtered, never frontend-only).
export const hackathonDiscoveryQuerySchema = z.object({
  search: z.string().max(160).optional(),
  status: z.string().optional(),
  mode: z.enum(['ONLINE', 'OFFLINE', 'HYBRID']).optional(),
  category: z.string().optional(),
  eligibility: z.string().optional(),
  registration: z.enum(['open', 'closed', 'all']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});

export type HackathonDiscoveryQuery = z.infer<
  typeof hackathonDiscoveryQuerySchema
>;

// Registration (Discover → Details → Register → skill-profile check → confirm).
export const hackathonRegistrationSchema = z.object({
  hackathonId: z.string().min(1),
  teamChoice: z.enum(['create', 'join', 'later']).default('later'),
  teamId: z.string().min(1).optional(),
});

export type HackathonRegistrationInput = z.infer<
  typeof hackathonRegistrationSchema
>;

export const hackathonUpdatedSchema = baseEventSchema.extend({
  type: z.literal('HackathonUpdated'),
  payload: z.object({
    hackathonId: z.string().min(1),
    updatedFields: z.array(z.string()),
    updatedAt: isoDateSchema,
  }),
});

export const hackathonArchivedSchema = baseEventSchema.extend({
  type: z.literal('HackathonArchived'),
  payload: z.object({
    hackathonId: z.string().min(1),
    archivedAt: isoDateSchema,
  }),
});

export const hackathonPhaseChangedSchema = baseEventSchema.extend({
  type: z.literal('HackathonPhaseChanged'),
  payload: z.object({
    hackathonId: z.string().min(1),
    previousPhaseId: z.string().nullable(),
    newPhaseId: z.string().min(1),
    changedAt: isoDateSchema,
  }),
});

// --- Team events ---

export const teamCreatedSchema = baseEventSchema.extend({
  type: z.literal('TeamCreated'),
  payload: z.object({
    teamId: z.string().min(1),
    hackathonId: z.string().min(1),
    name: z.string().min(1),
    leaderId: z.string().min(1),
    createdAt: isoDateSchema,
  }),
});

export const teamUpdatedSchema = baseEventSchema.extend({
  type: z.literal('TeamUpdated'),
  payload: z.object({
    teamId: z.string().min(1),
    hackathonId: z.string().min(1),
    updatedFields: z.array(z.string()),
    updatedAt: isoDateSchema,
  }),
});

// --- Mentor / Evaluation / Participant status ---

export const mentorFeedbackSubmittedSchema = baseEventSchema.extend({
  type: z.literal('MentorFeedbackSubmitted'),
  payload: z.object({
    feedbackId: z.string().min(1),
    teamId: z.string().min(1),
    projectId: z.string().nullable(),
    mentorId: z.string().min(1),
    visibility: z.enum(['TEAM_PRIVATE', 'ORGANIZER_PRIVATE', 'PUBLISHED']),
    submittedAt: isoDateSchema,
  }),
});

export const evaluationPublishedSchema = baseEventSchema.extend({
  type: z.literal('EvaluationPublished'),
  payload: z.object({
    evaluationId: z.string().min(1),
    teamId: z.string().min(1),
    projectId: z.string().min(1),
    publishedAt: isoDateSchema,
    // scores are intentionally opaque here; consumer fetches via API if authorized
  }),
});

export const participantStatusChangedSchema = baseEventSchema.extend({
  type: z.literal('ParticipantStatusChanged'),
  payload: z.object({
    participantId: z.string().min(1),
    userId: z.string().min(1),
    hackathonId: z.string().min(1),
    previousStatus: z.string().nullable(),
    newStatus: z.string().min(1),
    changedAt: isoDateSchema,
  }),
});

// Union
export const domainEventSchema = z.discriminatedUnion('type', [
  hackathonPublishedSchema,
  hackathonUpdatedSchema,
  hackathonArchivedSchema,
  hackathonPhaseChangedSchema,
  teamCreatedSchema,
  teamUpdatedSchema,
  mentorFeedbackSubmittedSchema,
  evaluationPublishedSchema,
  participantStatusChangedSchema,
]);

export type DomainEvent = z.infer<typeof domainEventSchema>;
export type HackathonPublishedEvent = z.infer<typeof hackathonPublishedSchema>;
export type HackathonUpdatedEvent = z.infer<typeof hackathonUpdatedSchema>;
export type HackathonArchivedEvent = z.infer<typeof hackathonArchivedSchema>;
export type HackathonPhaseChangedEvent = z.infer<typeof hackathonPhaseChangedSchema>;
export type TeamCreatedEvent = z.infer<typeof teamCreatedSchema>;
export type TeamUpdatedEvent = z.infer<typeof teamUpdatedSchema>;
export type MentorFeedbackSubmittedEvent = z.infer<typeof mentorFeedbackSubmittedSchema>;
export type EvaluationPublishedEvent = z.infer<typeof evaluationPublishedSchema>;
export type ParticipantStatusChangedEvent = z.infer<typeof participantStatusChangedSchema>;

export const ALL_EVENT_TYPES = [
  'HackathonPublished',
  'HackathonUpdated',
  'HackathonArchived',
  'HackathonPhaseChanged',
  'TeamCreated',
  'TeamUpdated',
  'MentorFeedbackSubmitted',
  'EvaluationPublished',
  'ParticipantStatusChanged',
] as const;
