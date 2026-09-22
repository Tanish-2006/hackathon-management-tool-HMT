import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import neo4j, { Driver, Session } from 'neo4j-driver';

@Injectable()
export class Neo4jService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(Neo4jService.name);
  private driver: Driver | null = null;

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit() {
    const env = this.configService.get<string>('NODE_ENV', 'development');
    const isProd = env === 'production';
    if (env === 'test') {
      this.logger.log(
        'Test environment detected — Neo4j driver mocked (no external connection).',
      );
      this.driver = null;
      return;
    }

    const uri = this.configService.get<string>(
      'NEO4J_URI',
      'bolt://localhost:7687',
    );
    // Canonical name is NEO4J_USERNAME (packages/config); support legacy NEO4J_USER.
    const user =
      this.configService.get<string>('NEO4J_USERNAME', '') ||
      this.configService.get<string>('NEO4J_USER', 'neo4j') ||
      process.env.NEO4J_USERNAME ||
      'neo4j';
    const password = this.configService.get<string>(
      'NEO4J_PASSWORD',
      'hmt_password',
    );

    // Fast fallback for local demo — no external Neo4j required
    const shouldAttempt =
      process.env.ENABLE_NEO4J === 'true' ||
      (!uri.includes('localhost') && !uri.includes('127.0.0.1'));
    if (!shouldAttempt) {
      const msg =
        'Neo4j fallback active (in-memory graph). Set ENABLE_NEO4J=true to connect to external Neo4j.';
      if (isProd) {
        this.logger.error(
          `${msg} PRODUCTION WARNING: relationship workloads are degraded; PostgreSQL remains source of truth.`,
        );
      } else {
        this.logger.log(msg);
      }
      this.driver = null;
      return;
    }

    try {
      this.driver = neo4j.driver(uri, neo4j.auth.basic(user, password));
      await Promise.race([
        this.driver.verifyConnectivity().catch((e: any) => {
          this.logger.warn(
            `Neo4j verification failed: ${e.message} — fallback to in-memory mock.`,
          );
          this.driver = null;
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Neo4j verify timeout')), 900),
        ),
      ]).catch(() => {
        this.logger.warn('Neo4j verify timeout — fallback to in-memory mock.');
        this.driver = null;
      });
      if (this.driver)
        this.logger.log(`Initialized Neo4j driver for URI: ${uri}`);
    } catch (error: any) {
      this.logger.warn(
        `Failed to connect to Neo4j database: ${error.message}. Fallback to in-memory store.`,
      );
      this.driver = null;
    }
  }

  async onModuleDestroy() {
    if (this.driver) {
      await this.driver.close();
    }
  }

  getSession(): Session | null {
    if (!this.driver) return null;
    return this.driver.session();
  }

  async write(query: string, params: Record<string, any> = {}): Promise<any[]> {
    const session = this.getSession();
    if (!session) {
      this.logger.debug(`[Neo4j Mock Execution] ${query}`);
      return [];
    }
    try {
      const result = await session.executeWrite((tx) => tx.run(query, params));
      return result.records.map((r) => r.toObject());
    } catch (err) {
      this.logger.warn(`Neo4j query execution error: ${err.message}`);
      return [];
    } finally {
      await session.close();
    }
  }

  async read(query: string, params: Record<string, any> = {}): Promise<any[]> {
    const session = this.getSession();
    if (!session) {
      this.logger.debug(`[Neo4j Mock Read] ${query}`);
      return [];
    }
    try {
      const result = await session.executeRead((tx) => tx.run(query, params));
      return result.records.map((r) => r.toObject());
    } catch (err) {
      this.logger.warn(`Neo4j query execution error: ${err.message}`);
      return [];
    } finally {
      await session.close();
    }
  }
}
