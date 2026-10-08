import { describe, it, expect } from 'vitest';
import { domainEventSchema, ALL_EVENT_TYPES, hackathonArchivedSchema } from './events';
import { healthResponseSchema } from './api';

describe('contracts - events', () => {
  it('lists all 9 event types', () => {
    expect(ALL_EVENT_TYPES).toEqual(
      expect.arrayContaining([
        'HackathonPublished',
        'HackathonUpdated',
        'HackathonArchived',
        'HackathonPhaseChanged',
        'TeamCreated',
        'TeamUpdated',
        'MentorFeedbackSubmitted',
        'EvaluationPublished',
        'ParticipantStatusChanged',
      ]),
    );
    expect(ALL_EVENT_TYPES.length).toBe(9);
  });

  it('validates HackathonArchived v1', () => {
    const res = hackathonArchivedSchema.safeParse({
      eventId: 'evt-a',
      version: 'v1',
      type: 'HackathonArchived',
      occurredAt: new Date().toISOString(),
      actorId: 'u1',
      payload: { hackathonId: 'h1', archivedAt: new Date().toISOString() },
    });
    expect(res.success).toBe(true);
  });

  it('validates HackathonPublished v1', () => {
    const evt = {
      eventId: 'evt-1',
      version: 'v1' as const,
      type: 'HackathonPublished' as const,
      occurredAt: new Date().toISOString(),
      actorId: 'u1',
      payload: {
        hackathonId: 'h1',
        slug: 'hack-1',
        title: 'Hack',
        publishedAt: new Date().toISOString(),
        phases: [{ phaseId: 'p1', name: 'ideation', startsAt: new Date().toISOString(), endsAt: new Date().toISOString() }],
      },
    };
    expect(domainEventSchema.safeParse(evt).success).toBe(true);
  });

  it('rejects unknown type', () => {
    const bad: any = {
      eventId: 'e',
      version: 'v1',
      type: 'UnknownEvent',
      occurredAt: new Date().toISOString(),
      actorId: null,
      payload: {},
    };
    expect(domainEventSchema.safeParse(bad).success).toBe(false);
  });
});

describe('contracts - api', () => {
  it('health schema ok', () => {
    const h = {
      status: 'ok' as const,
      service: 'participant-api',
      version: '0.1.0',
      uptimeSeconds: 10,
      checks: { api: 'ok' as const, postgres: 'unknown' as const, neo4j: 'unknown' as const, redis: 'unknown' as const },
    };
    expect(healthResponseSchema.safeParse(h).success).toBe(true);
  });
});
