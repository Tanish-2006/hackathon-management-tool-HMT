import { FastifyInstance } from 'fastify';
import { overviewService } from './overview.service';
import { createAuthGuard, getUser } from '../../shared/guards/auth.guard';
import type { JwtConfig } from '@hmt/security';

export async function overviewRoutes(app: FastifyInstance, opts: { jwtConfig: JwtConfig }) {
  const authGuard = createAuthGuard(opts.jwtConfig);

  app.get('/organizer/overview', { preHandler: [authGuard] }, async (req, reply) => {
    const user = getUser(req as any);
    if (user.role !== 'ORGANIZER' && user.role !== 'ADMIN') {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Organizer access required' } });
    }
    try {
      const overview = await overviewService.getOverview(user.id, user.role);
      return reply.send({ data: overview });
    } catch (e: any) {
      return reply.status(e.statusCode ?? 500).send({ error: { code: 'OVERVIEW_FAILED', message: e.message } });
    }
  });
}
