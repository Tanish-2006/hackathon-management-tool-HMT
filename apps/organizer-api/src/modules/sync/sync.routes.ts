import { FastifyInstance } from 'fastify';
import { syncService } from './sync.service';
import { createAuthGuard, getUser } from '../../shared/guards/auth.guard';
import type { JwtConfig } from '@hmt/security';

export async function syncRoutes(app: FastifyInstance, opts: { jwtConfig: JwtConfig }) {
  const authGuard = createAuthGuard(opts.jwtConfig);

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

  app.get('/sync/published', { preHandler: [authGuard] }, async (_req, reply) => {
    const events = await syncService.listPublishedEvents();
    return reply.send({ data: events });
  });

  // Canonical outbox feed — participant backend polls this (same contract, idempotent by eventId).
  app.get('/sync/outbox', { preHandler: [authGuard] }, async (req, reply) => {
    const { limit } = (req.query as any) ?? {};
    const events = await syncService.listOutbox(limit ? Number(limit) : 100);
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
