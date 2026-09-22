import { FastifyInstance } from 'fastify';
import { hackathonService } from './hackathon.service';
import { draftInputSchema, manualCreateSchema, regenerateSectionSchema, updateSchema, wizardInputSchema } from './hackathon.schemas';
import { createAuthGuard, getUser } from '../../shared/guards/auth.guard';
import type { JwtConfig } from '@hmt/security';

export async function hackathonRoutes(app: FastifyInstance, opts: { jwtConfig: JwtConfig }) {
  const authGuard = createAuthGuard(opts.jwtConfig);

  // Organizer workflow: generate draft (AI) -> DRAFT
  app.post('/hackathons/draft/generate', { preHandler: [authGuard] }, async (req, reply) => {
    const user = getUser(req as any);
    if (!['ORGANIZER', 'ADMIN'].includes(user.role)) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Only organizers can generate drafts' } });
    }
    const parsed = draftInputSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Invalid draft input', details: parsed.error.issues } });
    try {
      const { hackathon, draft } = await hackathonService.generateDraft(parsed.data as any, user.id, { ip: (req as any).ip, requestId: (req as any).id });
      return reply.status(201).send({ data: { hackathon, draft } });
    } catch (e: any) {
      return reply.status(e.statusCode ?? 500).send({ error: { code: 'DRAFT_FAILED', message: e.message } });
    }
  });

  // Quick-create wizard: 5 organizer answers -> complete AI draft (DRAFT only, never auto-published)
  app.post('/hackathons/wizard/generate', { preHandler: [authGuard] }, async (req, reply) => {
    const user = getUser(req as any);
    if (!['ORGANIZER', 'ADMIN'].includes(user.role)) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Only organizers can generate drafts' } });
    }
    const parsed = wizardInputSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Invalid wizard input', details: parsed.error.issues } });
    try {
      const { hackathon, draft } = await hackathonService.generateWizardDraft(parsed.data as any, user.id, { ip: (req as any).ip, requestId: (req as any).id });
      return reply.status(201).send({ data: { hackathon, draft } });
    } catch (e: any) {
      return reply.status(e.statusCode ?? 500).send({ error: { code: 'WIZARD_FAILED', message: e.message } });
    }
  });

  // Section-level AI regeneration: ONLY the requested section changes (DRAFT/REVIEW, owner only)
  app.post('/hackathons/:id/regenerate-section', { preHandler: [authGuard] }, async (req, reply) => {
    const user = getUser(req as any);
    if (!['ORGANIZER', 'ADMIN'].includes(user.role)) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Only organizers can regenerate sections' } });
    }
    const { id } = req.params as any;
    const parsed = regenerateSectionSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Invalid section', details: parsed.error.issues } });
    try {
      const res = await hackathonService.regenerateSection(id, user.id, parsed.data.section as never, parsed.data.instruction, { ip: (req as any).ip, requestId: (req as any).id });
      return reply.send({ data: res });
    } catch (e: any) {
      return reply.status(e.statusCode ?? 500).send({ error: { code: 'REGENERATE_FAILED', message: e.message } });
    }
  });

  // Manual create (bypass AI) -> DRAFT
  app.post('/hackathons', { preHandler: [authGuard] }, async (req, reply) => {
    const user = getUser(req as any);
    if (!['ORGANIZER', 'ADMIN'].includes(user.role)) return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Only organizers can create hackathons' } });
    const parsed = manualCreateSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', details: parsed.error.issues } });
    const h = await hackathonService.createManual({ ...parsed.data, organizerId: user.id } as any, { ip: (req as any).ip, requestId: (req as any).id });
    return reply.status(201).send({ data: h });
  });

  // List own hackathons
  app.get('/hackathons', { preHandler: [authGuard] }, async (req, reply) => {
    const user = getUser(req as any);
    if (user.role === 'ADMIN') {
      const all = await hackathonService.listAll();
      return reply.send({ data: all });
    }
    if (user.role === 'ORGANIZER') {
      const own = await hackathonService.listByOrganizer(user.id);
      return reply.send({ data: own });
    }
    if (user.role === 'MENTOR') {
      // Mentors see hackathons they are assigned to OR published
      const all = await hackathonService.listAll();
      const filtered = all.filter((h) => h.status === 'PUBLISHED' || h.status === 'ARCHIVED');
      return reply.send({ data: filtered });
    }
    // PARTICIPANT
    const all = await hackathonService.listAll();
    return reply.send({ data: all.filter((h) => h.status === 'PUBLISHED' || h.status === 'ARCHIVED') });
  });

  app.get('/hackathons/:id', { preHandler: [authGuard] }, async (req, reply) => {
    const { id } = req.params as any;
    const h = await hackathonService.getById(id);
    if (!h) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Hackathon not found' } });
    const user = getUser(req as any);
    // Ownership check for non-published: only owner or admin can view DRAFT/REVIEW/CONFIRMED
    if (['DRAFT', 'REVIEW', 'CONFIRMED'].includes(h.status)) {
      if (h.organizerId !== user.id && user.role !== 'ADMIN') {
        return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Not owner' } });
      }
    }
    return reply.send({ data: h });
  });

  // Edit (only DRAFT/REVIEW)
  app.patch('/hackathons/:id', { preHandler: [authGuard] }, async (req, reply) => {
    const user = getUser(req as any);
    const { id } = req.params as any;
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', details: parsed.error.issues } });
    try {
      const updated = await hackathonService.update(id, user.id, parsed.data as any, { ip: (req as any).ip, requestId: (req as any).id });
      return reply.send({ data: updated });
    } catch (e: any) {
      return reply.status(e.statusCode ?? 500).send({ error: { code: 'UPDATE_FAILED', message: e.message } });
    }
  });

  // Workflow transitions
  app.post('/hackathons/:id/review', { preHandler: [authGuard] }, async (req, reply) => {
    const user = getUser(req as any);
    const { id } = req.params as any;
    try {
      const updated = await hackathonService.transition(id, user.id, 'REVIEW', { ip: (req as any).ip, requestId: (req as any).id });
      return reply.send({ data: updated });
    } catch (e: any) {
      return reply.status(e.statusCode ?? 500).send({ error: { code: 'TRANSITION_FAILED', message: e.message } });
    }
  });

  app.post('/hackathons/:id/confirm', { preHandler: [authGuard] }, async (req, reply) => {
    const user = getUser(req as any);
    const { id } = req.params as any;
    try {
      const updated = await hackathonService.transition(id, user.id, 'CONFIRMED', { ip: (req as any).ip, requestId: (req as any).id });
      return reply.send({ data: updated });
    } catch (e: any) {
      return reply.status(e.statusCode ?? 500).send({ error: { code: 'TRANSITION_FAILED', message: e.message } });
    }
  });

  app.post('/hackathons/:id/publish', { preHandler: [authGuard] }, async (req, reply) => {
    const user = getUser(req as any);
    const { id } = req.params as any;
    try {
      const updated = await hackathonService.transition(id, user.id, 'PUBLISHED', { ip: (req as any).ip, requestId: (req as any).id });
      // Return hackathon + published context
      const event = await hackathonService.getPublishedEvent(id);
      return reply.send({ data: { hackathon: updated, publishedEvent: event } });
    } catch (e: any) {
      return reply.status(e.statusCode ?? 500).send({ error: { code: 'TRANSITION_FAILED', message: e.message } });
    }
  });

  app.post('/hackathons/:id/archive', { preHandler: [authGuard] }, async (req, reply) => {
    const user = getUser(req as any);
    const { id } = req.params as any;
    try {
      const updated = await hackathonService.transition(id, user.id, 'ARCHIVED', { ip: (req as any).ip, requestId: (req as any).id });
      return reply.send({ data: updated });
    } catch (e: any) {
      return reply.status(e.statusCode ?? 500).send({ error: { code: 'TRANSITION_FAILED', message: e.message } });
    }
  });

  // Attempt direct AI→PUBLISHED should fail - we test this via violating state machine by trying to publish from DRAFT
  // Also provide endpoint that explicitly disallows direct AI publish: return error if tried
  app.post('/hackathons/:id/direct-publish', { preHandler: [authGuard] }, async (req, reply) => {
    // This endpoint intentionally demonstrates no direct AI → PUBLISHED
    return reply.status(400).send({ error: { code: 'ILLEGAL_TRANSITION', message: 'Direct AI → PUBLISHED transition not allowed. Must go through REVIEW → CONFIRMED → PUBLISHED' } });
  });
}
