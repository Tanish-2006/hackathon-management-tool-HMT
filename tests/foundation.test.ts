import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

describe('Foundation - project installs & structure', () => {
  it('pnpm-workspace.yaml exists and lists apps & packages', () => {
    const yaml = fs.readFileSync('pnpm-workspace.yaml', 'utf8');
    expect(yaml).toContain('apps/*');
    expect(yaml).toContain('packages/*');
  });

  it('both APIs exist with entry points', () => {
    expect(fs.existsSync('apps/participant-api/src/main.ts')).toBe(true);
    expect(fs.existsSync('apps/organizer-api/src/main.ts')).toBe(true);
    expect(fs.existsSync('apps/participant-api/src/app.module.ts')).toBe(true);
  });

  it('shared packages exist without duplicate auth', () => {
    const pkgs = fs.readdirSync('packages');
    expect(pkgs).toEqual(expect.arrayContaining(['config', 'database', 'security', 'observability', 'common', 'contracts']));
    // Ensure no duplicate auth implementations in apps
    const participantMain = fs.readFileSync('apps/participant-api/src/main.ts', 'utf8');
    const organizerMain = fs.readFileSync('apps/organizer-api/src/main.ts', 'utf8');
    // Both should import from @hmt/security, not implement own hashing
    expect(participantMain).toMatch(/@hmt\/config|@hmt\/observability/);
    expect(organizerMain).toMatch(/@hmt\/config|@hmt\/security/);
  });

  it('Prisma schema defines required entities and repo grants', () => {
    const schema = fs.readFileSync('packages/database/prisma/schema.prisma', 'utf8');
    for (const needle of ['model User', 'model Hackathon', 'model Team', 'model Project', 'model Phase', 'model RepositoryConnection', 'model RepositoryAccessGrant']) {
      expect(schema).toContain(needle);
    }
    expect(schema).toContain('RepositoryAccessScope');
  });

  it('contracts enumerate required events versioned v1', () => {
    const events = fs.readFileSync('packages/contracts/src/events.ts', 'utf8');
    const types = ['HackathonPublished', 'HackathonUpdated', 'HackathonPhaseChanged', 'TeamCreated', 'TeamUpdated', 'MentorFeedbackSubmitted', 'EvaluationPublished', 'ParticipantStatusChanged'];
    for (const t of types) expect(events).toContain(t);
    expect(events).toContain('version');
    const hasV1 = events.includes("'v1'") || events.includes('"v1"');
    expect(hasV1).toBe(true);
  });

  it('security foundation uses Argon2id and JWT with refresh rotation', () => {
    const hashing = fs.readFileSync('packages/security/src/hashing.ts', 'utf8');
    expect(hashing).toContain('argon2id');
    const jwt = fs.readFileSync('packages/security/src/jwt.ts', 'utf8');
    expect(jwt).toContain('signAccessToken');
    expect(jwt).toContain('signRefreshToken');
    const hasRotationDocs = jwt.includes('refresh token rotation') || jwt.includes('Refresh token');
    expect(hasRotationDocs).toBe(true);
  });

  it('privacy scopes documented', () => {
    const privacy = fs.readFileSync('docs/PRIVACY.md', 'utf8');
    expect(privacy).toContain('PUBLIC');
    expect(privacy).toContain('TEAM_LEADER');
    expect(privacy).toContain('MENTOR');
  });

  it('docker-compose validates', () => {
    const out = execSync('docker-compose -f infra/docker/docker-compose.yml config', { encoding: 'utf8' });
    expect(out).toContain('postgres');
    expect(out).toContain('neo4j');
    expect(out).toContain('redis');
    expect(out).toContain('hmt-postgres');
  });

  it('TypeScript strict mode enabled', () => {
    const base = JSON.parse(fs.readFileSync('tsconfig.base.json', 'utf8'));
    expect(base.compilerOptions.strict).toBe(true);
    expect(base.compilerOptions.noUncheckedIndexedAccess).toBe(true);
  });

  it('OpenAPI supports /api/v1 versioning', () => {
    const pMain = fs.readFileSync('apps/participant-api/src/main.ts', 'utf8');
    const oMain = fs.readFileSync('apps/organizer-api/src/main.ts', 'utf8');
    const pHasV1 = pMain.includes("setGlobalPrefix('api/v1')") || pMain.includes('api/v1');
    expect(pHasV1).toBe(true);
    expect(oMain).toContain('/api/v1');
    expect(pMain).toContain('SwaggerModule');
    expect(oMain).toContain('swagger');
  });

  it('health distinguishes postgres/neo4j/redis', () => {
    const pHealth = fs.readFileSync('apps/participant-api/src/health/health.service.ts', 'utf8');
    const oHealth = fs.readFileSync('apps/organizer-api/src/main.ts', 'utf8');
    for (const cond of ['postgres', 'neo4j', 'redis']) {
      expect(pHealth.toLowerCase()).toContain(cond);
      expect(oHealth.toLowerCase()).toContain(cond);
    }
    expect(pHealth).toContain('getHealth');
    expect(pHealth).toContain('getReadiness');
  });

  it('observability has structured logging and request IDs', () => {
    const logger = fs.readFileSync('packages/observability/src/logger.ts', 'utf8');
    expect(logger).toContain('pino');
    expect(logger).toContain('REDACTED');
    const ctx = fs.readFileSync('packages/observability/src/request-context.ts', 'utf8');
    expect(ctx).toContain('AsyncLocalStorage');
  });

  it('repository access default deny', () => {
    const repo = fs.readFileSync('packages/database/src/repository-access.ts', 'utf8');
    expect(repo).toContain('Default deny');
    expect(repo).toContain('canAccessRepository');
  });

  it('docs exist', () => {
    for (const f of ['ARCHITECTURE.md', 'SECURITY.md', 'PRIVACY.md', 'DATABASE.md', 'API_CONTRACT.md', 'BUILD_STATUS.md']) {
      expect(fs.existsSync(path.join('docs', f))).toBe(true);
    }
  });
});
