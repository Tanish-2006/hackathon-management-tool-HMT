import { timingSafeEqual, createHash } from 'crypto';
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { resolveSyncSecret } from '@hmt/config';
import { syncService } from './sync.service';
import { createAuthGuard, getUser } from '../../shared/guards/auth.guard';
import type { JwtConfig } from '@hmt/security';

function presentSyncSecret(req: FastifyRequest): boolean {
  const presented = req.headers['x-sync-secret'];
  const expected = resolveSyncSecret();
  if (typeof presented !== 'string' || presented.length === 0 || expected.length === 0) return false;
  const a = createHash('sha256').update(presented).digest();
  const b = createHash('sha256').update(expected).digest();
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function syncRoutes(app: FastifyInstance, opts: { jwtConfig: JwtConfig }) {
  const authGuard = createAuthGuard(opts.jwtConfig);
  // Server-to-server read guard: the participant backend pulls the outbox
  // with SYNC_SHARED_SECRET and holds no organizer user JWT. Fall back to
  // the JWT guard for human callers. Secret comparison is constant-time and
  // fail-closed when the secret is unset.
  const syncReadGuard = async (req: FastifyRequest, reply: FastifyReply) => {
    if (presentSyncSecret(req)) return;
    return authGuard(req, reply);
  };

  app.get('/hackathons/:id/published-event', { preHandler: [authGuard] }, async (req, reply) => {
    const { id } = req.params as any;
    try {
      const event = await syncService.getPublishedEvent(id);
      return reply.send({ data: event });
    } catch (e: any) {
      return reply.status(e.statusCode ?? 500).send({ error: { code: 'SYNC_FAILED', message: e.message } });
    }
  });

  app.get('/hackathons/:id/participant-context', { preHandler: [authGuard] }, async (req, reply) => {
    const { id } = req.params as any;
    try {
      const ctx = await syncService.getParticipantContext(id);
      return reply.send({ data: ctx });
    } catch (e: any) {
      return reply.status(e.statusCode ?? 500).send({ error: { code: 'SYNC_FAILED', message: e.message } });
    }
  });

  app.post('/hackathons/:id/consume', { preHandler: [authGuard] }, async (req, reply) => {
    const user = getUser(req as any);
    const { id } = req.params as any;
    try {
      const result = await syncService.consumeAsParticipant(id, user.id);
      return reply.send({ data: result });
    } catch (e: any) {
      return reply.status(e.statusCode ?? 500).send({ error: { code: 'CONSUME_FAILED', message: e.message } });
    }
  });

  app.get('/sync/contract-schema', async (_req, reply) => {
    return reply.send({ data: syncService.getContractSchema() });
  });

  app.get('/sync/published', { preHandler: [syncReadGuard] }, async (_req, reply) => {
    const events = await syncService.listPublishedEvents();
    return reply.send({ data: events });
  });

  // Canonical outbox feed — participant backend polls this (same contract, idempotent by eventId).
  app.get('/sync/outbox', { preHandler: [syncReadGuard] }, async (req, reply) => {
    const { limit } = (req.query as any) ?? {};
    const parsed = limit === undefined ? 100 : Number(limit);
    const safeLimit =
      Number.isFinite(parsed) && parsed > 0
        ? Math.min(Math.floor(parsed), 500)
        : 100;
    const events = await syncService.listOutbox(safeLimit);
    return reply.send({ data: events });
  });

  app.post('/hackathons/:id/replay', { preHandler: [authGuard] }, async (req, reply) => {
    const user = getUser(req as any);
    if (!['ORGANIZER', 'ADMIN'].includes(user.role)) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Only organizers can replay publish events' } });
    }
    const { id } = req.params as any;
    try {
      const event = await syncService.replayToOutbox(id);
      return reply.send({ data: event });
    } catch (e: any) {
      return reply.status(e.statusCode ?? 500).send({ error: { code: 'REPLAY_FAILED', message: e.message } });
    }
  });

  app.post('/sync/direct-db-write', { preHandler: [authGuard] }, async (_req, reply) => {
    return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Do NOT directly modify participant database tables. Use versioned HackathonPublished event/contract.' } });
  });
}
