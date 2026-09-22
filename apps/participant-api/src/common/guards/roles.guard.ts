import { CanActivate, ExecutionContext, Injectable, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FastifyRequest } from 'fastify';
import type { Role } from '@hmt/common';
import { ROLES_KEY } from './roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [context.getHandler(), context.getClass()]);
    if (!required || required.length === 0) return true;
    const req = context.switchToHttp().getRequest<FastifyRequest & { user?: { role: Role } }>();
    const user = (req as unknown as Record<string, unknown>).user as { role: Role } | undefined;
    if (!user?.role) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Missing role' });
    if (!required.includes(user.role)) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: `Role ${user.role} not allowed. Required: ${required.join(', ')}`,
      });
    }
    return true;
  }
}
