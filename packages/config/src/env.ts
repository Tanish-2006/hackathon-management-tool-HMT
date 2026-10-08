import { z } from 'zod';

/**
 * Shared environment schema.
 * Each app (participant-api, organizer-api) validates its own env using this base + overrides.
 * Never trust defaults in production; fail fast if required secrets missing.
 */

const baseEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

  // PostgreSQL
  DATABASE_URL: z.string().min(1).describe('PostgreSQL connection string'),
  DATABASE_POOL_MIN: z.coerce.number().int().min(1).default(2),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).default(10),

  // Neo4j
  NEO4J_URI: z.string().min(1).default('bolt://localhost:7687'),
  NEO4J_USERNAME: z.string().min(1).default('neo4j'),
  NEO4J_PASSWORD: z.string().min(1),
  NEO4J_DATABASE: z.string().min(1).default('neo4j'),

  // Redis
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),
  REDIS_PREFIX: z.string().default('hmt:'),

  // JWT
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().min(60).default(900), // 15m
  JWT_REFRESH_TTL_SECONDS: z.coerce.number().int().min(60).default(604800), // 7d

  // App ports — canonical dev: participant :3000, organizer :3002, frontend :5173.
  // :3001 is legacy and MUST NOT be used for new configuration.
  PARTICIPANT_API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  ORGANIZER_API_PORT: z.coerce.number().int().min(1).max(65535).default(3002),

  // Organizer → participant sync push target (base URL incl. /api/v1).
  PARTICIPANT_API_URL: z.string().default('http://localhost:3000/api/v1'),

  // Shared secret authenticating organizer → participant sync calls.
  // Empty disables push (publish still succeeds locally). Never logged.
  SYNC_SHARED_SECRET: z.string().default(''),

  // CORS
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:3000,http://localhost:3002,http://localhost:5173,http://127.0.0.1:5173')
    .transform((v) => v.split(',').map((s) => s.trim())),

  // Rate limiting
  RATE_LIMIT_TTL_MS: z.coerce.number().int().min(1000).default(60000),
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(100),

  // AI Gateway (provider-independent)
  AI_PROVIDER: z.enum(['mock', 'external']).default('mock'),
  AI_API_KEY: z.string().optional().default(''),
  AI_MODEL: z.string().optional().default(''),
  AI_BASE_URL: z.string().optional().default(''),
  AI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(15000),
  AI_MAX_RETRIES: z.coerce.number().int().min(0).max(3).default(1),

  // GitHub OAuth (READ-ONLY, no write) — Classic OAuth (broad repo scope, not for prod)
  GITHUB_CLIENT_ID: z.string().optional().default(''),
  GITHUB_CLIENT_SECRET: z.string().optional().default(''),
  GITHUB_CALLBACK_URL: z.string().optional().default(''),
  GITHUB_SCOPES: z.string().optional().default('repo read:user'),
  // GitHub App (production read-only, fine-grained)
  GITHUB_APP_ID: z.string().optional().default(''),
  GITHUB_PRIVATE_KEY: z.string().optional().default(''),
  GITHUB_APP_NAME: z.string().optional().default(''),
  GITHUB_INSTALLATION_ID: z.string().optional().default(''),
});

export type BaseEnv = z.infer<typeof baseEnvSchema>;

export const participantEnvSchema = baseEnvSchema.extend({
  PARTICIPANT_API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
});

export const organizerEnvSchema = baseEnvSchema.extend({
  ORGANIZER_API_PORT: z.coerce.number().int().min(1).max(65535).default(3002),
});

export type ParticipantEnv = z.infer<typeof participantEnvSchema>;
export type OrganizerEnv = z.infer<typeof organizerEnvSchema>;

export function validateEnv<T extends z.ZodTypeAny>(schema: T, env: NodeJS.ProcessEnv = process.env): z.infer<T> {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const formatted = parsed.error.format();
    // Redact secrets from error output — never leak API keys
    const message = JSON.stringify(formatted, null, 2).replace(
      /(JWT.*SECRET|PASSWORD|DATABASE_URL|REDIS_URL|AI_API_KEY|GITHUB_CLIENT_SECRET|GITHUB_PRIVATE_KEY)[^"]*"[^"]*"/g,
      '$1": "[REDACTED]"',
    );
    throw new Error(`Invalid environment variables:\n${message}`);
  }
  return parsed.data as z.infer<T>;
}

export function loadBaseEnv(env: NodeJS.ProcessEnv = process.env): BaseEnv {
  return validateEnv(baseEnvSchema, env);
}
