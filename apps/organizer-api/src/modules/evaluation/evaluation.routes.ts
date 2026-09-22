import { FastifyInstance } from 'fastify';
import { evaluationService } from './evaluation.service';
import { createAuthGuard, getUser } from '../../shared/guards/auth.guard';
import type { JwtConfig } from '@hmt/security';
import { z } from 'zod';

const createSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  weight: z.number().min(0.01).max(1),
  maxScore: z.number().min(1).max(100).default(10),
});

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional().nullable(),
  weight: z.number().min(0.01).max(1).optional(),
  maxScore: z.number().min(1).max(100).optional(),
});

export async function evaluationRoutes(app: FastifyInstance, opts: { jwtConfig: JwtConfig }) {
  const authGuard = createAuthGuard(opts.jwtConfig);

  app.post('/hackathons/:id/evaluation-criteria', { preHandler: [authGuard] }, async (req, reply) => {
    const user = getUser(req as any);
    if (!['ORGANIZER', 'ADMIN'].includes(user.role)) return reply.status(403).send({ error: { code: 'FORBIDDEN' } });
    const { id } = req.params as any;
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', details: parsed.error.issues } });
    try {
      const crit = await evaluationService.create(id, user.id, parsed.data as any);
      return reply.status(201).send({ data: crit });
    } catch (e: any) {
      return reply.status(e.statusCode ?? 500).send({ error: { code: 'CRITERIA_CREATE_FAILED', message: e.message } });
    }
  });

  app.get('/hackathons/:id/evaluation-criteria', { preHandler: [authGuard] }, async (req, reply) => {
    const { id } = req.params as any;
    try {
      const list = await evaluationService.list(id);
      return reply.send({ data: list });
    } catch (e: any) {
      return reply.status(e.statusCode ?? 500).send({ error: { code: 'CRITERIA_LIST_FAILED', message: e.message } });
    }
  });

  app.patch('/evaluation-criteria/:criteriaId', { preHandler: [authGuard] }, async (req, reply) => {
    const user = getUser(req as any);
    if (!['ORGANIZER', 'ADMIN'].includes(user.role)) return reply.status(403).send({ error: { code: 'FORBIDDEN' } });
    const { criteriaId } = req.params as any;
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', details: parsed.error.issues } });
    try {
      const updated = await evaluationService.update(criteriaId, user.id, parsed.data as any);
      return reply.send({ data: updated });
    } catch (e: any) {
      return reply.status(e.statusCode ?? 500).send({ error: { code: 'CRITERIA_UPDATE_FAILED', message: e.message } });
    }
  });

  app.delete('/evaluation-criteria/:criteriaId', { preHandler: [authGuard] }, async (req, reply) => {
    const user = getUser(req as any);
    if (!['ORGANIZER', 'ADMIN'].includes(user.role)) return reply.status(403).send({ error: { code: 'FORBIDDEN' } });
    const { criteriaId } = req.params as any;
    try {
      await evaluationService.delete(criteriaId, user.id);
      return reply.send({ message: 'Deleted' });
    } catch (e: any) {
      return reply.status(e.statusCode ?? 500).send({ error: { code: 'CRITERIA_DELETE_FAILED', message: e.message } });
    }
  });
}
