import { ExecutionContext, Injectable } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'crypto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

/**
 * Authentication for organizer → participant sync ingestion.
 *
 * Accepts EITHER:
 *  1. the shared sync secret (`x-sync-secret` header equals
 *     SYNC_SHARED_SECRET, compared in constant time), used by the
 *     organizer API push; or
 *  2. a regular participant JWT (existing JwtAuthGuard path).
 *
 * Scoped to sync ingestion routes only — all other guards/routes untouched.
 * When SYNC_SHARED_SECRET is unset, only JWT auth applies (fail-closed).
 */
@Injectable()
export class SyncAuthGuard extends JwtAuthGuard {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const presented = req?.headers?.['x-sync-secret'];
    const expected = process.env.SYNC_SHARED_SECRET ?? '';
    if (typeof presented === 'string' && presented.length > 0 && expected.length > 0) {
      const a = createHash('sha256').update(presented).digest();
      const b = createHash('sha256').update(expected).digest();
      if (a.length === b.length && timingSafeEqual(a, b)) return true;
    }
    return super.canActivate(context) as unknown as Promise<boolean>;
  }
}
