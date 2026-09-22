import pino, { Logger } from 'pino';

export interface LoggerOptions {
  level?: string;
  serviceName: string;
  isProduction?: boolean;
}

const REDACTED_PATHS = [
  'password',
  '*.password',
  'req.headers.authorization',
  'req.headers.cookie',
  '*.accessToken',
  '*.refreshToken',
  '*.secret',
  '*.DATABASE_URL',
  '*.NEO4J_PASSWORD',
  '*.REDIS_URL',
  '*.JWT_ACCESS_SECRET',
  '*.JWT_REFRESH_SECRET',
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
