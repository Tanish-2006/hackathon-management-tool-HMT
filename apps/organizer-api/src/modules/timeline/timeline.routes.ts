import { FastifyInstance } from 'fastify';
import { timelineService } from './timeline.service';
import { hackathonService } from '../hackathon/hackathon.service';
import { createAuthGuard, getUser } from '../../shared/guards/auth.guard';
import type { JwtConfig } from '@hmt/security';
import { z } from 'zod';

const createSchema = z.object({
  name: z.string().min(1),
  order: z.number().int().min(1),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  description: z.string().optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  order: z.number().int().min(1).optional(),
  startsAt: z.string().datetime().optional(),
  endsAt: z.string().datetime().optional(),
  description: z.string().optional(),
});

const materializeSchema = z.object({
  eventStart: z.string().datetime(),
  eventEnd: z.string().datetime(),
});

export async function timelineRoutes(app: FastifyInstance, opts: { jwtConfig: JwtConfig }) {
  const authGuard = createAuthGuard(opts.jwtConfig);

  app.post('/hackathons/:id/phases', { preHandler: [authGuard] }, async (req, reply) => {    const user = getUser(req as any);
    if (!['ORGANIZER', 'ADMIN'].includes(user.role)) return reply.status(403).send({ error: { code: 'FORBIDDEN' } });
    const { id } = req.params as any;
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', details: parsed.error.issues } });
    try {
      const phase = await timelineService.create(id, user.id, parsed.data as any);
      return reply.status(201).send({ data: phase });
    } catch (e: any) {
      return reply.status(e.statusCode ?? 500).send({ error: { code: 'PHASE_CREATE_FAILED', message: e.message } });
    }
  });

  // Materialize AI-suggested phases into dated records inside an explicit
  // event window. Refuses when phases already exist (409) — edit/delete
  // individual phases instead. The single authoritative path for AI dates.
  app.post('/hackathons/:id/timeline/materialize', { preHandler: [authGuard] }, async (req, reply) => {
    const user = getUser(req as any);
    if (!['ORGANIZER', 'ADMIN'].includes(user.role)) return reply.status(403).send({ error: { code: 'FORBIDDEN' } });
    const { id } = req.params as any;
    const parsed = materializeSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', details: parsed.error.issues } });
    try {
      const res = await hackathonService.materializeTimeline(
        id,
        user.id,
        { eventStart: parsed.data.eventStart, eventEnd: parsed.data.eventEnd },
        { ip: (req as any).ip, requestId: (req as any).id },
      );
      return reply.status(201).send({ data: res });
    } catch (e: any) {
      return reply.status(e.statusCode ?? 500).send({ error: { code: 'TIMELINE_MATERIALIZE_FAILED', message: e.message } });
    }
  });

  app.get('/hackathons/:id/phases', { preHandler: [authGuard] }, async (req, reply) => {    const { id } = req.params as any;
    try {
      const list = await timelineService.list(id);
      return reply.send({ data: list });
    } catch (e: any) {
      return reply.status(e.statusCode ?? 500).send({ error: { code: 'PHASE_LIST_FAILED', message: e.message } });
    }
  });

  app.patch('/phases/:phaseId', { preHandler: [authGuard] }, async (req, reply) => {
    const user = getUser(req as any);
    if (!['ORGANIZER', 'ADMIN'].includes(user.role)) return reply.status(403).send({ error: { code: 'FORBIDDEN' } });
    const { phaseId } = req.params as any;
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', details: parsed.error.issues } });
    try {
      const updated = await timelineService.update(phaseId, user.id, parsed.data as any);
      return reply.send({ data: updated });
    } catch (e: any) {
      return reply.status(e.statusCode ?? 500).send({ error: { code: 'PHASE_UPDATE_FAILED', message: e.message } });
    }
  });

  app.delete('/phases/:phaseId', { preHandler: [authGuard] }, async (req, reply) => {
    const user = getUser(req as any);
    if (!['ORGANIZER', 'ADMIN'].includes(user.role)) return reply.status(403).send({ error: { code: 'FORBIDDEN' } });
    const { phaseId } = req.params as any;
    try {
      await timelineService.delete(phaseId, user.id);
      return reply.send({ message: 'Deleted' });
    } catch (e: any) {
      return reply.status(e.statusCode ?? 500).send({ error: { code: 'PHASE_DELETE_FAILED', message: e.message } });
    }
  });
}
