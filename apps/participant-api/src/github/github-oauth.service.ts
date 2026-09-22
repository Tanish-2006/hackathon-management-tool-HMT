import { Injectable, Logger, Optional } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../database/redis.service';

interface OAuthState {
  state: string;
  userId: string;
  createdAt: number;
  expiresAt: number;
}

/**
 * GitHubOAuthService — Redis-backed OAuth state with TTL, one-time use, replay protection.
 *
 * Requirements (Phase 2.6B):
 * - TTL ~10 minutes (600s)
 * - One-time use: state deleted after successful consumption
 * - Replay protection: second use of same state -> rejected
 * - State tied to authenticated user/session
 * - Delete after successful consumption
 * - Invalid/expired/replayed state rejected
 * - Do NOT store long-lived GitHub credentials in Redis (only short-lived state)
 *
 * Implementation:
 * - Primary store: Redis via RedisService.set(key, JSON, 600) with TTL
 * - Fallback: in-memory Map for tests and when Redis unavailable (still enforces TTL/expiry via expiresAt check)
 * - validateState is async for Redis; synchronous wrapper is provided for backwards compat but new code should await
 */
@Injectable()
export class GitHubOAuthService {
  private readonly logger = new Logger(GitHubOAuthService.name);
  private readonly states = new Map<string, OAuthState>();
  private static readonly TTL_SECONDS = 600; // 10 minutes
  private static readonly REDIS_PREFIX = 'oauth:github:state:';

  constructor(
    private readonly configService: ConfigService,
    @Optional() private readonly redisService?: RedisService,
  ) {}

  private redisKey(state: string): string {
    return `${GitHubOAuthService.REDIS_PREFIX}${state}`;
  }

  /**
   * Generate OAuth state — stores in both in-memory and Redis (if available).
   * Returns state synchronously for backwards compat; Redis write is async fire-and-forget
   * but also awaited in async GenerateStateAsync path.
   */
  generateState(userId: string): string {
    const state = randomBytes(32).toString('hex');
    const now = Date.now();
    const expiresAt = now + GitHubOAuthService.TTL_SECONDS * 1000;
    const record: OAuthState = { state, userId, createdAt: now, expiresAt };
    this.states.set(state, record);
    // Persist to Redis with TTL (fire-and-forget for sync compat, but log errors)
    if (this.redisService) {
      const key = this.redisKey(state);
      const value = JSON.stringify(record);
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      this.redisService
        .set(key, value, GitHubOAuthService.TTL_SECONDS)
        .catch((e) => this.logger.warn(`Failed to persist OAuth state to Redis: ${(e as Error).message}`));
    }
    this.logger.log(`Generated OAuth state for user ${userId} (redacted, ttl=600s)`);
    return state;
  }

  /**
   * Async variant — guarantees Redis persistence before returning.
   * Use this in new code where you can await.
   */
  async generateStateAsync(userId: string): Promise<string> {
    const state = randomBytes(32).toString('hex');
    const now = Date.now();
    const expiresAt = now + GitHubOAuthService.TTL_SECONDS * 1000;
    const record: OAuthState = { state, userId, createdAt: now, expiresAt };
    this.states.set(state, record);
    if (this.redisService) {
      const key = this.redisKey(state);
      await this.redisService.set(key, JSON.stringify(record), GitHubOAuthService.TTL_SECONDS);
    }
    this.logger.log(`Generated OAuth state (async) for user ${userId}`);
    return state;
  }

  /**
   * Validate state — async, Redis-backed with replay protection.
   * - Checks Redis first if available (source of truth for distributed instances)
   * - Falls back to in-memory Map
   * - Enforces user binding, expiry, one-time use (deletes on success)
   */
  async validateState(state: string, userId: string): Promise<boolean> {
    // Try Redis first (if service available)
    if (this.redisService) {
      const key = this.redisKey(state);
      const raw = await this.redisService.get(key);
      if (raw) {
        let record: OAuthState;
        try {
          record = JSON.parse(raw) as OAuthState;
        } catch {
          this.logger.warn(`OAuth state JSON parse failed for ${state.slice(0, 8)}...`);
          await this.redisService.del(key);
          this.states.delete(state);
          return false;
        }
        if (record.userId !== userId) {
          this.logger.warn(`OAuth state user mismatch: expected ${record.userId}, got ${userId}`);
          return false;
        }
        if (Date.now() > record.expiresAt) {
          this.logger.warn(`OAuth state expired for user ${userId}`);
          await this.redisService.del(key);
          this.states.delete(state);
          return false;
        }
        // One-time use: delete from Redis and Map
        await this.redisService.del(key);
        this.states.delete(state);
        return true;
      }
      // If not in Redis, fall through to Map check (handles in-memory only states from generateState sync that hasn't yet flushed)
    }

    const record = this.states.get(state);
    if (!record) {
      this.logger.warn(`OAuth state not found (possible replay/expired): ${state.slice(0, 8)}...`);
      return false;
    }
    if (record.userId !== userId) {
      this.logger.warn(`OAuth state user mismatch: expected ${record.userId}, got ${userId}`);
      return false;
    }
    if (Date.now() > record.expiresAt) {
      this.logger.warn(`OAuth state expired for user ${userId}`);
      this.states.delete(state);
      if (this.redisService) {
        await this.redisService.del(this.redisKey(state)).catch(() => {});
      }
      return false;
    }
    // One-time use
    this.states.delete(state);
    if (this.redisService) {
      await this.redisService.del(this.redisKey(state)).catch(() => {});
    }
    return true;
  }

  /**
   * Synchronous validation — for backwards compatibility with existing tests/sync callers.
   * Only checks in-memory Map (synchronous). For production distributed validation, use validateState (async).
   * @deprecated Use validateState() async instead.
   */
  validateStateSync(state: string, userId: string): boolean {
    const record = this.states.get(state);
    if (!record) {
      this.logger.warn(`OAuth state not found (sync, possible replay): ${state.slice(0, 8)}...`);
      return false;
    }
    if (record.userId !== userId) {
      this.logger.warn(`OAuth state user mismatch (sync): expected ${record.userId}, got ${userId}`);
      return false;
    }
    if (Date.now() > record.expiresAt) {
      this.logger.warn(`OAuth state expired (sync) for user ${userId}`);
      this.states.delete(state);
      return false;
    }
    this.states.delete(state);
    return true;
  }

  getAuthorizationUrl(userId: string): string {
    const clientId = this.configService.get<string>('GITHUB_CLIENT_ID') || '';
    const callbackUrl = this.configService.get<string>('GITHUB_CALLBACK_URL') || '';
    const scopes = this.configService.get<string>('GITHUB_SCOPES') || 'repo read:user';
    if (!clientId) {
      const state = this.generateState(userId);
      return `https://github.com/login/oauth/authorize?client_id=mock_client_id&state=${state}&scope=${encodeURIComponent(scopes)}&redirect_uri=${encodeURIComponent(callbackUrl)}`;
    }
    const state = this.generateState(userId);
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: callbackUrl,
      scope: scopes,
      state,
      allow_signup: 'false',
    });
    return `https://github.com/login/oauth/authorize?${params.toString()}`;
  }

  // For testing: allow manual state generation (sync)
  getStateForTesting(userId: string): string {
    return this.generateState(userId);
  }

  async clearStates(): Promise<void> {
    this.states.clear();
    // Also clear Redis keys (scan fallback store)
    if (this.redisService) {
      // For in-memory fallback, we need to clear keys with prefix — RedisService doesn't expose scan, so just clear its internal map via del pattern
      // Instead, iterate known states — but we already cleared Map; for Redis we rely on TTL.
      // For test, we can try to delete any key that might exist by tracking states before clear
      // Since we cleared Map, we don't know keys — but test generates new states after clear, so old Redis keys will expire or be overwritten.
      // For completeness, if RedisService exposes internal store clearing in test, we can handle via private access.
      try {
        const store = (this.redisService as unknown as { inMemoryStore?: Map<string, unknown> }).inMemoryStore;
        if (store) {
          for (const k of Array.from(store.keys())) {
            if (k.includes('oauth:github:state:')) store.delete(k);
          }
        }
      } catch {}
    }
  }

  /** For testing Redis TTL: expose should be used to check expiry */
  getTtlSeconds(): number {
    return GitHubOAuthService.TTL_SECONDS;
  }
}
