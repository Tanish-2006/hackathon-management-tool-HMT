import { FastifyInstance } from 'fastify';
import { participantsService } from './participants.service';
import { createAuthGuard, getUser } from '../../shared/guards/auth.guard';
import type { JwtConfig } from '@hmt/security';

export async function participantsRoutes(app: FastifyInstance, opts: { jwtConfig: JwtConfig }) {
  const authGuard = createAuthGuard(opts.jwtConfig);

  app.get('/hackathons/:id/participants', { preHandler: [authGuard] }, async (req, reply) => {
    const user = getUser(req as any);
    if (!['ORGANIZER', 'ADMIN'].includes(user.role)) return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Only organizers can view participants' } });
    const { id } = req.params as any;
    // Ownership check
    const hackathon = (await import('../../store/memory.store')).memoryStore.hackathons.get(id);
    if (!hackathon) return reply.status(404).send({ error: { code: 'NOT_FOUND' } });
    if (hackathon.organizerId !== user.id && user.role !== 'ADMIN') return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Not owner' } });
    const list = await participantsService.listParticipants(id, user.id);
    return reply.send({ data: list });
  });

  app.get('/hackathons/:id/teams', { preHandler: [authGuard] }, async (req, reply) => {
    const user = getUser(req as any);
    if (!['ORGANIZER', 'ADMIN'].includes(user.role)) return reply.status(403).send({ error: { code: 'FORBIDDEN' } });
    const { id } = req.params as any;
    const hackathon = (await import('../../store/memory.store')).memoryStore.hackathons.get(id);
    if (!hackathon) return reply.status(404).send({ error: { code: 'NOT_FOUND' } });
    if (hackathon.organizerId !== user.id && user.role !== 'ADMIN') return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Not owner' } });
    const list = await participantsService.listTeams(id, user.id);
    return reply.send({ data: list });
  });

  app.get('/hackathons/:id/projects', { preHandler: [authGuard] }, async (req, reply) => {
    const user = getUser(req as any);
    if (!['ORGANIZER', 'ADMIN'].includes(user.role)) return reply.status(403).send({ error: { code: 'FORBIDDEN' } });
    const { id } = req.params as any;
    const hackathon = (await import('../../store/memory.store')).memoryStore.hackathons.get(id);
    if (!hackathon) return reply.status(404).send({ error: { code: 'NOT_FOUND' } });
    if (hackathon.organizerId !== user.id && user.role !== 'ADMIN') return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Not owner' } });
    const list = await participantsService.listProjects(id, user.id);
    return reply.send({ data: list });
  });

  // Demonstrate privacy boundary: organizer cannot automatically access private repo contents
  app.get('/teams/:teamId/private-repo', { preHandler: [authGuard] }, async (req, reply) => {
    const user = getUser(req as any);
    const { teamId } = req.params as any;
    const result = await participantsService.tryAccessPrivateRepo(teamId, user.id);
    if (!result.allowed) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: result.reason } });
    }
    return reply.send({ data: result });
  });

  // Seed demo data endpoint for analytics testing (organizer only)
  app.post('/hackathons/:id/seed-demo', { preHandler: [authGuard] }, async (req, reply) => {
    const user = getUser(req as any);
    if (!['ORGANIZER', 'ADMIN'].includes(user.role)) return reply.status(403).send({ error: { code: 'FORBIDDEN' } });
    const { id } = req.params as any;
    await participantsService.seedDemoData(id);
    return reply.send({ message: 'Seeded' });
  });
}
