import { describe, it, expect, beforeEach } from 'vitest';
import { HealthService } from './health.service';

describe('participant-api - HealthService', () => {
  let svc: HealthService;
  beforeEach(() => {
    svc = new HealthService();
  });

  it('liveness returns ok with unknown deps', async () => {
    const h = await svc.getHealth();
    expect(h.status).toBe('ok');
    expect(h.service).toBe('participant-api');
    expect(h.checks.api).toBe('ok');
    expect(h.checks.postgres).toBe('unknown');
    expect(h.checks.neo4j).toBe('unknown');
    expect(h.checks.redis).toBe('unknown');
    expect(h.uptimeSeconds).toBeGreaterThanOrEqual(0);
  });

  it('readiness distinguishes deps (will be degraded/down when DB not running)', async () => {
    // This will attempt real checks; if Docker not running, expect degraded/down, not throw
    const r = await svc.getReadiness();
    expect(['ok', 'degraded', 'down']).toContain(r.status);
    expect(r.checks.api).toBe('ok');
    // latencyMs present for detailed check
    expect(r).toHaveProperty('latencyMs');
  });
});
