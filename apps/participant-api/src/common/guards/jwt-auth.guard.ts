import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { FastifyRequest } from 'fastify';
import { verifyAccessToken } from '@hmt/security';
import { loadBaseEnv } from '@hmt/config';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<FastifyRequest & { user?: unknown }>();
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Missing Bearer token' });
    }
    const token = header.slice(7);
    try {
      const env = loadBaseEnv();
      const payload = verifyAccessToken(
        {
          accessSecret: env.JWT_ACCESS_SECRET,
          refreshSecret: env.JWT_REFRESH_SECRET,
          accessTtlSec: env.JWT_ACCESS_TTL_SECONDS,
          refreshTtlSec: env.JWT_REFRESH_TTL_SECONDS,
        },
        token,
      );
      // Attach verified user to request - never trust client-supplied IDs
      (req as unknown as Record<string, unknown>).user = {
        id: payload.sub,
        role: payload.role,
        sessionId: payload.sessionId,
      };
      return true;
    } catch (e) {
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: e instanceof Error ? e.message : 'Invalid token',
      });
    }
  }
}
