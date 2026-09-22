import Redis from 'ioredis';

export interface RedisConfig {
  url: string;
  prefix?: string;
  enableOfflineQueue?: boolean;
}

let redisClient: Redis | null = null;

export function getRedisClient(config: RedisConfig): Redis {
  if (redisClient) return redisClient;
  redisClient = new Redis(config.url, {
    keyPrefix: config.prefix ?? 'hmt:',
    enableOfflineQueue: config.enableOfflineQueue ?? false,
    maxRetriesPerRequest: 2,
    lazyConnect: false,
  });

  redisClient.on('error', (err) => {
    // Will be logged via observability logger; avoid console silently
    if (process.env.NODE_ENV !== 'test') {
      // eslint-disable-next-line no-console
      console.error('[redis] error', err.message);
    }
  });

  return redisClient;
}

export async function checkRedisHealth(
  client?: Redis,
  config?: RedisConfig,
): Promise<{ ok: boolean; latencyMs?: number; error?: string }> {
  const c = client ?? (config ? getRedisClient(config) : redisClient);
  if (!c) return { ok: false, error: 'Redis client not initialized' };
  const start = Date.now();
  try {
    // With enableOfflineQueue:false, commands issued while the socket is still
    // connecting fail with "Stream isn't writeable". Wait for ready first.
    const status = (c as unknown as { status?: string }).status;
    if (status && status !== 'ready') {
      await new Promise<void>((resolve) => {
        const done = () => {
          c.removeListener('ready', onReady);
          c.removeListener('error', onError);
          resolve();
        };
        const onReady = () => done();
        const onError = () => done();
        c.once('ready', onReady);
        c.once('error', onError);
        setTimeout(done, 1500);
      });
    }
    const pong = await c.ping();
    if (pong !== 'PONG') throw new Error(`Unexpected PING response: ${pong}`);
    return { ok: true, latencyMs: Date.now() - start };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function disconnectRedis(): Promise<void> {
  if (redisClient) {
    redisClient.disconnect();
    redisClient = null;
  }
}

// Redis usage conventions:
// - Cache keys: hmt:cache:<domain>:<id>
// - Rate limiting: hmt:rl:<ip|userId>:<route>
// - Refresh token reuse detection: hmt:auth:revoked:<jti> TTL=refreshTtlSec
// - Queues (BullMQ future): hmt:queue:<name>
// - Temp state: hmt:tmp:<id> TTL short

export const REDIS_KEYS = {
  cache: (domain: string, id: string) => `cache:${domain}:${id}`,
  rateLimit: (key: string) => `rl:${key}`,
  revokedJti: (jti: string) => `auth:revoked:${jti}`,
  session: (sessionId: string) => `auth:session:${sessionId}`,
  oauthState: (state: string) => `oauth:github:state:${state}`,
  installState: (state: string) => `oauth:github:install:${state}`,
} as const;
