import { Injectable, Logger } from '@nestjs/common';
import { loadBaseEnv } from '@hmt/config';
import { checkPostgresHealth } from '@hmt/database';
import { checkNeo4jHealth } from '@hmt/database';
import { checkRedisHealth, getRedisClient } from '@hmt/database';
import { getNeo4jDriver } from '@hmt/database';

export type CheckStatus = 'ok' | 'down' | 'unknown';

export interface HealthResponse {
  status: 'ok' | 'degraded' | 'down';
  service: string;
  version: string;
  uptimeSeconds: number;
  checks: {
    api: CheckStatus;
    postgres: CheckStatus;
    neo4j: CheckStatus;
    redis: CheckStatus;
  };
  latencyMs?: {
    postgres?: number | undefined;
    neo4j?: number | undefined;
    redis?: number | undefined;
  };
  timestamp: string;
}

const startTime = Date.now();

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  async getHealth(): Promise<HealthResponse> {
    return this.buildResponse(false);
  }

  async getReadiness(): Promise<HealthResponse> {
    return this.buildResponse(true);
  }

  private async buildResponse(detailed: boolean): Promise<HealthResponse> {
    let postgres: CheckStatus = 'unknown';
    let neo4j: CheckStatus = 'unknown';
    let redis: CheckStatus = 'unknown';
    let pgLatency: number | undefined;
    let neoLatency: number | undefined;
    let redisLatency: number | undefined;

    if (detailed) {
      const isProd = process.env.NODE_ENV === 'production';
      // Attempt to check each dependency; failures are expected when not running.
      // Timeouts prevent readiness from hanging; misconfig in prod reports down (not unknown).
      try {
        const env = this.safeLoadEnv();
        if (env?.DATABASE_URL) {
          const r = await this.withTimeout(checkPostgresHealth(), 2000, { ok: false, latencyMs: undefined } as any);
          postgres = r.ok ? 'ok' : 'down';
          pgLatency = r.latencyMs;
        } else {
          postgres = isProd ? 'down' : 'unknown';
        }
      } catch (e) {
        this.logger.warn(`postgres health check failed: ${e instanceof Error ? e.message : String(e)}`);
        postgres = 'down';
      }

      try {
        const env = this.safeLoadEnv();
        if (env?.NEO4J_URI && env?.NEO4J_PASSWORD) {
          const driver = getNeo4jDriver({
            uri: env.NEO4J_URI,
            username: env.NEO4J_USERNAME,
            password: env.NEO4J_PASSWORD,
            database: env.NEO4J_DATABASE,
          });
          const r = await this.withTimeout(
            checkNeo4jHealth(
              {
                uri: env.NEO4J_URI,
                username: env.NEO4J_USERNAME,
                password: env.NEO4J_PASSWORD,
                database: env.NEO4J_DATABASE,
              },
              driver,
            ),
            2000,
            { ok: false, latencyMs: undefined } as any,
          );
          neo4j = r.ok ? 'ok' : 'down';
          neoLatency = r.latencyMs;
        } else {
          neo4j = isProd ? 'down' : 'unknown';
        }
      } catch (e) {
        this.logger.warn(`neo4j health check failed: ${e instanceof Error ? e.message : String(e)}`);
        neo4j = 'down';
      }

      try {
        const env = this.safeLoadEnv();
        if (env?.REDIS_URL) {
          const client = getRedisClient({ url: env.REDIS_URL, prefix: env.REDIS_PREFIX });
          const r = await this.withTimeout(checkRedisHealth(client), 2000, { ok: false, latencyMs: undefined } as any);
          redis = r.ok ? 'ok' : 'down';
          redisLatency = r.latencyMs;
        } else {
          redis = isProd ? 'down' : 'unknown';
        }
      } catch (e) {
        this.logger.warn(`redis health check failed: ${e instanceof Error ? e.message : String(e)}`);
        redis = 'down';
      }
    } else {
      // Liveness: only API itself
      postgres = 'unknown';
      neo4j = 'unknown';
      redis = 'unknown';
    }

    const api: CheckStatus = 'ok';
    const allDown = detailed && [postgres, neo4j, redis].every((s) => s === 'down');
    const anyDown = detailed && [postgres, neo4j, redis].some((s) => s === 'down');
    let status: HealthResponse['status'] = 'ok';
    if (detailed) {
      if (allDown) status = 'down';
      else if (anyDown) status = 'degraded';
      else status = 'ok';
    }

    return {
      status,
      service: 'participant-api',
      version: '0.1.0',
      uptimeSeconds: Math.floor((Date.now() - startTime) / 1000),
      checks: { api, postgres, neo4j, redis },
      ...(detailed ? { latencyMs: { postgres: pgLatency, neo4j: neoLatency, redis: redisLatency } } : {}),
      timestamp: new Date().toISOString(),
    };
  }

  private safeLoadEnv(): ReturnType<typeof loadBaseEnv> | null {
    try {
      return loadBaseEnv();
    } catch {
      return null;
    }
  }

  private async withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
    let handle: NodeJS.Timeout | undefined;
    const timeout = new Promise<T>((resolve) => {
      handle = setTimeout(() => resolve(fallback), ms);
    });
    try {
      const result = await Promise.race([promise, timeout]);
      if (handle) clearTimeout(handle);
      return result;
    } catch (e) {
      if (handle) clearTimeout(handle);
      throw e;
    }
  }
}
