import { FastifyRequest, FastifyReply } from 'fastify';
import type { Role } from '@hmt/common';
import { getUser } from './auth.guard';

export function requireRoles(...allowed: Role[]) {
  return async function rolesGuard(request: FastifyRequest, reply: FastifyReply) {
    const user = getUser(request);
    if (!allowed.includes(user.role as Role)) {
      return reply.status(403).send({
        error: { code: 'FORBIDDEN', message: `Role ${user.role} not allowed. Required: ${allowed.join(', ')}` },
      });
    }
  };
}

export function isRole(userRole: string, allowed: Role[]): boolean {
  return allowed.includes(userRole as Role);
}
