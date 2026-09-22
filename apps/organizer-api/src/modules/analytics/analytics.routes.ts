import { FastifyInstance } from 'fastify';
import { analyticsService } from './analytics.service';
import { createAuthGuard, getUser } from '../../shared/guards/auth.guard';
import type { JwtConfig } from '@hmt/security';

export async function analyticsRoutes(app: FastifyInstance, opts: { jwtConfig: JwtConfig }) {
  const authGuard = createAuthGuard(opts.jwtConfig);
  app.get('/hackathons/:id/analytics', { preHandler: [authGuard] }, async (req, reply) => {
    const user = getUser(req as any);
    if (!['ORGANIZER', 'ADMIN'].includes(user.role)) return reply.status(403).send({ error: { code: 'FORBIDDEN' } });
    const { id } = req.params as any;
    try {
      const data = await analyticsService.getAnalytics(id, user.id);
      return reply.send({ data });
    } catch (e: any) {
      return reply.status(e.statusCode ?? 500).send({ error: { code: 'ANALYTICS_FAILED', message: e.message } });
    }
  });
}
