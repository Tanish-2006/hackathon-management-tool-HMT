import { FastifyInstance } from 'fastify';
import { auditService } from './audit.service';
import { createAuthGuard, getUser } from '../../shared/guards/auth.guard';
import type { JwtConfig } from '@hmt/security';

export async function auditRoutes(app: FastifyInstance, opts: { jwtConfig: JwtConfig }) {
  const authGuard = createAuthGuard(opts.jwtConfig);

  // List audit logs - organizer/admin only, append-only view
  app.get('/audit/logs', { preHandler: [authGuard] }, async (req, reply) => {
    const user = getUser(req as any);
    if (!['ORGANIZER', 'ADMIN'].includes(user.role)) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Only organizers can view audit logs' } });
    }
    const query: any = req.query ?? {};
    const logs = await auditService.findMany({
      actorId: query.actorId,
      action: query.action,
      resourceType: query.resourceType,
      limit: query.limit ? Number(query.limit) : 100,
    });
    return reply.send({ data: logs });
  });

  app.get('/audit/logs/:id', { preHandler: [authGuard] }, async (req, reply) => {
    const user = getUser(req as any);
    if (!['ORGANIZER', 'ADMIN'].includes(user.role)) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Only organizers can view audit logs' } });
    }
    const { id } = req.params as any;
    const log = await auditService.findById(id);
    if (!log) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Audit log not found' } });
    return reply.send({ data: log });
  });

  // Explicitly block mutation attempts to demonstrate append-only
  app.put('/audit/logs/:id', { preHandler: [authGuard] }, async (_req, reply) => {
    return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Audit logs are append-only; updates not allowed' } });
  });
  app.delete('/audit/logs/:id', { preHandler: [authGuard] }, async (_req, reply) => {
    return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Audit logs are append-only; deletes not allowed' } });
  });
}
