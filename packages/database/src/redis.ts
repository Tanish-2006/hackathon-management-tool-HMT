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
    // connecting fail with "Stream isn't writeable". Wait for ready first (bounded).
    const status = (c as unknown as { status?: string }).status;
    if (status && status !== 'ready') {
      await new Promise<void>((resolve) => {
        let timer: NodeJS.Timeout | undefined;
        const done = () => {
          if (timer) clearTimeout(timer);
          c.removeListener('ready', onReady);
          c.removeListener('error', onError);
          resolve();
        };
        const onReady = () => done();
        const onError = () => done();
        c.once('ready', onReady);
        c.once('error', onError);
        timer = setTimeout(done, 1500);
      });
    }
    // 2s deadline so a partitioned Redis cannot hang readiness.
    const pingP = c.ping();
    let pingTimer: NodeJS.Timeout | undefined;
    const timeoutP = new Promise<never>((_, reject) => {
      pingTimer = setTimeout(() => reject(new Error('Redis ping timed out after 2000ms')), 2000);
    });
    timeoutP.catch(() => {});
    let pong: string;
    try {
      pong = await Promise.race([pingP, timeoutP]);
    } finally {
      if (pingTimer) clearTimeout(pingTimer);
    }
    if (pong !== 'PONG') throw new Error(`Unexpected PING response: ${pong}`);
    return { ok: true, latencyMs: Date.now() - start };
  } catch (e) {
    return { ok: false, latencyMs: Date.now() - start, error: e instanceof Error ? e.message : String(e) };
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
// NOTE: helpers below return the suffix WITHOUT the `hmt:` prefix — ioredis
// `keyPrefix: 'hmt:'` adds it automatically. Never prepend `hmt:` manually
// (would produce `hmt:hmt:…`) and never concatenate raw user input without
// sanitizing (see sanitizeKeyPart).

function sanitizeKeyPart(part: string): string {
  if (typeof part !== 'string' || part.length === 0) throw new Error('Invalid Redis key part: empty');
  // Disallow glob/whitespace/colon ambiguity that breaks SCAN patterns and
  // makes `rl:::1:…` (IPv6) ambiguous. IPv6 is encoded by replacing `:`.
  if (/[\s*?[\]\\]/.test(part)) throw new Error('Invalid Redis key part: whitespace or glob chars');
  return part.replace(/:/g, '_');
}

export const REDIS_KEYS = {
  cache: (domain: string, id: string) => `cache:${sanitizeKeyPart(domain)}:${sanitizeKeyPart(id)}`,
  rateLimit: (key: string) => `rl:${sanitizeKeyPart(key)}`,
  revokedJti: (jti: string) => {
    if (typeof jti !== 'string' || jti.length === 0) throw new Error('Invalid jti');
    return `auth:revoked:${sanitizeKeyPart(jti)}`;
  },
  session: (sessionId: string) => `auth:session:${sanitizeKeyPart(sessionId)}`,
  oauthState: (state: string) => `oauth:github:state:${sanitizeKeyPart(state)}`,
  installState: (state: string) => `oauth:github:install:${sanitizeKeyPart(state)}`,
} as const;
