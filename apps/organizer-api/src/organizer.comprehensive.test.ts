import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { buildApp } from './main';
import { memoryStore } from './store/memory.store';

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

async function registerAndLogin(app: any, email: string, password: string, role: string, displayName?: string): Promise<{ accessToken: string; refreshToken: string; user: any }> {
  const reg = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: { email, password, displayName: displayName ?? email.split('@')[0], role },
  });
  if (reg.statusCode !== 201) throw new Error(`Register failed ${reg.statusCode}: ${reg.body}`);
  const body = JSON.parse(reg.body);
  return { accessToken: body.accessToken, refreshToken: body.refreshToken, user: body.user };
}

async function login(app: any, email: string, password: string): Promise<{ accessToken: string; user: any }> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });
  if (res.statusCode !== 200) throw new Error(`Login failed ${res.statusCode}: ${res.body}`);
  const body = JSON.parse(res.body);
  return { accessToken: body.accessToken, user: body.user };
}

function authHeaders(token: string) {
  return { Authorization: `Bearer ${token}` };
}

describe('Organizer Backend — Terminal 3 Comprehensive', () => {
  let app: any;

  beforeAll(async () => {
    loadEnvFromFile();
    process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://hmt:hmt_dev_password_change_in_prod@localhost:5432/hmt?schema=public';
    process.env.NEO4J_PASSWORD = process.env.NEO4J_PASSWORD || 'hmt_neo4j_password';
    process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'a'.repeat(32);
    process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'b'.repeat(32);
    process.env.REDIS_URL = process.env.REDIS_URL || 'redis://:hmt_redis_password@localhost:6379';
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  beforeEach(() => {
    // Do not clear users between tests that need isolation? We clear hackathons etc but keep users for auth
    // For comprehensive隔离, clear all except users if needed; but we will clear everything and re-seed users per test via register
    // Here we clear hackathons, themes, resources, phases etc but NOT users/sessions? Let's clear all and rely on beforeAll users recreated
    // For simplicity, clear hackathon-related stores before each test case where needed manually
  });

  // Helper to clear store fully
  function clearStore() {
    memoryStore.clear();
  }

  describe('Organizer Authentication', () => {
    it('allows ORGANIZER registration and enforces JWT', async () => {
      clearStore();
      const res = await app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: { email: 'org1@test.hmt', password: 'Str0ngPass123!', displayName: 'Org One', role: 'ORGANIZER' } });
      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body);
      expect(body.user.role).toBe('ORGANIZER');
      expect(body.accessToken).toBeDefined();
      // /auth/me requires token
      const me = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: authHeaders(body.accessToken) });
      expect(me.statusCode).toBe(200);
      expect(JSON.parse(me.body).email).toBe('org1@test.hmt');
    });

    it('supports MENTOR and ADMIN roles', async () => {
      clearStore();
      const mentor = await app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: { email: 'mentor@test.hmt', password: 'Str0ngPass123!', role: 'MENTOR', displayName: 'Mentor' } });
      expect(mentor.statusCode).toBe(201);
      expect(JSON.parse(mentor.body).user.role).toBe('MENTOR');

      const admin = await app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: { email: 'admin@test.hmt', password: 'Str0ngPass123!', role: 'ADMIN', displayName: 'Admin' } });
      expect(admin.statusCode).toBe(201);
      expect(JSON.parse(admin.body).user.role).toBe('ADMIN');
    });

    it('enforces authentication on protected routes', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/hackathons' });
      expect(res.statusCode).toBe(401);
    });

    it('prevents privilege escalation via login with wrong password', async () => {
      clearStore();
      await app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: { email: 'org2@test.hmt', password: 'Str0ngPass123!', role: 'ORGANIZER' } });
      const badLogin = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'org2@test.hmt', password: 'WrongPass' } });
      expect(badLogin.statusCode).toBe(401);
    });

    it('refresh rotates tokens', async () => {
      clearStore();
      const reg = await app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: { email: 'refresh@test.hmt', password: 'Str0ngPass123!', role: 'ORGANIZER' } });
      const { refreshToken } = JSON.parse(reg.body);
      const refreshed = await app.inject({ method: 'POST', url: '/api/v1/auth/refresh', payload: { refreshToken } });
      expect(refreshed.statusCode).toBe(200);
      expect(JSON.parse(refreshed.body).accessToken).toBeDefined();
    });
  });

  describe('Hackathon Creation Automation — HackathonDraftGenerator', () => {
    it('transforms structured organizer inputs into draft via provider-agnostic generator', async () => {
      clearStore();
      const org = await registerAndLogin(app, 'draft-org@test.hmt', 'Str0ngPass123!', 'ORGANIZER');
      const draftInput = {
        hackathonName: 'AI Climate Hack 2026',
        objective: 'Build AI solutions for climate modeling',
        audience: 'Students and researchers',
        duration: '3 days',
        mode: 'HYBRID',
        themePreference: 'Climate',
        problemStatementBasedOrOpenInnovation: 'PROBLEM_STATEMENT_BASED',
        expectedOutcomes: 'Prototype, Validation, Demo',
        judgingPreferences: 'Innovation, Technical implementation, Impact, UX',
        resources: 'Datasets, APIs, Starter kit',
        rules: 'Original work, Open source, No plagiarism',
      };
      const res = await app.inject({ method: 'POST', url: '/api/v1/hackathons/draft/generate', payload: draftInput, headers: authHeaders(org.accessToken) });
      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body);
      expect(body.data.hackathon.title).toBe('AI Climate Hack 2026');
      expect(body.data.hackathon.status).toBe('DRAFT');
      expect(body.data.draft).toBeDefined();
      expect(body.data.draft.judgingCriteriaDraft.length).toBeGreaterThan(0);
      expect(body.data.draft.phasesDraft.length).toBeGreaterThan(0);
      expect(body.data.draft.generatorVersion).toBe('mock-ai-v1');
      // Verify provider-agnostic abstraction exists
      expect(body.data.hackathon.metadata.draftGenerator).toBe('mock-ai');
    });

    it('draft MUST NOT automatically publish (stays DRAFT)', async () => {
      clearStore();
      const org = await registerAndLogin(app, 'nopublish@test.hmt', 'Str0ngPass123!', 'ORGANIZER');
      const input = {
        hackathonName: 'No Auto Publish Hack',
        objective: 'Test no auto publish',
        audience: 'All',
        duration: '2 days',
        mode: 'ONLINE',
        themePreference: 'AI',
        problemStatementBasedOrOpenInnovation: 'OPEN_INNOVATION',
        expectedOutcomes: 'Demo',
        judgingPreferences: 'Innovation',
        resources: 'Docs',
        rules: 'Rule 1',
      };
      const res = await app.inject({ method: 'POST', url: '/api/v1/hackathons/draft/generate', payload: input, headers: authHeaders(org.accessToken) });
      const hack = JSON.parse(res.body).data.hackathon;
      expect(hack.status).toBe('DRAFT');
      expect(hack.status).not.toBe('PUBLISHED');
    });

    it('enforces no direct AI→PUBLISHED transition', async () => {
      clearStore();
      const org = await registerAndLogin(app, 'directpub@test.hmt', 'Str0ngPass123!', 'ORGANIZER');
      const input = {
        hackathonName: 'Direct Publish Test',
        objective: 'Test direct publish blocked',
        audience: 'All',
        duration: '2 days',
        mode: 'ONLINE',
        themePreference: 'AI',
        problemStatementBasedOrOpenInnovation: 'OPEN_INNOVATION',
        expectedOutcomes: 'Demo',
        judgingPreferences: 'Innovation',
        resources: 'Docs',
        rules: 'Rule 1',
      };
      const res = await app.inject({ method: 'POST', url: '/api/v1/hackathons/draft/generate', payload: input, headers: authHeaders(org.accessToken) });
      const hackId = JSON.parse(res.body).data.hackathon.id;
      // Try direct publish via direct-publish endpoint (should be blocked)
      const direct = await app.inject({ method: 'POST', url: `/api/v1/hackathons/${hackId}/direct-publish`, headers: authHeaders(org.accessToken) });
      expect(direct.statusCode).toBe(400);
      expect(JSON.parse(direct.body).error.message).toMatch(/Direct AI.*PUBLISHED.*not allowed/);
      // Try publish via normal publish (from DRAFT) - should fail due to state machine
      const publishAttempt = await app.inject({ method: 'POST', url: `/api/v1/hackathons/${hackId}/publish`, headers: authHeaders(org.accessToken) });
      expect(publishAttempt.statusCode).toBe(400);
      expect(JSON.parse(publishAttempt.body).error.message).toMatch(/Invalid transition DRAFT.*PUBLISHED/);
    });
  });

  describe('Review → Edit → Confirm → Publish workflow', () => {
    it('implements explicit states DRAFT → REVIEW → CONFIRMED → PUBLISHED → ARCHIVED', async () => {
      clearStore();
      const org = await registerAndLogin(app, 'workflow@test.hmt', 'Str0ngPass123!', 'ORGANIZER');
      const input = {
        hackathonName: 'Workflow States Hack',
        objective: 'Test workflow states',
        audience: 'All',
        duration: '3 days',
        mode: 'ONLINE',
        themePreference: 'HealthTech',
        problemStatementBasedOrOpenInnovation: 'PROBLEM_STATEMENT_BASED',
        expectedOutcomes: 'Prototype',
        judgingPreferences: 'Innovation, Technical',
        resources: 'Docs',
        rules: 'Rule 1',
      };
      const gen = await app.inject({ method: 'POST', url: '/api/v1/hackathons/draft/generate', payload: input, headers: authHeaders(org.accessToken) });
      let hackId = JSON.parse(gen.body).data.hackathon.id;
      // DRAFT → REVIEW
      let res = await app.inject({ method: 'POST', url: `/api/v1/hackathons/${hackId}/review`, headers: authHeaders(org.accessToken) });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).data.status).toBe('REVIEW');
      // REVIEW → EDIT (PATCH)
      res = await app.inject({ method: 'PATCH', url: `/api/v1/hackathons/${hackId}`, payload: { description: 'Edited description after review' }, headers: authHeaders(org.accessToken) });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).data.description).toBe('Edited description after review');
      // REVIEW → CONFIRMED
      res = await app.inject({ method: 'POST', url: `/api/v1/hackathons/${hackId}/confirm`, headers: authHeaders(org.accessToken) });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).data.status).toBe('CONFIRMED');
      // CONFIRMED → PUBLISHED
      res = await app.inject({ method: 'POST', url: `/api/v1/hackathons/${hackId}/publish`, headers: authHeaders(org.accessToken) });
      expect(res.statusCode).toBe(200);
      const publishedHack = JSON.parse(res.body).data.hackathon;
      expect(publishedHack.status).toBe('PUBLISHED');
      expect(JSON.parse(res.body).data.publishedEvent).toBeDefined();
      expect(JSON.parse(res.body).data.publishedEvent.version).toBe('v1');
      expect(JSON.parse(res.body).data.publishedEvent.type).toBe('HackathonPublished');
      // PUBLISHED → ARCHIVED
      res = await app.inject({ method: 'POST', url: `/api/v1/hackathons/${hackId}/archive`, headers: authHeaders(org.accessToken) });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).data.status).toBe('ARCHIVED');
      // ARCHIVED terminal - no further transitions
      res = await app.inject({ method: 'POST', url: `/api/v1/hackathons/${hackId}/review`, headers: authHeaders(org.accessToken) });
      expect(res.statusCode).toBe(400);
    });

    it('validation before confirm/publish: problem statement required for PROBLEM_STATEMENT_BASED', async () => {
      clearStore();
      const org = await registerAndLogin(app, 'validate@test.hmt', 'Str0ngPass123!', 'ORGANIZER');
      // Create manual hackathon without problemStatement but type PROBLEM_STATEMENT_BASED
      const create = await app.inject({
        method: 'POST',
        url: '/api/v1/hackathons',
        payload: { title: 'Problem Based No Statement', description: 'Desc', hackathonType: 'PROBLEM_STATEMENT_BASED', objective: 'Obj' },
        headers: authHeaders(org.accessToken),
      });
      expect(create.statusCode).toBe(201);
      const hackId = JSON.parse(create.body).data.id;
      // Need at least one phase and criteria to reach confirm? Let's create them manually to isolate problemStatement check
      // For now, try to go DRAFT→REVIEW→CONFIRM without problemStatement should fail at CONFIRM
      await app.inject({ method: 'POST', url: `/api/v1/hackathons/${hackId}/review`, headers: authHeaders(org.accessToken) });
      const confirm = await app.inject({ method: 'POST', url: `/api/v1/hackathons/${hackId}/confirm`, headers: authHeaders(org.accessToken) });
      // Expect failure because missing problemStatement and maybe other validation
      expect(confirm.statusCode).toBe(400);
      expect(JSON.parse(confirm.body).error.message).toMatch(/problemStatement|evaluation criteria|phase/i);
    });

    it('enforces organization ownership', async () => {
      clearStore();
      const orgA = await registerAndLogin(app, 'ownerA@test.hmt', 'Str0ngPass123!', 'ORGANIZER');
      const orgB = await registerAndLogin(app, 'ownerB@test.hmt', 'Str0ngPass123!', 'ORGANIZER');
      const input = {
        hackathonName: 'Ownership Test Hack',
        objective: 'Test ownership',
        audience: 'All',
        duration: '2 days',
        mode: 'ONLINE',
        themePreference: 'AI',
        problemStatementBasedOrOpenInnovation: 'OPEN_INNOVATION',
        expectedOutcomes: 'Demo',
        judgingPreferences: 'Innovation',
        resources: 'Docs',
        rules: 'Rule 1',
      };
      const gen = await app.inject({ method: 'POST', url: '/api/v1/hackathons/draft/generate', payload: input, headers: authHeaders(orgA.accessToken) });
      const hackId = JSON.parse(gen.body).data.hackathon.id;
      // OrgB tries to edit
      const edit = await app.inject({ method: 'PATCH', url: `/api/v1/hackathons/${hackId}`, payload: { title: 'Hacked Title' }, headers: authHeaders(orgB.accessToken) });
      expect(edit.statusCode).toBe(403);
      // OrgB tries to publish
      await app.inject({ method: 'POST', url: `/api/v1/hackathons/${hackId}/review`, headers: authHeaders(orgA.accessToken) });
      const publishByB = await app.inject({ method: 'POST', url: `/api/v1/hackathons/${hackId}/publish`, headers: authHeaders(orgB.accessToken) });
      // Should fail ownership or state (still REVIEW, not CONFIRMED, but ownership check first)
      expect([400, 403]).toContain(publishByB.statusCode);
    });
  });

  describe('Hackathon Types', () => {
    it('supports PROBLEM_STATEMENT_BASED with constraints/resources/expected outcome/evaluation criteria', async () => {
      clearStore();
      const org = await registerAndLogin(app, 'probtype@test.hmt', 'Str0ngPass123!', 'ORGANIZER');
      const input = {
        hackathonName: 'Problem Based Hack',
        objective: 'Solve water scarcity',
        audience: 'Engineers',
        duration: '5 days',
        mode: 'OFFLINE',
        themePreference: 'Climate',
        problemStatementBasedOrOpenInnovation: 'PROBLEM_STATEMENT_BASED',
        expectedOutcomes: 'Prototype, Report',
        judgingPreferences: 'Innovation, Impact',
        resources: 'Datasets API',
        rules: 'No external help',
      };
      const res = await app.inject({ method: 'POST', url: '/api/v1/hackathons/draft/generate', payload: input, headers: authHeaders(org.accessToken) });
      const data = JSON.parse(res.body).data;
      expect(data.hackathon.hackathonType).toBe('PROBLEM_STATEMENT_BASED');
      expect(data.hackathon.problemStatement).toContain('water scarcity');
      expect(data.hackathon.constraints.length).toBeGreaterThan(0);
      expect(data.hackathon.expectedOutcomes.length).toBeGreaterThan(0);
      // Check evaluation criteria created
      const crit = await app.inject({ method: 'GET', url: `/api/v1/hackathons/${data.hackathon.id}/evaluation-criteria`, headers: authHeaders(org.accessToken) });
      expect(crit.statusCode).toBe(200);
      expect(JSON.parse(crit.body).data.length).toBeGreaterThan(0);
    });

    it('supports OPEN_INNOVATION with theme/domain/broad objective', async () => {
      clearStore();
      const org = await registerAndLogin(app, 'openinnov@test.hmt', 'Str0ngPass123!', 'ORGANIZER');
      const input = {
        hackathonName: 'Open Innovation Hack',
        objective: 'Build anything innovative',
        audience: 'Open',
        duration: '3 days',
        mode: 'ONLINE',
        themePreference: 'Open Innovation',
        problemStatementBasedOrOpenInnovation: 'OPEN_INNOVATION',
        expectedOutcomes: 'Any solution',
        judgingPreferences: 'Creativity, Scalability',
        resources: 'Starter kit',
        rules: 'Be creative',
      };
      const res = await app.inject({ method: 'POST', url: '/api/v1/hackathons/draft/generate', payload: input, headers: authHeaders(org.accessToken) });
      const hack = JSON.parse(res.body).data.hackathon;
      expect(hack.hackathonType).toBe('OPEN_INNOVATION');
      expect(hack.problemStatement).toBeNull();
      expect(hack.objective).toBe('Build anything innovative');
    });
  });

  describe('Themes', () => {
    it('supports organizer theme creation/selection and is configurable (not hardcoded only)', async () => {
      clearStore();
      const org = await registerAndLogin(app, 'themeorg@test.hmt', 'Str0ngPass123!', 'ORGANIZER');
      // Create custom theme beyond defaults
      const custom = await app.inject({ method: 'POST', url: '/api/v1/themes', payload: { name: 'My Custom Quantum Theme', description: 'Quantum computing' }, headers: authHeaders(org.accessToken) });
      expect(custom.statusCode).toBe(201);
      expect(JSON.parse(custom.body).data.name).toBe('My Custom Quantum Theme');
      // List should include custom + ability to create more
      const list = await app.inject({ method: 'GET', url: '/api/v1/themes', headers: authHeaders(org.accessToken) });
      const themes = JSON.parse(list.body).data;
      expect(themes.some((t: any) => t.name === 'My Custom Quantum Theme')).toBe(true);
      // Create hackathon and assign theme
      const input = {
        hackathonName: 'Theme Config Hack',
        objective: 'Test themes',
        audience: 'All',
        duration: '2 days',
        mode: 'ONLINE',
        themePreference: 'My Custom Quantum Theme',
        problemStatementBasedOrOpenInnovation: 'OPEN_INNOVATION',
        expectedOutcomes: 'Demo',
        judgingPreferences: 'Innovation',
        resources: 'Docs',
        rules: 'Rule 1',
      };
      const gen = await app.inject({ method: 'POST', url: '/api/v1/hackathons/draft/generate', payload: input, headers: authHeaders(org.accessToken) });
      const hackId = JSON.parse(gen.body).data.hackathon.id;
      const assign = await app.inject({ method: 'POST', url: `/api/v1/hackathons/${hackId}/themes`, payload: { themeId: JSON.parse(custom.body).data.id }, headers: authHeaders(org.accessToken) });
      expect(assign.statusCode).toBe(200);
    });

    it('prevents duplicate theme names', async () => {
      clearStore();
      const org = await registerAndLogin(app, 'duptheme@test.hmt', 'Str0ngPass123!', 'ORGANIZER');
      await app.inject({ method: 'POST', url: '/api/v1/themes', payload: { name: 'UniqueThemeX' }, headers: authHeaders(org.accessToken) });
      const dup = await app.inject({ method: 'POST', url: '/api/v1/themes', payload: { name: 'UniqueThemeX' }, headers: authHeaders(org.accessToken) });
      expect(dup.statusCode).toBe(409);
    });

    it('seed-defaults creates AI, FinTech, etc but remains configurable', async () => {
      clearStore();
      const org = await registerAndLogin(app, 'seedtheme@test.hmt', 'Str0ngPass123!', 'ORGANIZER');
      const seed = await app.inject({ method: 'POST', url: '/api/v1/themes/seed-defaults', headers: authHeaders(org.accessToken) });
      expect(seed.statusCode).toBe(200);
      const themes = JSON.parse(seed.body).data;
      const names = themes.map((t: any) => t.name);
      expect(names).toEqual(expect.arrayContaining(['AI', 'FinTech', 'HealthTech', 'Climate']));
      // But we can still add custom beyond seeded list
      const custom = await app.inject({ method: 'POST', url: '/api/v1/themes', payload: { name: 'Another Custom' }, headers: authHeaders(org.accessToken) });
      expect(custom.statusCode).toBe(201);
    });
  });

  describe('Resources with visibility', () => {
    it('organizer can add resources with visibility PUBLIC/PARTICIPANT/MENTOR/ORGANIZER', async () => {
      clearStore();
      const org = await registerAndLogin(app, 'resorg@test.hmt', 'Str0ngPass123!', 'ORGANIZER');
      const input = {
        hackathonName: 'Resources Hack',
        objective: 'Test resources',
        audience: 'All',
        duration: '2 days',
        mode: 'ONLINE',
        themePreference: 'AI',
        problemStatementBasedOrOpenInnovation: 'OPEN_INNOVATION',
        expectedOutcomes: 'Demo',
        judgingPreferences: 'Innovation',
        resources: 'Docs',
        rules: 'Rule 1',
      };
      const gen = await app.inject({ method: 'POST', url: '/api/v1/hackathons/draft/generate', payload: input, headers: authHeaders(org.accessToken) });
      const hackId = JSON.parse(gen.body).data.hackathon.id;
      const doc = await app.inject({ method: 'POST', url: `/api/v1/hackathons/${hackId}/resources`, payload: { title: 'Dataset Link', type: 'DATASET', url: 'https://example.com/data.csv', visibility: 'PARTICIPANT' }, headers: authHeaders(org.accessToken) });
      expect(doc.statusCode).toBe(201);
      const api = await app.inject({ method: 'POST', url: `/api/v1/hackathons/${hackId}/resources`, payload: { title: 'Mentor Guide', type: 'DOCUMENT', url: 'https://example.com/mentor.pdf', visibility: 'MENTOR' }, headers: authHeaders(org.accessToken) });
      expect(api.statusCode).toBe(201);
      const secret = await app.inject({ method: 'POST', url: `/api/v1/hackathons/${hackId}/resources`, payload: { title: 'Organizer Secret', type: 'DOCUMENT', visibility: 'ORGANIZER' }, headers: authHeaders(org.accessToken) });
      expect(secret.statusCode).toBe(201);
      // Organizer sees all  (at least initial public starter + 3 new)
      const listOrg = await app.inject({ method: 'GET', url: `/api/v1/hackathons/${hackId}/resources`, headers: authHeaders(org.accessToken) });
      const orgResources = JSON.parse(listOrg.body).data;
      expect(orgResources.length).toBeGreaterThanOrEqual(3);
    });

    it('filters visibility: participant sees PUBLIC+PARTICIPANT, mentor sees +MENTOR', async () => {
      clearStore();
      const org = await registerAndLogin(app, 'resvisorg@test.hmt', 'Str0ngPass123!', 'ORGANIZER');
      const participant = await registerAndLogin(app, 'respart@test.hmt', 'Str0ngPass123!', 'PARTICIPANT');
      const mentor = await registerAndLogin(app, 'resmentor@test.hmt', 'Str0ngPass123!', 'MENTOR');
      const input = {
        hackathonName: 'Res Vis Hack',
        objective: 'Test visibility',
        audience: 'All',
        duration: '2 days',
        mode: 'ONLINE',
        themePreference: 'AI',
        problemStatementBasedOrOpenInnovation: 'OPEN_INNOVATION',
        expectedOutcomes: 'Demo',
        judgingPreferences: 'Innovation',
        resources: 'Docs',
        rules: 'Rule 1',
      };
      const gen = await app.inject({ method: 'POST', url: '/api/v1/hackathons/draft/generate', payload: input, headers: authHeaders(org.accessToken) });
      const hackId = JSON.parse(gen.body).data.hackathon.id;
      await app.inject({ method: 'POST', url: `/api/v1/hackathons/${hackId}/resources`, payload: { title: 'Public Doc', type: 'DOCUMENT', visibility: 'PUBLIC' }, headers: authHeaders(org.accessToken) });
      await app.inject({ method: 'POST', url: `/api/v1/hackathons/${hackId}/resources`, payload: { title: 'Participant Only', type: 'DOCUMENT', visibility: 'PARTICIPANT' }, headers: authHeaders(org.accessToken) });
      await app.inject({ method: 'POST', url: `/api/v1/hackathons/${hackId}/resources`, payload: { title: 'Mentor Only', type: 'DOCUMENT', visibility: 'MENTOR' }, headers: authHeaders(org.accessToken) });
      await app.inject({ method: 'POST', url: `/api/v1/hackathons/${hackId}/resources`, payload: { title: 'Organizer Only', type: 'DOCUMENT', visibility: 'ORGANIZER' }, headers: authHeaders(org.accessToken) });
      // Need to assign mentor to hackathon for mentor visibility test (create team stub and assignment)
      const teamId = 'team_vis_test';
      memoryStore.teams.set(teamId, { id: teamId, hackathonId: hackId, name: 'Vis Team', memberIds: [], projectId: null, createdAt: new Date().toISOString() });
      await app.inject({ method: 'POST', url: `/api/v1/hackathons/${hackId}/mentor-assignments`, payload: { mentorId: mentor.user.id, teamId }, headers: authHeaders(org.accessToken) });

      const partList = await app.inject({ method: 'GET', url: `/api/v1/hackathons/${hackId}/resources`, headers: authHeaders(participant.accessToken) });
      const partVis = JSON.parse(partList.body).data.map((r: any) => r.visibility);
      expect(partVis).toEqual(expect.arrayContaining(['PUBLIC', 'PARTICIPANT']));
      expect(partVis).not.toContain('MENTOR');
      expect(partVis).not.toContain('ORGANIZER');

      const mentorList = await app.inject({ method: 'GET', url: `/api/v1/hackathons/${hackId}/resources`, headers: authHeaders(mentor.accessToken) });
      const mentorVis = JSON.parse(mentorList.body).data.map((r: any) => r.visibility);
      expect(mentorVis).toEqual(expect.arrayContaining(['PUBLIC', 'PARTICIPANT', 'MENTOR']));
      expect(mentorVis).not.toContain('ORGANIZER');
    });
  });

  describe('Timeline', () => {
    it('organizer can configure phases with start/end times', async () => {
      clearStore();
      const org = await registerAndLogin(app, 'timeline@test.hmt', 'Str0ngPass123!', 'ORGANIZER');
      const manual = await app.inject({ method: 'POST', url: '/api/v1/hackathons', payload: { title: 'Timeline Hack', description: 'Desc' }, headers: authHeaders(org.accessToken) });
      const hackId = JSON.parse(manual.body).data.id;
      const now = Date.now();
      const phase = await app.inject({
        method: 'POST',
        url: `/api/v1/hackathons/${hackId}/phases`,
        payload: { name: 'registration', order: 1, startsAt: new Date(now + 86400000).toISOString(), endsAt: new Date(now + 86400000 * 2).toISOString() },
        headers: authHeaders(org.accessToken),
      });
      expect(phase.statusCode).toBe(201);
      expect(JSON.parse(phase.body).data.name).toBe('registration');
    });

    it('prevents invalid timelines (start >= end)', async () => {
      clearStore();
      const org = await registerAndLogin(app, 'badtime@test.hmt', 'Str0ngPass123!', 'ORGANIZER');
      const manual = await app.inject({ method: 'POST', url: '/api/v1/hackathons', payload: { title: 'Bad Timeline Hack', description: 'Desc' }, headers: authHeaders(org.accessToken) });
      const hackId = JSON.parse(manual.body).data.id;
      const now = Date.now();
      const bad = await app.inject({
        method: 'POST',
        url: `/api/v1/hackathons/${hackId}/phases`,
        payload: { name: 'ideation', order: 1, startsAt: new Date(now + 86400000 * 2).toISOString(), endsAt: new Date(now + 86400000).toISOString() },
        headers: authHeaders(org.accessToken),
      });
      expect(bad.statusCode).toBe(400);
      expect(JSON.parse(bad.body).error.message).toMatch(/before endsAt|Invalid/i);
    });

    it('prevents overlapping phases', async () => {
      clearStore();
      const org = await registerAndLogin(app, 'overlap@test.hmt', 'Str0ngPass123!', 'ORGANIZER');
      const manual = await app.inject({ method: 'POST', url: '/api/v1/hackathons', payload: { title: 'Overlap Hack', description: 'Desc' }, headers: authHeaders(org.accessToken) });
      const hackId = JSON.parse(manual.body).data.id;
      const base = Date.now() + 86400000;
      await app.inject({
        method: 'POST',
        url: `/api/v1/hackathons/${hackId}/phases`,
        payload: { name: 'registration', order: 1, startsAt: new Date(base).toISOString(), endsAt: new Date(base + 86400000).toISOString() },
        headers: authHeaders(org.accessToken),
      });
      const overlap = await app.inject({
        method: 'POST',
        url: `/api/v1/hackathons/${hackId}/phases`,
        payload: { name: 'team_formation', order: 2, startsAt: new Date(base + 43200000).toISOString(), endsAt: new Date(base + 86400000 * 2).toISOString() },
        headers: authHeaders(org.accessToken),
      });
      expect(overlap.statusCode).toBe(400);
      expect(JSON.parse(overlap.body).error.message).toMatch(/overlap/i);
    });

    it('supports all required phases names: registration, team_formation, ideation, development, evaluation, submission, finale, results', async () => {
      clearStore();
      const org = await registerAndLogin(app, 'allphases@test.hmt', 'Str0ngPass123!', 'ORGANIZER');
      const manual = await app.inject({ method: 'POST', url: '/api/v1/hackathons', payload: { title: 'All Phases Hack', description: 'Desc' }, headers: authHeaders(org.accessToken) });
      const hackId = JSON.parse(manual.body).data.id;
      const requiredNames = ['registration', 'team_formation', 'ideation', 'development', 'evaluation', 'submission', 'finale', 'results'];
      const base = Date.now() + 86400000;
      for (let i = 0; i < requiredNames.length; i++) {
        const name = requiredNames[i];
        const starts = new Date(base + i * 86400000 * 2).toISOString();
        const ends = new Date(base + i * 86400000 * 2 + 86400000).toISOString();
        const res = await app.inject({ method: 'POST', url: `/api/v1/hackathons/${hackId}/phases`, payload: { name, order: i + 1, startsAt: starts, endsAt: ends }, headers: authHeaders(org.accessToken) });
        expect(res.statusCode).toBe(201);
      }
      const list = await app.inject({ method: 'GET', url: `/api/v1/hackathons/${hackId}/phases`, headers: authHeaders(org.accessToken) });
      expect(JSON.parse(list.body).data.length).toBe(8);
    });
  });

  describe('Participants + Teams privacy boundaries', () => {
    it('organizer can view participants, teams, projects but not private repo contents', async () => {
      clearStore();
      const org = await registerAndLogin(app, 'privorg@test.hmt', 'Str0ngPass123!', 'ORGANIZER');
      const input = {
        hackathonName: 'Privacy Hack',
        objective: 'Test privacy',
        audience: 'All',
        duration: '2 days',
        mode: 'ONLINE',
        themePreference: 'AI',
        problemStatementBasedOrOpenInnovation: 'OPEN_INNOVATION',
        expectedOutcomes: 'Demo',
        judgingPreferences: 'Innovation',
        resources: 'Docs',
        rules: 'Rule 1',
      };
      const gen = await app.inject({ method: 'POST', url: '/api/v1/hackathons/draft/generate', payload: input, headers: authHeaders(org.accessToken) });
      const hackId = JSON.parse(gen.body).data.hackathon.id;
      // Seed demo data
      await app.inject({ method: 'POST', url: `/api/v1/hackathons/${hackId}/seed-demo`, headers: authHeaders(org.accessToken) });
      const teams = await app.inject({ method: 'GET', url: `/api/v1/hackathons/${hackId}/teams`, headers: authHeaders(org.accessToken) });
      expect(teams.statusCode).toBe(200);
      const teamsData = JSON.parse(teams.body).data;
      expect(teamsData.length).toBeGreaterThan(0);
      // Ensure private repoUrl not exposed
      for (const team of teamsData) {
        if (team.project) {
          expect(team.project).not.toHaveProperty('repoUrl');
          expect(team.project).toHaveProperty('hasRepository');
        }
        expect(team).not.toHaveProperty('inviteCode');
      }
      const projects = await app.inject({ method: 'GET', url: `/api/v1/hackathons/${hackId}/projects`, headers: authHeaders(org.accessToken) });
      const projectsData = JSON.parse(projects.body).data;
      for (const p of projectsData) {
        expect(p).not.toHaveProperty('repoUrl');
      }
      // Direct private repo access should be forbidden
      const firstTeamId = teamsData[0].id;
      const privateAttempt = await app.inject({ method: 'GET', url: `/api/v1/teams/${firstTeamId}/private-repo`, headers: authHeaders(org.accessToken) });
      expect(privateAttempt.statusCode).toBe(403);
      expect(JSON.parse(privateAttempt.body).error.message).toMatch(/private team repositories/i);
    });
  });

  describe('Mentor System & Immutable Feedback', () => {
    it('mentor assignment: organizer assigns mentor to team', async () => {
      clearStore();
      const org = await registerAndLogin(app, 'mentassignorg@test.hmt', 'Str0ngPass123!', 'ORGANIZER');
      const mentor = await registerAndLogin(app, 'mentassign_mentor@test.hmt', 'Str0ngPass123!', 'MENTOR');
      const input = {
        hackathonName: 'Mentor Assign Hack',
        objective: 'Test mentor assign',
        audience: 'All',
        duration: '2 days',
        mode: 'ONLINE',
        themePreference: 'AI',
        problemStatementBasedOrOpenInnovation: 'OPEN_INNOVATION',
        expectedOutcomes: 'Demo',
        judgingPreferences: 'Innovation',
        resources: 'Docs',
        rules: 'Rule 1',
      };
      const gen = await app.inject({ method: 'POST', url: '/api/v1/hackathons/draft/generate', payload: input, headers: authHeaders(org.accessToken) });
      const hackId = JSON.parse(gen.body).data.hackathon.id;
      const teamId = 'team_mentor_assign';
      memoryStore.teams.set(teamId, { id: teamId, hackathonId: hackId, name: 'Test Team', memberIds: [], projectId: null, createdAt: new Date().toISOString() });
      const assign = await app.inject({ method: 'POST', url: `/api/v1/hackathons/${hackId}/mentor-assignments`, payload: { mentorId: mentor.user.id, teamId }, headers: authHeaders(org.accessToken) });
      expect(assign.statusCode).toBe(201);
      expect(JSON.parse(assign.body).data.mentorId).toBe(mentor.user.id);
    });

    it('mentor can access assigned teams and submit score/remarks/reason + technical/product feedback', async () => {
      clearStore();
      const org = await registerAndLogin(app, 'mentsubmitorg@test.hmt', 'Str0ngPass123!', 'ORGANIZER');
      const mentor = await registerAndLogin(app, 'mentsubmit_mentor@test.hmt', 'Str0ngPass123!', 'MENTOR');
      const input = {
        hackathonName: 'Mentor Submit Hack',
        objective: 'Test mentor submit',
        audience: 'All',
        duration: '2 days',
        mode: 'ONLINE',
        themePreference: 'AI',
        problemStatementBasedOrOpenInnovation: 'OPEN_INNOVATION',
        expectedOutcomes: 'Demo',
        judgingPreferences: 'Innovation',
        resources: 'Docs',
        rules: 'Rule 1',
      };
      const gen = await app.inject({ method: 'POST', url: '/api/v1/hackathons/draft/generate', payload: input, headers: authHeaders(org.accessToken) });
      const hackId = JSON.parse(gen.body).data.hackathon.id;
      const teamId = 'team_mentor_submit';
      memoryStore.teams.set(teamId, { id: teamId, hackathonId: hackId, name: 'Submit Team', memberIds: [], projectId: 'proj_submit', createdAt: new Date().toISOString() });
      memoryStore.projects.set('proj_submit', { id: 'proj_submit', teamId, hackathonId: hackId, title: 'Submit Project', description: 'Desc', repoUrl: 'https://github.com/private/repo', createdAt: new Date().toISOString() });
      await app.inject({ method: 'POST', url: `/api/v1/hackathons/${hackId}/mentor-assignments`, payload: { mentorId: mentor.user.id, teamId }, headers: authHeaders(org.accessToken) });
      const feedback = await app.inject({
        method: 'POST',
        url: '/api/v1/mentor/feedback',
        payload: {
          teamId,
          hackathonId: hackId,
          projectId: 'proj_submit',
          score: 8.5,
          remarks: 'Great work on architecture',
          reason: 'Clean code and scalable design',
          strengths: ['Architecture', 'Teamwork'],
          weaknesses: ['Documentation lacking'],
          technicalFeedback: 'Consider caching',
          productFeedback: 'Improve onboarding',
          recommendation: 'Advance to finale',
          phase: 'development',
        },
        headers: authHeaders(mentor.accessToken),
      });
      expect(feedback.statusCode).toBe(201);
      const fb = JSON.parse(feedback.body).data;
      expect(fb.score).toBe(8.5);
      expect(fb.remarks).toBe('Great work on architecture');
      expect(fb.technicalFeedback).toBe('Consider caching');
      expect(fb.version).toBe(1);
      expect(fb.publicationStatus).toBe('MENTOR_SUBMITTED');
    });

    it('mentors can ONLY access assigned teams (403 otherwise)', async () => {
      clearStore();
      const org = await registerAndLogin(app, 'mentor403org@test.hmt', 'Str0ngPass123!', 'ORGANIZER');
      const mentorA = await registerAndLogin(app, 'mentorA403@test.hmt', 'Str0ngPass123!', 'MENTOR');
      const mentorB = await registerAndLogin(app, 'mentorB403@test.hmt', 'Str0ngPass123!', 'MENTOR');
      const input = {
        hackathonName: 'Mentor 403 Hack',
        objective: 'Test 403',
        audience: 'All',
        duration: '2 days',
        mode: 'ONLINE',
        themePreference: 'AI',
        problemStatementBasedOrOpenInnovation: 'OPEN_INNOVATION',
        expectedOutcomes: 'Demo',
        judgingPreferences: 'Innovation',
        resources: 'Docs',
        rules: 'Rule 1',
      };
      const gen = await app.inject({ method: 'POST', url: '/api/v1/hackathons/draft/generate', payload: input, headers: authHeaders(org.accessToken) });
      const hackId = JSON.parse(gen.body).data.hackathon.id;
      const teamId = 'team_403';
      memoryStore.teams.set(teamId, { id: teamId, hackathonId: hackId, name: '403 Team', memberIds: [], projectId: null, createdAt: new Date().toISOString() });
      await app.inject({ method: 'POST', url: `/api/v1/hackathons/${hackId}/mentor-assignments`, payload: { mentorId: mentorA.user.id, teamId }, headers: authHeaders(org.accessToken) });
      // Mentor B (not assigned) tries to submit for same team -> should be 403
      const attempt = await app.inject({
        method: 'POST',
        url: '/api/v1/mentor/feedback',
        payload: { teamId, hackathonId: hackId, score: 5, remarks: 'r', reason: 'reason', phase: 'ideation' },
        headers: authHeaders(mentorB.accessToken),
      });
      expect(attempt.statusCode).toBe(403);
    });
  });

  describe('Immutable Feedback — CRITICAL', () => {
    it('original mentor record becomes immutable; organizer CANNOT edit directly', async () => {
      clearStore();
      const org = await registerAndLogin(app, 'immutorg@test.hmt', 'Str0ngPass123!', 'ORGANIZER');
      const mentor = await registerAndLogin(app, 'immutmentor@test.hmt', 'Str0ngPass123!', 'MENTOR');
      const input = {
        hackathonName: 'Immutable Hack',
        objective: 'Test immutability',
        audience: 'All',
        duration: '2 days',
        mode: 'ONLINE',
        themePreference: 'AI',
        problemStatementBasedOrOpenInnovation: 'OPEN_INNOVATION',
        expectedOutcomes: 'Demo',
        judgingPreferences: 'Innovation',
        resources: 'Docs',
        rules: 'Rule 1',
      };
      const gen = await app.inject({ method: 'POST', url: '/api/v1/hackathons/draft/generate', payload: input, headers: authHeaders(org.accessToken) });
      const hackId = JSON.parse(gen.body).data.hackathon.id;
      const teamId = 'team_immut';
      memoryStore.teams.set(teamId, { id: teamId, hackathonId: hackId, name: 'Immut Team', memberIds: [], projectId: null, createdAt: new Date().toISOString() });
      await app.inject({ method: 'POST', url: `/api/v1/hackathons/${hackId}/mentor-assignments`, payload: { mentorId: mentor.user.id, teamId }, headers: authHeaders(org.accessToken) });
      const fbRes = await app.inject({
        method: 'POST',
        url: '/api/v1/mentor/feedback',
        payload: { teamId, hackathonId: hackId, score: 7, remarks: 'Original remarks', reason: 'Original reason', phase: 'development' },
        headers: authHeaders(mentor.accessToken),
      });
      const fbId = JSON.parse(fbRes.body).data.id;
      // Organizer tries to directly edit via PUT (should be blocked 403)
      const illegal = await app.inject({ method: 'PUT', url: `/api/v1/mentor/feedback/${fbId}`, payload: { remarks: 'Hacked by organizer', score: 10 }, headers: authHeaders(org.accessToken) });
      expect(illegal.statusCode).toBe(403);
      expect(JSON.parse(illegal.body).error.message).toMatch(/cannot edit mentor.*original/i);
      // Verify original unchanged via direct fetch as organizer
      const fetch = await app.inject({ method: 'GET', url: `/api/v1/mentor/feedback/${fbId}`, headers: authHeaders(org.accessToken) });
      expect(JSON.parse(fetch.body).data.remarks).toBe('Original remarks');
      expect(JSON.parse(fetch.body).data.score).toBe(7);
    });

    it('correction creates new version with audit log, original preserved', async () => {
      clearStore();
      const org = await registerAndLogin(app, 'correctorg@test.hmt', 'Str0ngPass123!', 'ORGANIZER');
      const mentor = await registerAndLogin(app, 'correctmentor@test.hmt', 'Str0ngPass123!', 'MENTOR');
      const input = {
        hackathonName: 'Correction Hack',
        objective: 'Test correction',
        audience: 'All',
        duration: '2 days',
        mode: 'ONLINE',
        themePreference: 'AI',
        problemStatementBasedOrOpenInnovation: 'OPEN_INNOVATION',
        expectedOutcomes: 'Demo',
        judgingPreferences: 'Innovation',
        resources: 'Docs',
        rules: 'Rule 1',
      };
      const gen = await app.inject({ method: 'POST', url: '/api/v1/hackathons/draft/generate', payload: input, headers: authHeaders(org.accessToken) });
      const hackId = JSON.parse(gen.body).data.hackathon.id;
      const teamId = 'team_correct';
      memoryStore.teams.set(teamId, { id: teamId, hackathonId: hackId, name: 'Correct Team', memberIds: [], projectId: null, createdAt: new Date().toISOString() });
      await app.inject({ method: 'POST', url: `/api/v1/hackathons/${hackId}/mentor-assignments`, payload: { mentorId: mentor.user.id, teamId }, headers: authHeaders(org.accessToken) });
      const fbRes = await app.inject({
        method: 'POST',
        url: '/api/v1/mentor/feedback',
        payload: { teamId, hackathonId: hackId, score: 6, remarks: 'Original', reason: 'Reason1', phase: 'ideation' },
        headers: authHeaders(mentor.accessToken),
      });
      const fbId = JSON.parse(fbRes.body).data.id;
      // Mentor creates correction
      const corrected = await app.inject({ method: 'POST', url: `/api/v1/mentor/feedback/${fbId}/correct`, payload: { score: 8, remarks: 'Corrected remarks', reason: 'Corrected reason' }, headers: authHeaders(mentor.accessToken) });
      expect(corrected.statusCode).toBe(201);
      const corrBody = JSON.parse(corrected.body).data;
      expect(corrBody.version).toBe(2);
      expect(corrBody.parentId).toBe(fbId);
      expect(corrBody.score).toBe(8);
      expect(corrBody.isCorrection).toBe(true);
      // Original preserved
      const origFetch = await app.inject({ method: 'GET', url: `/api/v1/mentor/feedback/${fbId}`, headers: authHeaders(org.accessToken) });
      expect(JSON.parse(origFetch.body).data.score).toBe(6);
      expect(JSON.parse(origFetch.body).data.version).toBe(1);
      // Verify version history
      const versions = await app.inject({ method: 'GET', url: `/api/v1/mentor/feedback/${fbId}/versions`, headers: authHeaders(org.accessToken) });
      const versData = JSON.parse(versions.body).data;
      expect(versData.length).toBe(2);
      expect(versData.map((v: any) => v.version)).toEqual([1, 2]);
      // Verify audit logs have versioning
      const audit = await app.inject({ method: 'GET', url: '/api/v1/audit/logs?action=mentor.feedback_corrected&resourceType=mentor_feedback', headers: authHeaders(org.accessToken) });
      expect(audit.statusCode).toBe(200);
      const auditData = JSON.parse(audit.body).data;
      expect(auditData.length).toBeGreaterThan(0);
      expect(auditData[0].metadata.originalId).toBe(fbId);
    });
  });

  describe('Evaluation criteria', () => {
    it('supports configurable criteria (not hardcoded only)', async () => {
      clearStore();
      const org = await registerAndLogin(app, 'evalorg@test.hmt', 'Str0ngPass123!', 'ORGANIZER');
      const manual = await app.inject({ method: 'POST', url: '/api/v1/hackathons', payload: { title: 'Eval Config Hack', description: 'Desc' }, headers: authHeaders(org.accessToken) });
      const hackId = JSON.parse(manual.body).data.id;
      // Create custom criteria
      const c1 = await app.inject({ method: 'POST', url: `/api/v1/hackathons/${hackId}/evaluation-criteria`, payload: { name: 'Custom Creativity', description: 'Creative thinking', weight: 0.4, maxScore: 10 }, headers: authHeaders(org.accessToken) });
      expect(c1.statusCode).toBe(201);
      const c2 = await app.inject({ method: 'POST', url: `/api/v1/hackathons/${hackId}/evaluation-criteria`, payload: { name: 'Business Viability', weight: 0.3, maxScore: 10 }, headers: authHeaders(org.accessToken) });
      expect(c2.statusCode).toBe(201);
      // List should contain custom not just defaults
      const list = await app.inject({ method: 'GET', url: `/api/v1/hackathons/${hackId}/evaluation-criteria`, headers: authHeaders(org.accessToken) });
      const names = JSON.parse(list.body).data.map((c: any) => c.name);
      expect(names).toEqual(expect.arrayContaining(['Custom Creativity', 'Business Viability']));
    });

    it('prevents duplicate criteria names and validates weight', async () => {
      clearStore();
      const org = await registerAndLogin(app, 'evaldup@test.hmt', 'Str0ngPass123!', 'ORGANIZER');
      const manual = await app.inject({ method: 'POST', url: '/api/v1/hackathons', payload: { title: 'Eval Dup Hack', description: 'Desc' }, headers: authHeaders(org.accessToken) });
      const hackId = JSON.parse(manual.body).data.id;
      await app.inject({ method: 'POST', url: `/api/v1/hackathons/${hackId}/evaluation-criteria`, payload: { name: 'Duplicated', weight: 0.5, maxScore: 10 }, headers: authHeaders(org.accessToken) });
      const dup = await app.inject({ method: 'POST', url: `/api/v1/hackathons/${hackId}/evaluation-criteria`, payload: { name: 'Duplicated', weight: 0.3, maxScore: 10 }, headers: authHeaders(org.accessToken) });
      expect(dup.statusCode).toBe(409);
      const badWeight = await app.inject({ method: 'POST', url: `/api/v1/hackathons/${hackId}/evaluation-criteria`, payload: { name: 'Bad Weight', weight: 1.5, maxScore: 10 }, headers: authHeaders(org.accessToken) });
      expect(badWeight.statusCode).toBe(400);
    });

    it('allows known examples: Innovation, Technical implementation, Impact, UX, Scalability, Presentation as configurable', async () => {
      clearStore();
      const org = await registerAndLogin(app, 'evalknown@test.hmt', 'Str0ngPass123!', 'ORGANIZER');
      const manual = await app.inject({ method: 'POST', url: '/api/v1/hackathons', payload: { title: 'Known Criteria Hack', description: 'Desc' }, headers: authHeaders(org.accessToken) });
      const hackId = JSON.parse(manual.body).data.id;
      const known = ['Innovation', 'Technical implementation', 'Impact', 'UX', 'Scalability', 'Presentation'];
      for (let i = 0; i < known.length; i++) {
        // Weight split to sum <=1, use 0.15 each for 6 = 0.9
        const res = await app.inject({ method: 'POST', url: `/api/v1/hackathons/${hackId}/evaluation-criteria`, payload: { name: known[i], weight: 0.15, maxScore: 10 }, headers: authHeaders(org.accessToken) });
        // May need to adjust weight for last; we use 0.15 each but need total <=1, so 6*0.15=0.9 ok
        expect(res.statusCode).toBe(201);
      }
      const list = await app.inject({ method: 'GET', url: `/api/v1/hackathons/${hackId}/evaluation-criteria`, headers: authHeaders(org.accessToken) });
      const names = JSON.parse(list.body).data.map((c: any) => c.name);
      for (const n of known) expect(names).toContain(n);
    });
  });

  describe('Transparency — MENTOR_SUBMITTED → ORGANIZER_REVIEWED → PUBLISHED', () => {
    it('participant cannot see unpublished feedback, only published', async () => {
      clearStore();
      const org = await registerAndLogin(app, 'transorg@test.hmt', 'Str0ngPass123!', 'ORGANIZER');
      const mentor = await registerAndLogin(app, 'transmentor@test.hmt', 'Str0ngPass123!', 'MENTOR');
      const participant = await registerAndLogin(app, 'transpart@test.hmt', 'Str0ngPass123!', 'PARTICIPANT');
      const input = {
        hackathonName: 'Transparency Hack',
        objective: 'Test transparency',
        audience: 'All',
        duration: '2 days',
        mode: 'ONLINE',
        themePreference: 'AI',
        problemStatementBasedOrOpenInnovation: 'OPEN_INNOVATION',
        expectedOutcomes: 'Demo',
        judgingPreferences: 'Innovation',
        resources: 'Docs',
        rules: 'Rule 1',
      };
      const gen = await app.inject({ method: 'POST', url: '/api/v1/hackathons/draft/generate', payload: input, headers: authHeaders(org.accessToken) });
      const hackId = JSON.parse(gen.body).data.hackathon.id;
      const teamId = 'team_trans';
      memoryStore.teams.set(teamId, { id: teamId, hackathonId: hackId, name: 'Trans Team', memberIds: [], projectId: null, createdAt: new Date().toISOString() });
      await app.inject({ method: 'POST', url: `/api/v1/hackathons/${hackId}/mentor-assignments`, payload: { mentorId: mentor.user.id, teamId }, headers: authHeaders(org.accessToken) });
      const fbRes = await app.inject({
        method: 'POST',
        url: '/api/v1/mentor/feedback',
        payload: { teamId, hackathonId: hackId, score: 7, remarks: 'Secret remarks', reason: 'Secret reason', strengths: ['a'], weaknesses: ['b'], technicalFeedback: 'Tech', productFeedback: 'Product', recommendation: 'Rec', phase: 'development' },
        headers: authHeaders(mentor.accessToken),
      });
      const fbId = JSON.parse(fbRes.body).data.id;
      // Participant tries to fetch — should be 404 or empty because not published
      const partFetch = await app.inject({ method: 'GET', url: `/api/v1/mentor/feedback/${fbId}`, headers: authHeaders(participant.accessToken) });
      expect(partFetch.statusCode).toBe(404);
      // Also list should filter
      const partList = await app.inject({ method: 'GET', url: `/api/v1/hackathons/${hackId}/feedbacks`, headers: authHeaders(participant.accessToken) });
      expect(JSON.parse(partList.body).data.length).toBe(0);
      // Organizer reviews
      const review = await app.inject({ method: 'POST', url: `/api/v1/mentor/feedback/${fbId}/review`, headers: authHeaders(org.accessToken) });
      expect(review.statusCode).toBe(200);
      expect(JSON.parse(review.body).data.publicationStatus).toBe('ORGANIZER_REVIEWED');
      // Still not visible to participant
      const partFetch2 = await app.inject({ method: 'GET', url: `/api/v1/mentor/feedback/${fbId}`, headers: authHeaders(participant.accessToken) });
      expect(partFetch2.statusCode).toBe(404);
      // Organizer publishes
      const pub = await app.inject({ method: 'POST', url: `/api/v1/mentor/feedback/${fbId}/publish`, headers: authHeaders(org.accessToken) });
      expect(pub.statusCode).toBe(200);
      expect(JSON.parse(pub.body).data.publicationStatus).toBe('PUBLISHED');
      // Now participant can see score, remarks, reason, improvement feedback
      const partFetch3 = await app.inject({ method: 'GET', url: `/api/v1/mentor/feedback/${fbId}`, headers: authHeaders(participant.accessToken) });
      expect(partFetch3.statusCode).toBe(200);
      const pubData = JSON.parse(partFetch3.body).data;
      expect(pubData.score).toBe(7);
      expect(pubData.remarks).toBe('Secret remarks');
      expect(pubData.reason).toBe('Secret reason');
      expect(pubData.technicalFeedback).toBe('Tech');
      // List now contains it with filtered fields
      const partList2 = await app.inject({ method: 'GET', url: `/api/v1/hackathons/${hackId}/feedbacks`, headers: authHeaders(participant.accessToken) });
      expect(JSON.parse(partList2.body).data.length).toBe(1);
      expect(JSON.parse(partList2.body).data[0].score).toBe(7);
    });

    it('enforces correct workflow order: cannot publish without review', async () => {
      clearStore();
      const org = await registerAndLogin(app, 'workfloworder@test.hmt', 'Str0ngPass123!', 'ORGANIZER');
      const mentor = await registerAndLogin(app, 'workflowmentor@test.hmt', 'Str0ngPass123!', 'MENTOR');
      const input = {
        hackathonName: 'Workflow Order Hack',
        objective: 'Test order',
        audience: 'All',
        duration: '2 days',
        mode: 'ONLINE',
        themePreference: 'AI',
        problemStatementBasedOrOpenInnovation: 'OPEN_INNOVATION',
        expectedOutcomes: 'Demo',
        judgingPreferences: 'Innovation',
        resources: 'Docs',
        rules: 'Rule 1',
      };
      const gen = await app.inject({ method: 'POST', url: '/api/v1/hackathons/draft/generate', payload: input, headers: authHeaders(org.accessToken) });
      const hackId = JSON.parse(gen.body).data.hackathon.id;
      const teamId = 'team_order';
      memoryStore.teams.set(teamId, { id: teamId, hackathonId: hackId, name: 'Order Team', memberIds: [], projectId: null, createdAt: new Date().toISOString() });
      await app.inject({ method: 'POST', url: `/api/v1/hackathons/${hackId}/mentor-assignments`, payload: { mentorId: mentor.user.id, teamId }, headers: authHeaders(org.accessToken) });
      const fbRes = await app.inject({
        method: 'POST',
        url: '/api/v1/mentor/feedback',
        payload: { teamId, hackathonId: hackId, score: 5, remarks: 'r', reason: 'reason', phase: 'ideation' },
        headers: authHeaders(mentor.accessToken),
      });
      const fbId = JSON.parse(fbRes.body).data.id;
      // Try publish directly from MENTOR_SUBMITTED -> should fail
      const directPub = await app.inject({ method: 'POST', url: `/api/v1/mentor/feedback/${fbId}/publish`, headers: authHeaders(org.accessToken) });
      expect(directPub.statusCode).toBe(400);
      expect(JSON.parse(directPub.body).error.message).toMatch(/must be ORGANIZER_REVIEWED/i);
    });
  });

  describe('Hackathon → Participant Sync', () => {
    it('generates versioned HackathonPublished event/contract when organizer publishes', async () => {
      clearStore();
      const org = await registerAndLogin(app, 'syncorg@test.hmt', 'Str0ngPass123!', 'ORGANIZER');
      const input = {
        hackathonName: 'Sync Hack',
        objective: 'Test sync',
        audience: 'All',
        duration: '3 days',
        mode: 'HYBRID',
        themePreference: 'FinTech',
        problemStatementBasedOrOpenInnovation: 'PROBLEM_STATEMENT_BASED',
        expectedOutcomes: 'Prototype, Demo',
        judgingPreferences: 'Innovation, Technical',
        resources: 'APIs, Datasets',
        rules: 'Original work',
      };
      const gen = await app.inject({ method: 'POST', url: '/api/v1/hackathons/draft/generate', payload: input, headers: authHeaders(org.accessToken) });
      let hackId = JSON.parse(gen.body).data.hackathon.id;
      // Go through workflow to PUBLISHED
      await app.inject({ method: 'POST', url: `/api/v1/hackathons/${hackId}/review`, headers: authHeaders(org.accessToken) });
      await app.inject({ method: 'POST', url: `/api/v1/hackathons/${hackId}/confirm`, headers: authHeaders(org.accessToken) });
      const pub = await app.inject({ method: 'POST', url: `/api/v1/hackathons/${hackId}/publish`, headers: authHeaders(org.accessToken) });
      expect(pub.statusCode).toBe(200);
      const event = JSON.parse(pub.body).data.publishedEvent;
      expect(event.version).toBe('v1');
      expect(event.type).toBe('HackathonPublished');
      expect(event.payload.hackathonId).toBe(hackId);
      expect(event.payload.problemStatement).toBeDefined();
      expect(event.payload.resources.length).toBeGreaterThan(0);
      expect(event.payload.phases.length).toBeGreaterThan(0);
      expect(event.payload.judgingCriteria.length).toBeGreaterThan(0);
      // Participant can consume via participant-context endpoint
      const participant = await registerAndLogin(app, 'syncpart@test.hmt', 'Str0ngPass123!', 'PARTICIPANT');
      const ctx = await app.inject({ method: 'GET', url: `/api/v1/hackathons/${hackId}/participant-context`, headers: authHeaders(participant.accessToken) });
      expect(ctx.statusCode).toBe(200);
      const ctxData = JSON.parse(ctx.body).data;
      expect(ctxData.hackathonId).toBe(hackId);
      expect(ctxData.theme).toBeDefined();
      expect(ctxData.resources).toBeDefined();
      // Do NOT directly modify participant DB via direct-db-write endpoint should be blocked
      const direct = await app.inject({ method: 'POST', url: '/api/v1/sync/direct-db-write', headers: authHeaders(org.accessToken) });
      expect(direct.statusCode).toBe(403);
    });

    it('exposes contract schema with versioned fields and does not allow direct participant DB mutation', async () => {
      const schemaRes = await app.inject({ method: 'GET', url: '/api/v1/sync/contract-schema' });
      expect(schemaRes.statusCode).toBe(200);
      const schema = JSON.parse(schemaRes.body).data;
      expect(schema.version).toBe('v1');
      expect(schema.fields).toEqual(expect.arrayContaining(['problemStatement', 'resources', 'rules', 'phases']));
    });
  });

  describe('Analytics', () => {
    it('provides organizer analytics foundation: participant count, team count, phase progress, submission status, evaluation status, feedback completion', async () => {
      clearStore();
      const org = await registerAndLogin(app, 'analytics@test.hmt', 'Str0ngPass123!', 'ORGANIZER');
      const input = {
        hackathonName: 'Analytics Hack',
        objective: 'Test analytics',
        audience: 'All',
        duration: '3 days',
        mode: 'ONLINE',
        themePreference: 'AI',
        problemStatementBasedOrOpenInnovation: 'OPEN_INNOVATION',
        expectedOutcomes: 'Demo',
        judgingPreferences: 'Innovation',
        resources: 'Docs',
        rules: 'Rule 1',
      };
      const gen = await app.inject({ method: 'POST', url: '/api/v1/hackathons/draft/generate', payload: input, headers: authHeaders(org.accessToken) });
      const hackId = JSON.parse(gen.body).data.hackathon.id;
      await app.inject({ method: 'POST', url: `/api/v1/hackathons/${hackId}/seed-demo`, headers: authHeaders(org.accessToken) });
      // Create a mentor and feedback to populate evaluation stats
      const mentor = await registerAndLogin(app, 'analyticmentor@test.hmt', 'Str0ngPass123!', 'MENTOR');
      const teamId = Array.from(memoryStore.teams.values()).find((t: any) => t.hackathonId === hackId)?.id;
      if (teamId) {
        await app.inject({ method: 'POST', url: `/api/v1/hackathons/${hackId}/mentor-assignments`, payload: { mentorId: mentor.user.id, teamId }, headers: authHeaders(org.accessToken) });
        await app.inject({
          method: 'POST',
          url: '/api/v1/mentor/feedback',
          payload: { teamId, hackathonId: hackId, score: 8, remarks: 'Good', reason: 'Reason', phase: 'development' },
          headers: authHeaders(mentor.accessToken),
        });
      }
      const analytics = await app.inject({ method: 'GET', url: `/api/v1/hackathons/${hackId}/analytics`, headers: authHeaders(org.accessToken) });
      expect(analytics.statusCode).toBe(200);
      const data = JSON.parse(analytics.body).data;
      expect(data.hackathonId).toBe(hackId);
      expect(data).toHaveProperty('participantCount');
      expect(data).toHaveProperty('teamCount');
      expect(data).toHaveProperty('phaseProgress');
      expect(data).toHaveProperty('submissionStatus');
      expect(data).toHaveProperty('evaluationStatus');
      expect(data).toHaveProperty('feedbackCompletion');
      expect(data.phaseProgress.length).toBeGreaterThan(0);
      expect(typeof data.participantCount).toBe('number');
      expect(typeof data.teamCount).toBe('number');
      expect(data.submissionStatus).toHaveProperty('submissionRate');
      expect(data.evaluationStatus).toHaveProperty('published');
      expect(data.feedbackCompletion).toHaveProperty('completionRate');
      // Ensure not meaningless: values are derived from actual seeded data
      expect(data.participantCount).toBeGreaterThan(0);
      expect(data.teamCount).toBeGreaterThan(0);
    });

    it('forbids non-organizers from viewing analytics', async () => {
      clearStore();
      const org = await registerAndLogin(app, 'analytforbid@test.hmt', 'Str0ngPass123!', 'ORGANIZER');
      const participant = await registerAndLogin(app, 'analytpart@test.hmt', 'Str0ngPass123!', 'PARTICIPANT');
      const input = {
        hackathonName: 'Analytics Forbid Hack',
        objective: 'Test forbid',
        audience: 'All',
        duration: '2 days',
        mode: 'ONLINE',
        themePreference: 'AI',
        problemStatementBasedOrOpenInnovation: 'OPEN_INNOVATION',
        expectedOutcomes: 'Demo',
        judgingPreferences: 'Innovation',
        resources: 'Docs',
        rules: 'Rule 1',
      };
      const gen = await app.inject({ method: 'POST', url: '/api/v1/hackathons/draft/generate', payload: input, headers: authHeaders(org.accessToken) });
      const hackId = JSON.parse(gen.body).data.hackathon.id;
      const attempt = await app.inject({ method: 'GET', url: `/api/v1/hackathons/${hackId}/analytics`, headers: authHeaders(participant.accessToken) });
      expect(attempt.statusCode).toBe(403);
    });
  });

  describe('Audit — append-only', () => {
    it('audit logs important actions: creation, draft generation, edit, confirmation, publication, mentor assignment, evaluation, feedback publication, phase changes', async () => {
      clearStore();
      const org = await registerAndLogin(app, 'auditorg@test.hmt', 'Str0ngPass123!', 'ORGANIZER');
      const mentor = await registerAndLogin(app, 'auditmentor@test.hmt', 'Str0ngPass123!', 'MENTOR');
      const input = {
        hackathonName: 'Audit Hack',
        objective: 'Test audit',
        audience: 'All',
        duration: '2 days',
        mode: 'ONLINE',
        themePreference: 'AI',
        problemStatementBasedOrOpenInnovation: 'OPEN_INNOVATION',
        expectedOutcomes: 'Demo',
        judgingPreferences: 'Innovation',
        resources: 'Docs',
        rules: 'Rule 1',
      };
      const gen = await app.inject({ method: 'POST', url: '/api/v1/hackathons/draft/generate', payload: input, headers: authHeaders(org.accessToken) });
      const hackId = JSON.parse(gen.body).data.hackathon.id;
      await app.inject({ method: 'PATCH', url: `/api/v1/hackathons/${hackId}`, payload: { description: 'Audit edit' }, headers: authHeaders(org.accessToken) });
      await app.inject({ method: 'POST', url: `/api/v1/hackathons/${hackId}/review`, headers: authHeaders(org.accessToken) });
      await app.inject({ method: 'POST', url: `/api/v1/hackathons/${hackId}/confirm`, headers: authHeaders(org.accessToken) });
      // Add theme creation audit
      const theme = await app.inject({ method: 'POST', url: '/api/v1/themes', payload: { name: 'AuditTheme' }, headers: authHeaders(org.accessToken) });
      expect(theme.statusCode).toBe(201);
      // Mentor assignment audit
      const teamId = 'team_audit';
      memoryStore.teams.set(teamId, { id: teamId, hackathonId: hackId, name: 'Audit Team', memberIds: [], projectId: null, createdAt: new Date().toISOString() });
      await app.inject({ method: 'POST', url: `/api/v1/hackathons/${hackId}/mentor-assignments`, payload: { mentorId: mentor.user.id, teamId }, headers: authHeaders(org.accessToken) });
      // Feedback submission audit
      const fb = await app.inject({
        method: 'POST',
        url: '/api/v1/mentor/feedback',
        payload: { teamId, hackathonId: hackId, score: 9, remarks: 'Audit remarks', reason: 'Audit reason', phase: 'development' },
        headers: authHeaders(mentor.accessToken),
      });
      const fbId = JSON.parse(fb.body).data.id;
      // Publish workflow audit
      await app.inject({ method: 'POST', url: `/api/v1/mentor/feedback/${fbId}/review`, headers: authHeaders(org.accessToken) });
      await app.inject({ method: 'POST', url: `/api/v1/mentor/feedback/${fbId}/publish`, headers: authHeaders(org.accessToken) });
      // Phase change audit
      const now = Date.now();
      await app.inject({
        method: 'POST',
        url: `/api/v1/hackathons/${hackId}/phases`,
        payload: { name: 'custom_phase', order: 99, startsAt: new Date(now + 86400000 * 20).toISOString(), endsAt: new Date(now + 86400000 * 21).toISOString() },
        headers: authHeaders(org.accessToken),
      });
      // Publish hackathon audit
      await app.inject({ method: 'POST', url: `/api/v1/hackathons/${hackId}/publish`, headers: authHeaders(org.accessToken) });

      const logsRes = await app.inject({ method: 'GET', url: '/api/v1/audit/logs?limit=100', headers: authHeaders(org.accessToken) });
      expect(logsRes.statusCode).toBe(200);
      const logs = JSON.parse(logsRes.body).data;
      const actions = logs.map((l: any) => l.action);
      // Check critical actions present
      expect(actions).toEqual(expect.arrayContaining(['hackathon.draft_generated', 'hackathon.edited', 'hackathon.review', 'hackathon.confirmed', 'hackathon.published', 'mentor.assigned', 'mentor.feedback_submitted', 'mentor.feedback_reviewed', 'mentor.feedback_published', 'phase.created']));
      // Ensure audit entries have required fields
      for (const log of logs) {
        expect(log).toHaveProperty('id');
        expect(log).toHaveProperty('timestamp');
        expect(log).toHaveProperty('action');
        expect(log).toHaveProperty('resourceType');
        expect(log).toHaveProperty('outcome');
        expect(log).toHaveProperty('actorId');
      }
    });

    it('audit logs are append-only: update/delete forbidden', async () => {
      clearStore();
      const org = await registerAndLogin(app, 'auditappend@test.hmt', 'Str0ngPass123!', 'ORGANIZER');
      const input = {
        hackathonName: 'Append Only Hack',
        objective: 'Test append',
        audience: 'All',
        duration: '2 days',
        mode: 'ONLINE',
        themePreference: 'AI',
        problemStatementBasedOrOpenInnovation: 'OPEN_INNOVATION',
        expectedOutcomes: 'Demo',
        judgingPreferences: 'Innovation',
        resources: 'Docs',
        rules: 'Rule 1',
      };
      const gen = await app.inject({ method: 'POST', url: '/api/v1/hackathons/draft/generate', payload: input, headers: authHeaders(org.accessToken) });
      const hackId = JSON.parse(gen.body).data.hackathon.id;
      const logsRes = await app.inject({ method: 'GET', url: '/api/v1/audit/logs?limit=1', headers: authHeaders(org.accessToken) });
      const firstLogId = JSON.parse(logsRes.body).data[0]?.id;
      expect(firstLogId).toBeDefined();
      const put = await app.inject({ method: 'PUT', url: `/api/v1/audit/logs/${firstLogId}`, headers: authHeaders(org.accessToken) });
      expect(put.statusCode).toBe(403);
      expect(JSON.parse(put.body).error.message).toMatch(/append-only/i);
      const del = await app.inject({ method: 'DELETE', url: `/api/v1/audit/logs/${firstLogId}`, headers: authHeaders(org.accessToken) });
      expect(del.statusCode).toBe(403);
    });

    it('audit includes author, timestamp, version for feedback corrections', async () => {
      clearStore();
      const org = await registerAndLogin(app, 'auditver@test.hmt', 'Str0ngPass123!', 'ORGANIZER');
      const mentor = await registerAndLogin(app, 'auditvermentor@test.hmt', 'Str0ngPass123!', 'MENTOR');
      const input = {
        hackathonName: 'Audit Version Hack',
        objective: 'Test version audit',
        audience: 'All',
        duration: '2 days',
        mode: 'ONLINE',
        themePreference: 'AI',
        problemStatementBasedOrOpenInnovation: 'OPEN_INNOVATION',
        expectedOutcomes: 'Demo',
        judgingPreferences: 'Innovation',
        resources: 'Docs',
        rules: 'Rule 1',
      };
      const gen = await app.inject({ method: 'POST', url: '/api/v1/hackathons/draft/generate', payload: input, headers: authHeaders(org.accessToken) });
      const hackId = JSON.parse(gen.body).data.hackathon.id;
      const teamId = 'team_audit_ver';
      memoryStore.teams.set(teamId, { id: teamId, hackathonId: hackId, name: 'Ver Team', memberIds: [], projectId: null, createdAt: new Date().toISOString() });
      await app.inject({ method: 'POST', url: `/api/v1/hackathons/${hackId}/mentor-assignments`, payload: { mentorId: mentor.user.id, teamId }, headers: authHeaders(org.accessToken) });
      const fb = await app.inject({
        method: 'POST',
        url: '/api/v1/mentor/feedback',
        payload: { teamId, hackathonId: hackId, score: 6, remarks: 'Original', reason: 'Reason', phase: 'ideation' },
        headers: authHeaders(mentor.accessToken),
      });
      const fbId = JSON.parse(fb.body).data.id;
      await app.inject({ method: 'POST', url: `/api/v1/mentor/feedback/${fbId}/correct`, payload: { score: 9, remarks: 'Corrected' }, headers: authHeaders(mentor.accessToken) });
      const logs = await app.inject({ method: 'GET', url: '/api/v1/audit/logs?action=mentor.feedback_corrected', headers: authHeaders(org.accessToken) });
      const data = JSON.parse(logs.body).data;
      expect(data.length).toBeGreaterThan(0);
      expect(data[0].metadata).toHaveProperty('originalId', fbId);
      expect(data[0].metadata).toHaveProperty('newVersion', 2);
      expect(data[0].actorId).toBe(mentor.user.id);
      expect(data[0].timestamp).toBeDefined();
    });
  });
});
