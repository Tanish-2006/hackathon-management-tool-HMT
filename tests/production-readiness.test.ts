import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

/**
 * Production-readiness regression tests.
 * Guards the hardening pass: auth fallbacks, ports, rate limits, revocation,
 * admin escalation, mentor enforcement, AI redaction. No live infra required.
 */

function read(p: string): string {
  return fs.readFileSync(p, 'utf8');
}

describe('HMT production readiness', () => {
  it('frontend has no demo identity as authenticated fallback', () => {
    const app = read('apps/participant-api/frontend/src/App.tsx');
    expect(app).not.toContain('Kai Morales');
    expect(app).not.toContain('Good morning, Kai');
    expect(app).not.toMatch(/role\s*\?\?\s*['"]ORGANIZER['"]/);
    expect(app).not.toContain('demoUser');
    const profile = read('apps/participant-api/frontend/src/pages/participant/profile.tsx');
    expect(profile).not.toContain('Kai Morales');
  });

  it('frontend auth uses centralized config + real session (no localhost:3001 default)', () => {
    const cfg = read('apps/participant-api/frontend/src/services/api-config.ts');
    expect(cfg).toContain('VITE_API_URL');
    expect(cfg).toContain('VITE_ORGANIZER_API_URL');
    expect(cfg).toContain('localhost:3000');
    expect(cfg).toContain('localhost:3002');
    expect(cfg).not.toContain("'http://localhost:3001");
    expect(fs.existsSync('apps/participant-api/frontend/src/services/auth-context.tsx')).toBe(true);
    const ctx = read('apps/participant-api/frontend/src/services/auth-context.tsx');
    expect(ctx).toContain('/auth/me');
    expect(ctx).toContain('clearAuthTokens');
    const app = read('apps/participant-api/frontend/src/App.tsx');
    expect(app).toContain('AuthProvider');
    expect(app).toContain('RequireParticipant');
    expect(app).toContain('RequireAdmin');
    expect(app).toContain('Verifying session');
  });

  it('canonical ports: participant :3000, organizer :3002; no :3001 in prod config', () => {
    const envExample = read('.env.example');
    expect(envExample).toContain('PARTICIPANT_API_PORT=3000');
    expect(envExample).toContain('ORGANIZER_API_PORT=3002');
    const envTs = read('packages/config/src/env.ts');
    expect(envTs).toContain('default(3000)');
    expect(envTs).toContain('default(3002)');
    expect(envTs).toContain('localhost:5173');
  });

  it('participant rate limiting is enforced on auth/AI/GitHub/sensitive routes', () => {
    const auth = read('apps/participant-api/src/auth/auth.controller.ts');
    expect(auth).toContain('AuthRateLimitGuard');
    const ai = read('apps/participant-api/src/ai/ai.controller.ts');
    expect(ai).toContain('AiRateLimitGuard');
    const gh = read('apps/participant-api/src/github/github.controller.ts');
    expect(gh).toContain('GithubRateLimitGuard');
    const ra = read('apps/participant-api/src/repository-access/repository-access.controller.ts');
    expect(ra).toContain('SensitiveRateLimitGuard');
    const guard = read('apps/participant-api/src/common/guards/rate-limit.guard.ts');
    expect(guard).toContain('RATE_LIMITED');
    expect(guard).toContain('MAX_BUCKETS');
  });

  it('JWT access revocation is checked at validation (logout/session revoke/logout-all)', () => {
    const strategy = read('apps/participant-api/src/auth/strategies/jwt.strategy.ts');
    expect(strategy).toContain('hmt:auth:revoked');
    expect(strategy).toContain('hmt:auth:jti');
    const svc = read('apps/participant-api/src/auth/auth.service.ts');
    expect(svc).toContain('hmt:auth:jti:');
    expect(svc).toContain('hmt:auth:revoked:user:');
  });

  it('organizer denies second ADMIN self-registration (privilege escalation)', () => {
    const svc = read('apps/organizer-api/src/modules/auth/auth.service.ts');
    expect(svc).toContain('ADMIN registration requires an existing admin session');
    expect(svc).toContain('statusCode: 403');
  });

  it('organizer mentor ownership is enforced (no void no-op)', () => {
    const guard = read('apps/organizer-api/src/shared/guards/ownership.guard.ts');
    expect(guard).toContain('Mentor is not assigned to this hackathon');
    expect(guard).not.toContain('void Array.from');
  });

  it('AI gateway redacts secrets beyond sk- (defense in depth)', () => {
    const svc = read('packages/ai/src/ai.service.ts');
    for (const needle of ['REDACTED_GITHUB_TOKEN', 'REDACTED_AWS_KEY', 'REDACTED_PRIVATE_KEY', 'REDACTED_JWT', 'REDACTED_CONNECTION_STRING']) {
      expect(svc).toContain(needle);
    }
  });

  it('production never returns raw verification/reset tokens', () => {
    const svc = read('apps/participant-api/src/auth/auth.service.ts');
    expect(svc).toContain("NODE_ENV') === 'production'");
    expect(svc).toContain('emailed in production');
  });

  it('health readiness uses timeouts and reports down (not unknown) on prod misconfig', () => {
    const svc = read('apps/participant-api/src/health/health.service.ts');
    expect(svc).toContain('withTimeout');
    expect(svc).toContain("isProd ? 'down' : 'unknown'");
  });

  it('GitHub integration exposes no write methods', () => {
    const files = [
      'apps/participant-api/src/github/github-provider.interface.ts',
      'apps/participant-api/src/github/github-app.provider.ts',
      'apps/participant-api/src/github/github-api.provider.ts',
      'apps/participant-api/src/github/mock-github.provider.ts',
    ];
    const banned = ['createCommit', 'updateFile', '.push(', '.merge(', 'deleteBranch', 'createBranch'];
    for (const f of files) {
      if (!fs.existsSync(f)) continue;
      const c = read(f);
      for (const b of banned) expect(c).not.toContain(b);
    }
  });

  it('deployment supports Vercel SPA fallback + organizer image + healthchecks', () => {
    expect(fs.existsSync('vercel.json')).toBe(true);
    expect(read('vercel.json')).toContain('index.html');
    expect(fs.existsSync('apps/organizer-api/Dockerfile')).toBe(true);
    expect(read('apps/participant-api/Dockerfile')).toContain('HEALTHCHECK');
    expect(fs.existsSync('apps/participant-api/frontend/.env.example')).toBe(true);
  });
});
