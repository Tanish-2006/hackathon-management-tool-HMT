import { ExecutionContext, Injectable } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'crypto';
import { resolveSyncSecret } from '@hmt/config';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

/**
 * Authentication for organizer → participant sync ingestion.
 *
 * Accepts EITHER:
 *  1. the shared sync secret (`x-sync-secret` header equals
 *     SYNC_SHARED_SECRET, compared in constant time), used by the
 *     organizer API push; or
 *  2. a regular participant JWT **with ORGANIZER or ADMIN role** (human
 *     operator fallback). Plain PARTICIPANT/MENTOR JWTs are rejected so
 *     participants cannot forge organizer events into the read model.
 *
 * Scoped to sync ingestion routes only — all other guards/routes untouched.
 * The effective secret resolves via resolveSyncSecret() (explicit config
 * or non-prod dev default). When it is empty (production, unset),
 * only JWT auth applies (fail-closed).
 */
@Injectable()
export class SyncAuthGuard extends JwtAuthGuard {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const presented = req?.headers?.['x-sync-secret'];
    const expected = resolveSyncSecret();
    if (typeof presented === 'string' && presented.length > 0 && expected.length > 0) {
      const a = createHash('sha256').update(presented).digest();
      const b = createHash('sha256').update(expected).digest();
      if (a.length === b.length && timingSafeEqual(a, b)) return true;
    }
    const ok = (await super.canActivate(context)) as unknown as boolean;
    if (!ok) return false;
    // JWT path: restrict to organizer operators. The passport strategy
    // attaches { id, role, … } to req.user.
    const role = (req as any)?.user?.role;
    if (role !== 'ORGANIZER' && role !== 'ADMIN') return false;
    return true;
  }
}
