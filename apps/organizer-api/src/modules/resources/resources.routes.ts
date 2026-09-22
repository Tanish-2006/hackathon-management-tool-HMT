import { FastifyInstance } from 'fastify';
import { resourcesService } from './resources.service';
import { createAuthGuard, getUser } from '../../shared/guards/auth.guard';
import type { JwtConfig } from '@hmt/security';
import { z } from 'zod';

const createSchema = z.object({
  title: z.string().min(1),
  type: z.enum(['DOCUMENT', 'LINK', 'API', 'DATASET', 'SDK', 'RULES', 'STARTER', 'OTHER']).optional(),
  url: z.string().url().nullable().optional().or(z.literal('')),
  content: z.string().nullable().optional(),
  visibility: z.enum(['PUBLIC', 'PARTICIPANT', 'MENTOR', 'ORGANIZER']),
});

const updateSchema = z.object({
  title: z.string().min(1).optional(),
  type: z.enum(['DOCUMENT', 'LINK', 'API', 'DATASET', 'SDK', 'RULES', 'STARTER', 'OTHER']).optional(),
  url: z.string().url().nullable().optional().or(z.literal('')),
  content: z.string().nullable().optional(),
  visibility: z.enum(['PUBLIC', 'PARTICIPANT', 'MENTOR', 'ORGANIZER']).optional(),
});

export async function resourcesRoutes(app: FastifyInstance, opts: { jwtConfig: JwtConfig }) {
  const authGuard = createAuthGuard(opts.jwtConfig);

  app.post('/hackathons/:id/resources', { preHandler: [authGuard] }, async (req, reply) => {
    const user = getUser(req as any);
    if (!['ORGANIZER', 'ADMIN'].includes(user.role)) return reply.status(403).send({ error: { code: 'FORBIDDEN' } });
    const { id } = req.params as any;
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', details: parsed.error.issues } });
    try {
      const r = await resourcesService.create(id, user.id, parsed.data as any);
      return reply.status(201).send({ data: r });
    } catch (e: any) {
      return reply.status(e.statusCode ?? 500).send({ error: { code: 'RESOURCE_CREATE_FAILED', message: e.message } });
    }
  });

  app.get('/hackathons/:id/resources', { preHandler: [authGuard] }, async (req, reply) => {
    const user = getUser(req as any);
    const { id } = req.params as any;
    try {
      const list = await resourcesService.list(id, user);
      return reply.send({ data: list });
    } catch (e: any) {
      return reply.status(e.statusCode ?? 500).send({ error: { code: 'RESOURCE_LIST_FAILED', message: e.message } });
    }
  });

  // Public participant sync view - also requires auth but filters visibility
  app.get('/hackathons/:id/resources/public', { preHandler: [authGuard] }, async (req, reply) => {
    const user = getUser(req as any);
    const { id } = req.params as any;
    const list = await resourcesService.list(id, user);
    return reply.send({ data: list });
  });

  app.patch('/resources/:id', { preHandler: [authGuard] }, async (req, reply) => {
    const user = getUser(req as any);
    if (!['ORGANIZER', 'ADMIN'].includes(user.role)) return reply.status(403).send({ error: { code: 'FORBIDDEN' } });
    const { id } = req.params as any;
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', details: parsed.error.issues } });
    try {
      const updated = await resourcesService.update(id, user.id, parsed.data as any);
      return reply.send({ data: updated });
    } catch (e: any) {
      return reply.status(e.statusCode ?? 500).send({ error: { code: 'RESOURCE_UPDATE_FAILED', message: e.message } });
    }
  });

  app.delete('/resources/:id', { preHandler: [authGuard] }, async (req, reply) => {
    const user = getUser(req as any);
    if (!['ORGANIZER', 'ADMIN'].includes(user.role)) return reply.status(403).send({ error: { code: 'FORBIDDEN' } });
    const { id } = req.params as any;
    try {
      await resourcesService.delete(id, user.id);
      return reply.send({ message: 'Deleted' });
    } catch (e: any) {
      return reply.status(e.statusCode ?? 500).send({ error: { code: 'RESOURCE_DELETE_FAILED', message: e.message } });
    }
  });
}
