import { FastifyInstance } from 'fastify';
import { mentorService } from './mentor.service';
import { createAuthGuard, getUser } from '../../shared/guards/auth.guard';
import type { JwtConfig } from '@hmt/security';
import { z } from 'zod';

const assignSchema = z.object({
  mentorId: z.string().min(1),
  teamId: z.string().min(1),
});

const submitSchema = z.object({
  teamId: z.string().min(1),
  projectId: z.string().nullable().optional(),
  hackathonId: z.string().min(1),
  score: z.number().min(0).max(10),
  remarks: z.string().min(1),
  reason: z.string().min(1),
  strengths: z.array(z.string()).optional(),
  weaknesses: z.array(z.string()).optional(),
  technicalFeedback: z.string().nullable().optional(),
  productFeedback: z.string().nullable().optional(),
  recommendation: z.string().nullable().optional(),
  phase: z.string().min(1),
});

const correctSchema = z.object({
  score: z.number().min(0).max(10).optional(),
  remarks: z.string().min(1).optional(),
  reason: z.string().min(1).optional(),
  strengths: z.array(z.string()).optional(),
  weaknesses: z.array(z.string()).optional(),
  technicalFeedback: z.string().nullable().optional(),
  productFeedback: z.string().nullable().optional(),
  recommendation: z.string().nullable().optional(),
});

export async function mentorRoutes(app: FastifyInstance, opts: { jwtConfig: JwtConfig }) {
  const authGuard = createAuthGuard(opts.jwtConfig);

  // Organizer assigns mentor to team
  app.post('/hackathons/:hackathonId/mentor-assignments', { preHandler: [authGuard] }, async (req, reply) => {
    const user = getUser(req as any);
    if (!['ORGANIZER', 'ADMIN'].includes(user.role)) return reply.status(403).send({ error: { code: 'FORBIDDEN' } });
    const { hackathonId } = req.params as any;
    const parsed = assignSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', details: parsed.error.issues } });
    try {
      const assignment = await mentorService.assignMentor(hackathonId, parsed.data as never, user.id);
      return reply.status(201).send({ data: assignment });
    } catch (e: any) {
      return reply.status(e.statusCode ?? 500).send({ error: { code: 'ASSIGN_FAILED', message: e.message } });
    }
  });

  app.get('/hackathons/:hackathonId/mentor-assignments', { preHandler: [authGuard] }, async (req, reply) => {
    const { hackathonId } = req.params as any;
    const list = await mentorService.listAssignments(hackathonId);
    return reply.send({ data: list });
  });

  app.get('/mentors/:mentorId/teams', { preHandler: [authGuard] }, async (req, reply) => {
    const { mentorId } = req.params as any;
    const user = getUser(req as any);
    if (user.id !== mentorId && !['ORGANIZER', 'ADMIN'].includes(user.role)) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Can only view own assignments unless organizer' } });
    }
    const list = await mentorService.listMentorTeams(mentorId);
    return reply.send({ data: list });
  });

  // Mentor submits feedback (mentor or admin)
  app.post('/mentor/feedback', { preHandler: [authGuard] }, async (req, reply) => {
    const user = getUser(req as any);
    if (!['MENTOR', 'ADMIN'].includes(user.role)) return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Only mentors can submit feedback' } });
    const parsed = submitSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', details: parsed.error.issues } });
    try {
      const fb = await mentorService.submitFeedback(parsed.data as any, user.id, user.role);
      return reply.status(201).send({ data: fb });
    } catch (e: any) {
      return reply.status(e.statusCode ?? 500).send({ error: { code: 'FEEDBACK_SUBMIT_FAILED', message: e.message } });
    }
  });

  app.get('/mentor/feedback/:id', { preHandler: [authGuard] }, async (req, reply) => {
    const user = getUser(req as any);
    const { id } = req.params as any;
    const fb = await mentorService.getFeedback(id, user);
    if (!fb) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Feedback not found or not visible' } });
    // Never expose unpublished to participants - handled in service
    if (user.role === 'PARTICIPANT' && fb.publicationStatus !== 'PUBLISHED') {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Unpublished feedback not visible' } });
    }
    // Organizer trying to view unpublished is allowed, but we audit
    return reply.send({ data: fb });
  });

  app.get('/hackathons/:hackathonId/feedbacks', { preHandler: [authGuard] }, async (req, reply) => {
    const user = getUser(req as any);
    const { hackathonId } = req.params as any;
    const list = await mentorService.listFeedbacks(hackathonId, user);
    // For PARTICIPANT, filter to only published fields (score, remarks, reason, improvement feedback)
    if (user.role === 'PARTICIPANT') {
      const published = list
        .filter((f) => f.publicationStatus === 'PUBLISHED')
        .map((f) => ({
          id: f.id,
          score: f.score,
          remarks: f.remarks,
          reason: f.reason,
          strengths: f.strengths,
          weaknesses: f.weaknesses,
          technicalFeedback: f.technicalFeedback,
          productFeedback: f.productFeedback,
          recommendation: f.recommendation,
          publicationStatus: f.publicationStatus,
          version: f.version,
          createdAt: f.createdAt,
        }));
      return reply.send({ data: published });
    }
    return reply.send({ data: list });
  });

  // Correction (new version) - mentor only
  app.post('/mentor/feedback/:id/correct', { preHandler: [authGuard] }, async (req, reply) => {
    const user = getUser(req as any);
    if (!['MENTOR', 'ADMIN'].includes(user.role)) return reply.status(403).send({ error: { code: 'FORBIDDEN' } });
    const { id } = req.params as any;
    const parsed = correctSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', details: parsed.error.issues } });
    try {
      const corrected = await mentorService.correctFeedback(id, user.id, parsed.data as any);
      return reply.status(201).send({ data: corrected });
    } catch (e: any) {
      return reply.status(e.statusCode ?? 500).send({ error: { code: 'CORRECTION_FAILED', message: e.message } });
    }
  });

  // Organizer review
  app.post('/mentor/feedback/:id/review', { preHandler: [authGuard] }, async (req, reply) => {
    const user = getUser(req as any);
    if (!['ORGANIZER', 'ADMIN'].includes(user.role)) return reply.status(403).send({ error: { code: 'FORBIDDEN' } });
    const { id } = req.params as any;
    try {
      const reviewed = await mentorService.reviewFeedback(id, user.id);
      return reply.send({ data: reviewed });
    } catch (e: any) {
      return reply.status(e.statusCode ?? 500).send({ error: { code: 'REVIEW_FAILED', message: e.message } });
    }
  });

  // Organizer publish (transparency workflow)
  app.post('/mentor/feedback/:id/publish', { preHandler: [authGuard] }, async (req, reply) => {
    const user = getUser(req as any);
    if (!['ORGANIZER', 'ADMIN'].includes(user.role)) return reply.status(403).send({ error: { code: 'FORBIDDEN' } });
    const { id } = req.params as any;
    try {
      const published = await mentorService.publishFeedback(id, user.id);
      return reply.send({ data: published });
    } catch (e: any) {
      return reply.status(e.statusCode ?? 500).send({ error: { code: 'PUBLISH_FAILED', message: e.message } });
    }
  });

  // Illegal direct edit attempt - should be blocked
  app.put('/mentor/feedback/:id', { preHandler: [authGuard] }, async (req, reply) => {
    const user = getUser(req as any);
    const { id } = req.params as any;
    try {
      await mentorService.illegalDirectEdit(id, user.id, req.body);
      return reply.send({ data: null });
    } catch (e: any) {
      return reply.status(e.statusCode ?? 500).send({ error: { code: 'EDIT_BLOCKED', message: e.message } });
    }
  });

  app.get('/mentor/feedback/:id/versions', { preHandler: [authGuard] }, async (req, reply) => {
    const { id } = req.params as any;
    const versions = await mentorService.listFeedbackVersions(id);
    return reply.send({ data: versions });
  });
}
