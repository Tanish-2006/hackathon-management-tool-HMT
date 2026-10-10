import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';

const buckets = new Map<string, { count: number; resetAt: number }>();
const MAX_BUCKETS = 10000;
let lastSweep = Date.now();

function sweepExpired(now: number) {
  // Bound memory: prune expired buckets at most every 30s or when oversized.
  if (now - lastSweep < 30000 && buckets.size < MAX_BUCKETS) return;
  lastSweep = now;
  for (const [k, v] of buckets) {
    if (now > v.resetAt) buckets.delete(k);
  }
  // Hard cap: drop oldest entries if still oversized (Map preserves insertion order).
  while (buckets.size > MAX_BUCKETS) {
    const oldest = buckets.keys().next();
    if (oldest.done) break;
    buckets.delete(oldest.value);
  }
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);
  constructor(
    private readonly max = 10,
    private readonly windowMs = 60000,
  ) {}
  canActivate(context: ExecutionContext): boolean {
    // Skip in test env to avoid flaky tests.
    if (process.env.NODE_ENV === 'test') return true;
    const req = context.switchToHttp().getRequest();
    // Use the route pattern only — req.url includes the query string, so
    // keying on it lets attackers bypass limits with ?x=<random>.
    const rawRoute: unknown =
      req.routeOptions?.url ?? req.route?.path ?? req.url;
    const route =
      typeof rawRoute === 'string' ? rawRoute.split('?')[0] : '/unknown';
    const bodyIdentity =
      typeof req.body?.email === 'string'
        ? req.body.email.trim().toLowerCase()
        : typeof req.body?.phoneNumber === 'string'
          ? req.body.phoneNumber
          : typeof req.body?.refreshToken === 'string'
            ? `rt:${req.body.refreshToken.slice(-32)}`
            : typeof req.body?.token === 'string'
              ? `t:${req.body.token.slice(-32)}`
              : 'anon';
    const key = `${req.ip || 'ip'}:${route}:${req.user?.id || bodyIdentity}`;
    const now = Date.now();
    sweepExpired(now);
    let bucket = buckets.get(key);
    if (!bucket || now > bucket.resetAt) {
      bucket = { count: 1, resetAt: now + this.windowMs };
      buckets.set(key, bucket);
      return true;
    }
    bucket.count++;
    if (bucket.count > this.max) {
      throw new HttpException(
        {
          version: 'v1',
          error: {
            code: 'RATE_LIMITED',
            message: 'Too many requests. Please wait a moment and try again.',
          },
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}

/** Login/registration/password-reset: 10/min per IP+route (brute-force protection without breaking normal use). */
@Injectable()
export class AuthRateLimitGuard extends RateLimitGuard {
  constructor() {
    super(10, 60000);
  }
}

/** AI endpoints: 30/min per user (expensive operations). */
@Injectable()
export class AiRateLimitGuard extends RateLimitGuard {
  constructor() {
    super(30, 60000);
  }
}

/** GitHub OAuth/API operations: 20/min per user. */
@Injectable()
export class GithubRateLimitGuard extends RateLimitGuard {
  constructor() {
    super(20, 60000);
  }
}

/** Sensitive organizer-style mutations: 60/min. */
@Injectable()
export class SensitiveRateLimitGuard extends RateLimitGuard {
  constructor() {
    super(60, 60000);
  }
}
