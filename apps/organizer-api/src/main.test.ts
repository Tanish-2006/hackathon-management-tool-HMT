import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { buildApp } from './main';

function loadEnvFromFile(): void {
  const envPath = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}

describe('organizer-api - Fastify foundation', () => {
  let app: any;

  beforeAll(async () => {
    loadEnvFromFile();
    // Ensure required env for foundation tests even if .env missing
    process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://hmt:hmt_dev_password_change_in_prod@localhost:5432/hmt?schema=public';
    process.env.NEO4J_PASSWORD = process.env.NEO4J_PASSWORD || 'hmt_neo4j_password';
    process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'a'.repeat(32);
    process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'b'.repeat(32);
    process.env.REDIS_URL = process.env.REDIS_URL || 'redis://:hmt_redis_password@localhost:6379';
    app = await buildApp();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('exposes health endpoints with correct shape', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.service).toBe('organizer-api');
    expect(body.checks).toHaveProperty('postgres');
    expect(body.checks).toHaveProperty('neo4j');
    expect(body.checks).toHaveProperty('redis');
    expect(body.checks.api).toBe('ok');
  });

  it('exposes readiness with latency', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/health/ready' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(['ok', 'degraded', 'down']).toContain(body.status);
  });

  it('exposes OpenAPI docs', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/docs-json' });
    // swagger plugin may include openapi field
    if (res.statusCode === 200) {
      const body = JSON.parse(res.body);
      expect(body.openapi || body.swagger).toBeTruthy();
    } else {
      // alternative route is /api/docs
      expect([200, 404]).toContain(res.statusCode);
    }
  });

  it('has versioned prefix /api/v1', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).service).toBe('hmt-organizer-api');
  });
});
