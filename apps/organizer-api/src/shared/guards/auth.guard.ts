import { FastifyRequest, FastifyReply } from 'fastify';
import { verifyAccessToken } from '@hmt/security';
import type { JwtConfig } from '@hmt/security';
import { memoryStore } from '../../store/memory.store';

// Minimal auth guard for Fastify. Verifies JWT and attaches user.
// Uses shared @hmt/security JWT helpers.

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: string;
  sessionId: string;
}

export function createAuthGuard(jwtConfig: JwtConfig) {
  return async function authGuard(request: FastifyRequest, reply: FastifyReply) {
    const header = request.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      return reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Missing Bearer token' } });
    }
    const token = header.slice(7);
    try {
      const payload = verifyAccessToken(
        {
          accessSecret: jwtConfig.accessSecret,
          refreshSecret: jwtConfig.refreshSecret,
          accessTtlSec: jwtConfig.accessTtlSec,
          refreshTtlSec: jwtConfig.refreshTtlSec,
        },
        token,
      );
      // Check session exists and not revoked
      const session = memoryStore.sessions.get(payload.sessionId);
      if (!session || session.revokedAt) {
        return reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Session revoked' } });
      }
      // Attach user
      (request as any).user = {
        id: payload.sub,
        role: payload.role,
        sessionId: payload.sessionId,
        email: (payload as any).email ?? '',
      } as AuthenticatedUser;

      // Also enrich email from store if needed
      const u = memoryStore.users.get(payload.sub);
      if (u) {
        (request as any).user.email = u.email;
      }
    } catch (e: any) {
      return reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: e.message ?? 'Invalid token' } });
    }
  };
}

export function getUser(request: FastifyRequest): AuthenticatedUser {
  const u = (request as any).user as AuthenticatedUser | undefined;
  if (!u) throw Object.assign(new Error('Not authenticated'), { statusCode: 401 });
  return u;
}
