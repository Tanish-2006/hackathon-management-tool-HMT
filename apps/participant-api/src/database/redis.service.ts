import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis | null = null;
  private inMemoryStore = new Map<
    string,
    { value: string; expiresAt?: number }
  >();

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit() {
    const env = this.configService.get<string>('NODE_ENV', 'development');
    const isProd = env === 'production';
    if (env === 'test') {
      this.logger.log(
        'Test environment detected — using in-memory Redis fallback (no external connection).',
      );
      this.client = null;
      return;
    }

    // Support both REDIS_URL (canonical, packages/database + config) and
    // legacy REDIS_HOST/REDIS_PORT. REDIS_URL takes precedence.
    const redisUrl =
      this.configService.get<string>('REDIS_URL', '') ||
      process.env.REDIS_URL ||
      '';
    const host = this.configService.get<string>('REDIS_HOST', 'localhost');
    const port = this.configService.get<number>('REDIS_PORT', 6379);

    // Fast fallback: if no external Redis is expected in demo, skip connection attempt
    // to keep bootstrap time < 1s. Set REDIS_HOST=redis in docker-compose to enable real Redis.
    const shouldAttempt =
      process.env.ENABLE_REDIS === 'true' || host !== 'localhost' || !!redisUrl;
    if (!shouldAttempt) {
      const msg =
        'Redis fallback active (in-memory store). Set ENABLE_REDIS=true or REDIS_URL to connect to external Redis.';
      if (isProd) {
        // Production must not silently downgrade to memory when Redis is required
        // (rate limiting / revocation / OAuth state). Fail loudly in logs + health.
        this.logger.error(
          `${msg} PRODUCTION WARNING: persistence-dependent features (rate limiting, token revocation, OAuth state) are NOT shared across instances.`,
        );
      } else {
        this.logger.log(msg);
      }
      this.client = null;
      return;
    }

    try {
      const redisOptions: any = redisUrl
        ? {
            lazyConnect: true,
            maxRetriesPerRequest: 1,
            connectTimeout: 800,
            enableOfflineQueue: false,
            retryStrategy: () => null,
            reconnectOnError: () => false,
          }
        : {
            host,
            port,
            lazyConnect: true,
            maxRetriesPerRequest: 1,
            connectTimeout: 800,
            enableOfflineQueue: false,
            retryStrategy: () => null,
            reconnectOnError: () => false,
          };
      this.client = redisUrl ? new Redis(redisUrl, redisOptions) : new Redis(redisOptions);
      this.client.on('error', () => {
        // suppress unhandled error spam — fallback is already active
      });

      // Race connect against timeout to avoid blocking bootstrap
      await Promise.race([
        this.client.connect().catch((err: any) => {
          this.logger.warn(
            `Redis connection unavailable: ${err.message}. Using fallback in-memory store.`,
          );
          this.client = null;
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Redis connect timeout')), 900),
        ),
      ]).catch(() => {
        this.logger.warn(
          'Redis connect timeout — fallback to in-memory store.',
        );
        try {
          this.client?.disconnect();
        } catch {}
        this.client = null;
      });

      if (this.client) {
        this.logger.log(
          redisUrl ? 'Connected to Redis via REDIS_URL' : `Connected to Redis at ${host}:${port}`,
        );
      } else if (isProd) {
        this.logger.error(
          'PRODUCTION WARNING: Redis unavailable — running on in-memory fallback. Rate limiting and revocation are per-instance only.',
        );
      }
    } catch (err: any) {
      this.logger.warn(`Redis initialization skipped: ${err.message}`);
      this.client = null;
    }
  }

  async onModuleDestroy() {
    if (this.client) {
      await this.client.quit();
    }
  }

  /** True when backed by external Redis; false when on in-memory fallback. */
  isExternal(): boolean {
    return this.client !== null;
  }

  /** Health probe used by readiness: distinguishes healthy / degraded / unavailable. */
  async ping(): Promise<{ ok: boolean; external: boolean }> {
    if (this.client) {
      try {
        const pong = await this.client.ping();
        return { ok: pong === 'PONG', external: true };
      } catch {
        return { ok: false, external: true };
      }
    }
    return { ok: process.env.NODE_ENV !== 'production', external: false };
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (this.client) {
      if (ttlSeconds) {
        await this.client.set(key, value, 'EX', ttlSeconds);
      } else {
        await this.client.set(key, value);
      }
      return;
    }
    const expiresAt = ttlSeconds ? Date.now() + ttlSeconds * 1000 : undefined;
    this.inMemoryStore.set(key, { value, expiresAt });
  }

  async get(key: string): Promise<string | null> {
    if (this.client) {
      return await this.client.get(key);
    }
    const record = this.inMemoryStore.get(key);
    if (!record) return null;
    if (record.expiresAt && Date.now() > record.expiresAt) {
      this.inMemoryStore.delete(key);
      return null;
    }
    return record.value;
  }

  async del(key: string): Promise<void> {
    if (this.client) {
      await this.client.del(key);
      return;
    }
    this.inMemoryStore.delete(key);
  }
}
