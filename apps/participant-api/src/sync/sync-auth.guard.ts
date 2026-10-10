import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'crypto';
import { resolveSyncSecret } from '@hmt/config';

@Injectable()
export class SyncAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const presented = context.switchToHttp().getRequest()?.headers?.['x-sync-secret'];
    const expected = resolveSyncSecret();
    if (typeof presented !== 'string' || presented.length === 0 || expected.length === 0) {
      throw new UnauthorizedException('Sync secret required');
    }
    const a = createHash('sha256').update(presented).digest();
    const b = createHash('sha256').update(expected).digest();
    if (!timingSafeEqual(a, b)) throw new UnauthorizedException('Invalid sync secret');
    return true;
  }
}
