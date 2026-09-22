import { describe, it, expect } from 'vitest';
import { validateEnv, loadBaseEnv } from './env';
import { z } from 'zod';

describe('config - env validation', () => {
  it('fails without required secrets and redacts', () => {
    const schema = z.object({ JWT_ACCESS_SECRET: z.string().min(32), DATABASE_URL: z.string().min(1) });
    expect(() => validateEnv(schema, { JWT_ACCESS_SECRET: 'short', DATABASE_URL: '' } as any)).toThrow();
    try {
      validateEnv(schema, { JWT_ACCESS_SECRET: 'short' } as any);
    } catch (e) {
      expect((e as Error).message).not.toContain('short'); // should not leak short value directly? At least format includes structure
    }
  });

  it('loads with minimal env (uses defaults)', () => {
    // Provide minimal valid env
    const env = {
      DATABASE_URL: 'postgresql://hmt:pwd@localhost:5432/hmt',
      NEO4J_PASSWORD: 'neo4jpwd',
      JWT_ACCESS_SECRET: 'a'.repeat(32),
      JWT_REFRESH_SECRET: 'b'.repeat(32),
      NEO4J_URI: 'bolt://localhost:7687',
      NEO4J_USERNAME: 'neo4j',
      NEO4J_DATABASE: 'neo4j',
      REDIS_URL: 'redis://localhost:6379',
      NODE_ENV: 'test',
    } as NodeJS.ProcessEnv;
    const parsed = loadBaseEnv(env);
    expect(parsed.DATABASE_URL).toContain('postgresql');
    expect(parsed.NODE_ENV).toBe('test');
  });
});
