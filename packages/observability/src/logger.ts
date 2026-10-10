import pino, { Logger } from 'pino';

export interface LoggerOptions {
  level?: string;
  serviceName: string;
  isProduction?: boolean;
}

const REDACTED_PATHS = [
  'password',
  '*.password',
  '*.*.password',
  'req.headers.authorization',
  'req.headers.cookie',
  '*.accessToken',
  '*.*.accessToken',
  '*.refreshToken',
  '*.*.refreshToken',
  '*.secret',
  '*.*.secret',
  '*.SECRET',
  '*.apiKey',
  '*.API_KEY',
  '*.privateKey',
  '*.token',
  '*.authorization',
  'DATABASE_URL',
  '*.DATABASE_URL',
  '*.*.DATABASE_URL',
  'NEO4J_PASSWORD',
  '*.NEO4J_PASSWORD',
  '*.NEO4J_USERNAME',
  '*.NEO4J_URI',
  'REDIS_URL',
  '*.REDIS_URL',
  '*.REDIS_PREFIX',
  'JWT_ACCESS_SECRET',
  '*.JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET',
  '*.JWT_REFRESH_SECRET',
  'SYNC_SHARED_SECRET',
  '*.SYNC_SHARED_SECRET',
  'AI_API_KEY',
  '*.AI_API_KEY',
  'GITHUB_TOKEN_ENCRYPTION_KEY',
  '*.GITHUB_TOKEN_ENCRYPTION_KEY',
  'ENCRYPTION_KEY',
  '*.ENCRYPTION_KEY',
  'CREDENTIAL_ENCRYPTION_KEY',
  '*.CREDENTIAL_ENCRYPTION_KEY',
];

/**
 * Structured logger with secret redaction.
 * All logs MUST go through this factory to ensure consistent format and redaction.
 */
export function createLogger(options: LoggerOptions): Logger {
  const { level = 'info', serviceName, isProduction = false } = options;

  const opts: Parameters<typeof pino>[0] = {
    level,
    base: { service: serviceName },
    redact: {
      paths: REDACTED_PATHS,
      censor: '[REDACTED]',
      remove: false,
    },
    formatters: {
      level(label: string) {
        return { level: label };
      },
    },
  };
  if (!isProduction) {
    (opts as Record<string, unknown>).transport = {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname',
      },
    };
  }
  return pino(opts) as unknown as Logger;
}

// Singleton per service will be created by app bootstrap; helper for tests
export function createTestLogger(): Logger {
  return pino({ level: 'silent' }) as unknown as Logger;
}
