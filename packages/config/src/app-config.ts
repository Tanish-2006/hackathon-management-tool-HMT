import type { BaseEnv } from './env';

export interface AppConfig {
  nodeEnv: BaseEnv['NODE_ENV'];
  logLevel: BaseEnv['LOG_LEVEL'];
  isProduction: boolean;
  isDevelopment: boolean;
  isTest: boolean;
  database: {
    url: string;
    poolMin: number;
    poolMax: number;
  };
  neo4j: {
    uri: string;
    username: string;
    password: string;
    database: string;
  };
  redis: {
    url: string;
    prefix: string;
  };
  jwt: {
    accessSecret: string;
    refreshSecret: string;
    accessTtlSec: number;
    refreshTtlSec: number;
  };
  corsOrigins: string[];
  rateLimit: {
    ttlMs: number;
    max: number;
  };
  ai: {
    provider: 'mock' | 'external';
    apiKey: string;
    model: string;
    baseUrl: string;
    timeoutMs: number;
    maxRetries: number;
  };
  github: {
    clientId: string;
    clientSecret: string;
    callbackUrl: string;
    scopes: string;
    appId: string;
    privateKey: string;
    appName: string;
    installationId: string;
  };
}

export function createAppConfig(env: BaseEnv): AppConfig {
  return {
    nodeEnv: env.NODE_ENV,
    logLevel: env.LOG_LEVEL,
    isProduction: env.NODE_ENV === 'production',
    isDevelopment: env.NODE_ENV === 'development',
    isTest: env.NODE_ENV === 'test',
    database: {
      url: env.DATABASE_URL,
      poolMin: env.DATABASE_POOL_MIN,
      poolMax: env.DATABASE_POOL_MAX,
    },
    neo4j: {
      uri: env.NEO4J_URI,
      username: env.NEO4J_USERNAME,
      password: env.NEO4J_PASSWORD,
      database: env.NEO4J_DATABASE,
    },
    redis: {
      url: env.REDIS_URL,
      prefix: env.REDIS_PREFIX,
    },
    jwt: {
      accessSecret: env.JWT_ACCESS_SECRET,
      refreshSecret: env.JWT_REFRESH_SECRET,
      accessTtlSec: env.JWT_ACCESS_TTL_SECONDS,
      refreshTtlSec: env.JWT_REFRESH_TTL_SECONDS,
    },
    corsOrigins: env.CORS_ORIGINS as unknown as string[],
    rateLimit: {
      ttlMs: env.RATE_LIMIT_TTL_MS,
      max: env.RATE_LIMIT_MAX,
    },
    ai: {
      provider: env.AI_PROVIDER as 'mock' | 'external',
      apiKey: env.AI_API_KEY ?? '',
      model: env.AI_MODEL ?? '',
      baseUrl: env.AI_BASE_URL ?? '',
      timeoutMs: env.AI_TIMEOUT_MS,
      maxRetries: env.AI_MAX_RETRIES,
    },
    github: {
      clientId: env.GITHUB_CLIENT_ID ?? '',
      clientSecret: env.GITHUB_CLIENT_SECRET ?? '',
      callbackUrl: env.GITHUB_CALLBACK_URL ?? '',
      scopes: env.GITHUB_SCOPES ?? 'repo read:user',
      appId: env.GITHUB_APP_ID ?? '',
      privateKey: env.GITHUB_PRIVATE_KEY ?? '',
      appName: env.GITHUB_APP_NAME ?? '',
      installationId: env.GITHUB_INSTALLATION_ID ?? '',
    },
  };
}
