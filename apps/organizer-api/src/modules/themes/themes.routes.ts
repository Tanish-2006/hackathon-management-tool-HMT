import { FastifyInstance } from 'fastify';
import { themesService } from './themes.service';
import { createAuthGuard, getUser } from '../../shared/guards/auth.guard';
import type { JwtConfig } from '@hmt/security';
import { z } from 'zod';

const createSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
});

export async function themesRoutes(app: FastifyInstance, opts: { jwtConfig: JwtConfig }) {
  const authGuard = createAuthGuard(opts.jwtConfig);

  app.post('/themes', { preHandler: [authGuard] }, async (req, reply) => {
    const user = getUser(req as any);
    if (!['ORGANIZER', 'ADMIN'].includes(user.role)) return reply.status(403).send({ error: { code: 'FORBIDDEN' } });
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', details: parsed.error.issues } });
    try {
      const t = await themesService.create(parsed.data.name, user.id, parsed.data.description);
      return reply.status(201).send({ data: t });
    } catch (e: any) {
      return reply.status(e.statusCode ?? 500).send({ error: { code: 'THEME_CREATE_FAILED', message: e.message } });
    }
  });

  app.get('/themes', { preHandler: [authGuard] }, async (_req, reply) => {
    const list = await themesService.list();
    // If empty, seed defaults lazily? But we expose empty list to show configurable nature
    return reply.send({ data: list });
  });

  app.get('/themes/:id', { preHandler: [authGuard] }, async (req, reply) => {
    const { id } = req.params as any;
    const t = await themesService.getById(id);
    if (!t) return reply.status(404).send({ error: { code: 'NOT_FOUND' } });
    return reply.send({ data: t });
  });

  app.post('/hackathons/:id/themes', { preHandler: [authGuard] }, async (req, reply) => {
    const user = getUser(req as any);
    const { id } = req.params as any;
    const body: any = req.body;
    if (!body?.themeId) return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: 'themeId required' } });
    try {
      await themesService.assignToHackathon(id, body.themeId, user.id);
      return reply.send({ message: 'Theme assigned' });
    } catch (e: any) {
      return reply.status(e.statusCode ?? 500).send({ error: { code: 'THEME_ASSIGN_FAILED', message: e.message } });
    }
  });

  // Endpoint to demonstrate configurability - not hardcoding only 7 themes
  app.post('/themes/seed-defaults', { preHandler: [authGuard] }, async (req, reply) => {
    const user = getUser(req as any);
    if (!['ORGANIZER', 'ADMIN'].includes(user.role)) return reply.status(403).send({ error: { code: 'FORBIDDEN' } });
    await themesService.seedDefaults(user.id);
    const list = await themesService.list();
    return reply.send({ data: list });
  });
}
