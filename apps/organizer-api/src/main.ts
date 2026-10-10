import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { randomUUID } from 'node:crypto';
import { loadBaseEnv, createAppConfig, isDevSyncSecret } from '@hmt/config';
import { createLogger } from '@hmt/observability';
import { checkPostgresHealth, checkNeo4jHealth, getNeo4jDriver, checkRedisHealth, getRedisClient } from '@hmt/database';

// Business routes (existing)
import { authRoutes } from './modules/auth/auth.routes';
import { hackathonRoutes } from './modules/hackathon/hackathon.routes';
import { timelineRoutes } from './modules/timeline/timeline.routes';
import { resourcesRoutes } from './modules/resources/resources.routes';
import { themesRoutes } from './modules/themes/themes.routes';
import { evaluationRoutes } from './modules/evaluation/evaluation.routes';
import { auditRoutes } from './modules/audit/audit.routes';
import { mentorRoutes } from './modules/mentor/mentor.routes';
import { participantsRoutes } from './modules/participants/participants.routes';
import { syncRoutes } from './modules/sync/sync.routes';
import { analyticsRoutes } from './modules/analytics/analytics.routes';
import { overviewRoutes } from './modules/overview/overview.routes';

const startTime = Date.now();

async function buildApp(): Promise<FastifyInstance> {
  const env = loadBaseEnv();
  const config = createAppConfig(env);
  const logger = createLogger({
    serviceName: 'organizer-api',
    level: config.logLevel,
    isProduction: config.isProduction,
  });

  const app = Fastify({
    logger: false,
    trustProxy: true,
    genReqId: () => randomUUID(),
  });

  // ---- Security headers (manual helmet subset to avoid extra dep) ----
  app.addHook('onSend', async (_req, reply) => {
    reply.header('x-dns-prefetch-control', 'off');
    reply.header('x-frame-options', 'SAMEORIGIN');
    reply.header('x-content-type-options', 'nosniff');
    reply.header('x-xss-protection', '0');
    reply.header('referrer-policy', 'no-referrer');
    reply.header('cross-origin-opener-policy', 'same-origin');
    if (config.isProduction) {
      reply.header('strict-transport-security', 'max-age=15552000; includeSubDomains');
    }
  });

  // ---- CORS strict allowlist ----
  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (config.corsOrigins.includes(origin as string)) return cb(null, true);
      cb(new Error(`CORS blocked: ${origin}`), false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'X-Request-Id', 'X-Correlation-Id'],
    exposedHeaders: ['X-Request-Id'],
  });

  // ---- Request ID ----
  app.addHook('onRequest', async (req, reply) => {
    const incoming =
      (req.headers['x-request-id'] as string) ||
      (req.headers['x-correlation-id'] as string) ||
      (req as unknown as { id: string }).id;
    const requestId = incoming && incoming.length >= 8 ? incoming : randomUUID();
    (req as unknown as Record<string, unknown>).requestId = requestId;
    reply.header('x-request-id', requestId);
  });

  // Simple in-memory rate limiting foundation (Redis-backed in production via @hmt/database)
  // Skip aggressive limiting in test env to avoid flaky tests; use higher threshold or bypass
  // Bounded map with periodic sweep to prevent memory exhaustion under DDoS.
  const rateMap = new Map<string, { count: number; resetAt: number }>();
  const RATE_MAP_MAX = 10000;
  let lastRateSweep = Date.now();
  app.addHook('preHandler', async (req, reply) => {
    if (req.url.startsWith('/api/v1/health')) return;
    // In test, allow much higher limit (or effectively disable)
    if (config.isTest) return;
    // With trustProxy:true, req.ip is the correct client IP — do not trust
    // X-Forwarded-For directly (spoofable).
    const key = req.ip ?? 'unknown';
    const now = Date.now();
    if (now - lastRateSweep > 30000 || rateMap.size > RATE_MAP_MAX) {
      lastRateSweep = now;
      for (const [k, v] of rateMap) {
        if (now > v.resetAt) rateMap.delete(k);
      }
      while (rateMap.size > RATE_MAP_MAX) {
        const oldest = rateMap.keys().next();
        if (oldest.done) break;
        rateMap.delete(oldest.value);
      }
    }
    const entry = rateMap.get(key);
    if (!entry || now > entry.resetAt) {
      rateMap.set(key, { count: 1, resetAt: now + config.rateLimit.ttlMs });
      reply.header('x-ratelimit-limit', String(config.rateLimit.max));
      reply.header('x-ratelimit-remaining', String(config.rateLimit.max - 1));
      return;
    }
    if (entry.count >= config.rateLimit.max) {
      reply.header('x-ratelimit-limit', String(config.rateLimit.max));
      reply.header('x-ratelimit-remaining', '0');
      return reply.status(429).send({
        version: 'v1',
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many requests',
          requestId: (req as unknown as Record<string, unknown>).requestId,
        },
      });
    }
    entry.count += 1;
    reply.header('x-ratelimit-limit', String(config.rateLimit.max));
    reply.header('x-ratelimit-remaining', String(config.rateLimit.max - entry.count));
  });

  // ---- OpenAPI ----
  await app.register(swagger, {
    openapi: {
      openapi: '3.0.3',
      info: {
        title: 'HMT Organizer API',
        description: 'Organizer-facing Hackathon Management API - Foundation',
        version: '1.0.0',
      },
      servers: [{ url: '/api/v1' }],
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        },
      },
    },
  });
  await app.register(swaggerUi, {
    routePrefix: '/api/docs',
    uiConfig: { docExpansion: 'list', deepLinking: true },
  });

  // ---- Health & readiness (must distinguish API, Postgres, Neo4j, Redis) ----
  type CheckStatus = 'ok' | 'down' | 'unknown';
  interface HealthResponse {
    status: 'ok' | 'degraded' | 'down';
    service: string;
    version: string;
    uptimeSeconds: number;
    checks: { api: CheckStatus; postgres: CheckStatus; neo4j: CheckStatus; redis: CheckStatus };
    latencyMs?: { postgres?: number | undefined; neo4j?: number | undefined; redis?: number | undefined };
    timestamp: string;
  }

  async function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
    let timeoutHandle: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<T>((resolve) => {
      timeoutHandle = setTimeout(() => resolve(fallback), ms);
    });
    try {
      const result = await Promise.race([promise, timeoutPromise]);
      if (timeoutHandle) clearTimeout(timeoutHandle);
      return result;
    } catch (e) {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      throw e;
    }
  }

  async function buildHealth(detailed: boolean): Promise<HealthResponse> {
    let postgres: CheckStatus = 'unknown';
    let neo4j: CheckStatus = 'unknown';
    let redis: CheckStatus = 'unknown';
    let pgLatency: number | undefined;
    let neoLatency: number | undefined;
    let redisLatency: number | undefined;

    if (detailed) {
      try {
        const r = await withTimeout(checkPostgresHealth(), 2000, { ok: false, error: 'timeout' } as any);
        postgres = r.ok ? 'ok' : 'down';
        pgLatency = (r as any).latencyMs;
      } catch {
        postgres = 'down';
      }
      try {
        const driver = getNeo4jDriver({
          uri: env.NEO4J_URI,
          username: env.NEO4J_USERNAME,
          password: env.NEO4J_PASSWORD,
          database: env.NEO4J_DATABASE,
        });
        const r = await withTimeout(
          checkNeo4jHealth(
            { uri: env.NEO4J_URI, username: env.NEO4J_USERNAME, password: env.NEO4J_PASSWORD, database: env.NEO4J_DATABASE },
            driver,
          ),
          2000,
          { ok: false, error: 'timeout' } as any,
        );
        neo4j = r.ok ? 'ok' : 'down';
        neoLatency = (r as any).latencyMs;
      } catch {
        neo4j = 'down';
      }
      try {
        const client = getRedisClient({ url: env.REDIS_URL, prefix: env.REDIS_PREFIX });
        const r = await withTimeout(checkRedisHealth(client), 2000, { ok: false, error: 'timeout' } as any);
        redis = r.ok ? 'ok' : 'down';
        redisLatency = (r as any).latencyMs;
      } catch {
        redis = 'down';
      }
    }
    const api: CheckStatus = 'ok';
    const anyDown = detailed && [postgres, neo4j, redis].some((s) => s === 'down');
    const allDown = detailed && [postgres, neo4j, redis].every((s) => s === 'down');
    let status: HealthResponse['status'] = 'ok';
    if (detailed) {
      if (allDown) status = 'down';
      else if (anyDown) status = 'degraded';
    }
    return {
      status,
      service: 'organizer-api',
      version: '0.1.0',
      uptimeSeconds: Math.floor((Date.now() - startTime) / 1000),
      checks: { api, postgres, neo4j, redis },
      ...(detailed ? { latencyMs: { postgres: pgLatency, neo4j: neoLatency, redis: redisLatency } } : {}),
      timestamp: new Date().toISOString(),
    };
  }

  // Root
  app.get('/', async () => ({ service: 'hmt-organizer-api', version: '0.1.0', docs: '/api/docs' }));
  app.get('/api/v1', async () => ({ service: 'hmt-organizer-api', version: '0.1.0', docs: '/api/docs' }));

  // Health endpoints under /api/v1/health (consistent versioning)
  app.get('/api/v1/health', async () => buildHealth(false));
  app.get('/api/v1/health/live', async () => buildHealth(false));
  app.get('/api/v1/health/ready', async () => buildHealth(true));
  // Also unprefixed for k8s compatibility
  app.get('/health', async () => buildHealth(false));
  app.get('/health/ready', async () => buildHealth(true));

  // OpenAPI JSON at /api/docs-json
  app.get('/api/docs-json', async () => app.swagger());

  // ---- Safe error handling with secret redaction ----
  app.setErrorHandler((error, req, reply) => {
    const requestId = (req as unknown as Record<string, unknown>).requestId ?? req.id;
    const status = (error as unknown as { statusCode?: number }).statusCode ?? 500;
    logger.error({ err: error, requestId, url: req.url, status }, 'request error');
    const message = status === 500 && config.isProduction ? 'Internal server error' : error.message;
    reply.status(status).header('x-request-id', String(requestId)).send({
      version: 'v1',
      error: {
        code: status === 500 ? 'INTERNAL_ERROR' : (error as unknown as { code?: string }).code ?? 'REQUEST_FAILED',
        message,
        requestId: String(requestId),
      },
    });
  });

  // ---- API v1 prefix ---- use prefix for business routes
  const jwtConfig = {
    accessSecret: env.JWT_ACCESS_SECRET,
    refreshSecret: env.JWT_REFRESH_SECRET,
    accessTtlSec: env.JWT_ACCESS_TTL_SECONDS,
    refreshTtlSec: env.JWT_REFRESH_TTL_SECONDS,
    issuer: 'hmt',
    audience: 'hmt:api',
  };

  // Register business routes under /api/v1 prefix
  await app.register(
    async (instance) => {
      await authRoutes(instance, { jwtConfig });
      await hackathonRoutes(instance, { jwtConfig });
      await timelineRoutes(instance, { jwtConfig });
      await resourcesRoutes(instance, { jwtConfig });
      await themesRoutes(instance, { jwtConfig });
      await evaluationRoutes(instance, { jwtConfig });
      await auditRoutes(instance, { jwtConfig });
      await mentorRoutes(instance, { jwtConfig });
      await participantsRoutes(instance, { jwtConfig });
      await syncRoutes(instance, { jwtConfig });
      await analyticsRoutes(instance, { jwtConfig });
      await overviewRoutes(instance, { jwtConfig });
    },
    { prefix: '/api/v1' },
  );

  // ---- Logging hook after response ----
  app.addHook('onResponse', async (req, reply) => {
    const requestId = (req as unknown as Record<string, unknown>).requestId ?? req.id;
    logger.info(
      { requestId, method: req.method, url: req.url, statusCode: reply.statusCode, durationMs: reply.elapsedTime ?? 0 },
      'request completed',
    );
  });

  return app;
}

async function start(): Promise<void> {
  const env = loadBaseEnv();
  const config = createAppConfig(env);
  if (isDevSyncSecret()) {
    // console.warn is allowed by the no-console rule (warn/error permitted).
    console.warn(
      'SYNC uses the well-known dev secret (no SYNC_SHARED_SECRET configured). Set a real SYNC_SHARED_SECRET on both APIs before any production use.',
    );
  }
  const app = await buildApp();
  const port = env.ORGANIZER_API_PORT;
  // Dual-stack bind: `localhost` resolves to ::1 first on modern systems and
  // browsers attempt IPv6; an IPv4-only socket refuses them, which surfaces as
  // a misleading CORS/NetworkError. '::' accepts both families (bindv6only=0).
  await app.listen({ port, host: '::' });
  // eslint-disable-next-line no-console
  console.log(`Organizer API listening on ${port} (env=${config.nodeEnv})`);
  // eslint-disable-next-line no-console
  console.log(`CORS origins: ${config.corsOrigins.join(',')}`);
}

if (require.main === module) {
  void start();
}

export { buildApp };
