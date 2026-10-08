import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { buildApp } from './main';
import { memoryStore } from './store/memory.store';

// Wizard automation tests: 5-question generation, modes, types, structured
// validation, section regeneration, edits, persistence, state machine,
// authorization, visibility, audit, secret hygiene. (Run: pnpm test)

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

const WIZARD = {
  mode: 'HYBRID',
  about: 'AI for Education — personalized tutoring',
  hackathonType: 'HYBRID',
  eligibility: ['Students', 'Developers'],
  durationPlus: '3 days\nReact welcome\nPrizes: best prototype wins glory',
};

describe('Organizer wizard automation', () => {
  let app: any;
  let orgToken = '';
  let participantToken = '';

  beforeAll(async () => {
    loadEnvFromFile();
    process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://hmt:hmt_dev_password_change_in_prod@localhost:5432/hmt?schema=public';
    process.env.NEO4J_PASSWORD = process.env.NEO4J_PASSWORD || 'hmt_neo4j_password';
    process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'a'.repeat(32);
    process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'b'.repeat(32);
    process.env.REDIS_URL = process.env.REDIS_URL || 'redis://:hmt_redis_password@localhost:6379';
    process.env.AI_PROVIDER = 'mock';
    app = await buildApp();
    await app.ready();
    memoryStore.clear();
    const org = await app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: { email: 'wizard-org@test.hmt', password: 'Str0ngPass123!', displayName: 'Wizard Org', role: 'ORGANIZER', phoneNumber: '+14155550011' } });
    orgToken = JSON.parse(org.body).accessToken;
    const part = await app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: { email: 'wizard-part@test.hmt', password: 'Str0ngPass123!', displayName: 'Wizard Part', role: 'PARTICIPANT', phoneNumber: '+14155550012' } });
    participantToken = JSON.parse(part.body).accessToken;
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  async function generateWizard(overrides: Record<string, unknown> = {}) {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/hackathons/wizard/generate',
      headers: auth(orgToken), payload: { ...WIZARD, ...overrides },
    });
    return res;
  }

  it('generates from 5 questions into DRAFT (never published)', async () => {
    const res = await generateWizard();
    expect(res.statusCode).toBe(201);
    const { hackathon, draft } = JSON.parse(res.body).data;
    expect(hackathon.status).toBe('DRAFT');
    expect(hackathon.title).toBeTruthy();
    expect(draft.tagline).toBeTruthy();
    expect(draft.announcement).toBeTruthy();
    expect(draft.codeOfConduct.length).toBeGreaterThan(0);
    expect(draft.faqs.length).toBeGreaterThan(0);
    const prov = hackathon.metadata.sectionProvenance;
    expect(prov.title).toBe('AI_GENERATED');
  });

  it.each(['ONLINE', 'OFFLINE', 'HYBRID'] as const)('mode %s shapes participation instructions', async (mode) => {
    const res = await generateWizard({ mode });
    expect(res.statusCode).toBe(201);
    const { draft } = JSON.parse(res.body).data;
    expect(draft.mode).toBe(mode);
    if (mode === 'ONLINE') expect(draft.participationInstructions).toMatch(/virtual/i);
    if (mode === 'OFFLINE') expect(draft.participationInstructions).toMatch(/on-site|venue/i);
    if (mode === 'HYBRID') expect(draft.participationInstructions).toMatch(/hybrid/i);
    // No fabricated venues
    expect(JSON.stringify(draft)).not.toMatch(/123 Main St|Grand Hotel|Convention Center/);
  });

  it.each(['PROBLEM_STATEMENT_BASED', 'OPEN_INNOVATION', 'HYBRID'] as const)('type %s yields applicable sections', async (hackathonType) => {
    const res = await generateWizard({ hackathonType });
    expect(res.statusCode).toBe(201);
    const { draft } = JSON.parse(res.body).data;
    expect(draft.hackathonType).toBe(hackathonType);
    if (hackathonType === 'OPEN_INNOVATION') expect(draft.problemStatements ?? []).toEqual([]);
    else expect((draft.problemStatements ?? []).length).toBeGreaterThan(0);
  });

  it('rejects invalid wizard input (400)', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/hackathons/wizard/generate',
      headers: auth(orgToken), payload: { mode: 'HYBRID', about: '', hackathonType: 'HYBRID', eligibility: [], durationPlus: '' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('regenerates ONLY the requested section', async () => {
    const gen = await generateWizard();
    const { hackathon } = JSON.parse(gen.body).data;
    const before = JSON.parse(JSON.stringify(hackathon));
    const res = await app.inject({
      method: 'POST', url: `/api/v1/hackathons/${hackathon.id}/regenerate-section`,
      headers: auth(orgToken), payload: { section: 'rules' },
    });
    expect(res.statusCode).toBe(200);
    const { hackathon: after } = JSON.parse(res.body).data;
    expect(after.metadata.sectionProvenance.rules).toBe('AI_REGENERATED');
    expect(after.title).toBe(before.title);
    expect(after.description).toBe(before.description);
    expect(after.version).toBe(before.version + 1);
  });

  it('organizer edits override AI content and persist', async () => {
    const gen = await generateWizard();
    const { hackathon } = JSON.parse(gen.body).data;
    const patch = await app.inject({
      method: 'PATCH', url: `/api/v1/hackathons/${hackathon.id}`,
      headers: auth(orgToken), payload: { title: 'Human Title', tagline: 'Human tagline' },
    });
    expect(patch.statusCode).toBe(200);
    const updated = JSON.parse(patch.body).data;
    expect(updated.title).toBe('Human Title');
    expect(updated.metadata.sectionProvenance.title).toBe('ORGANIZER_EDITED');
    expect(updated.metadata.sectionProvenance.tagline).toBe('ORGANIZER_EDITED');
    // Draft persists server-side; refetch shows edits
    const refetch = await app.inject({ method: 'GET', url: `/api/v1/hackathons/${hackathon.id}`, headers: auth(orgToken) });
    expect(JSON.parse(refetch.body).data.title).toBe('Human Title');
    // Regenerating another section does not clobber the edit
    await app.inject({
      method: 'POST', url: `/api/v1/hackathons/${hackathon.id}/regenerate-section`,
      headers: auth(orgToken), payload: { section: 'faqs' },
    });
    const after = await app.inject({ method: 'GET', url: `/api/v1/hackathons/${hackathon.id}`, headers: auth(orgToken) });
    expect(JSON.parse(after.body).data.title).toBe('Human Title');
  });

  it('full state machine: REVIEW -> CONFIRMED -> PUBLISHED with validation gates', async () => {
    const gen = await generateWizard();
    const { hackathon } = JSON.parse(gen.body).data;
    const id = hackathon.id;
    // AI drafts carry dateless suggestions: set the explicit window first.
    expect((await app.inject({ method: 'POST', url: `/api/v1/hackathons/${id}/timeline/materialize`, payload: { eventStart: '2026-11-01T09:00:00.000Z', eventEnd: '2026-11-04T18:00:00.000Z' }, headers: auth(orgToken) })).statusCode).toBe(201);
    // direct publish blocked
    const direct = await app.inject({ method: 'POST', url: `/api/v1/hackathons/${id}/direct-publish`, headers: auth(orgToken), payload: {} });
    expect(direct.statusCode).toBe(400);
    // publish from DRAFT blocked
    const early = await app.inject({ method: 'POST', url: `/api/v1/hackathons/${id}/publish`, headers: auth(orgToken), payload: {} });
    expect(early.statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: `/api/v1/hackathons/${id}/review`, headers: auth(orgToken), payload: {} })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: `/api/v1/hackathons/${id}/confirm`, headers: auth(orgToken), payload: {} })).statusCode).toBe(200);
    const pub = await app.inject({ method: 'POST', url: `/api/v1/hackathons/${id}/publish`, headers: auth(orgToken), payload: {} });
    expect(pub.statusCode).toBe(200);
    // participant sees published, not drafts
    const list = await app.inject({ method: 'GET', url: '/api/v1/hackathons', headers: auth(participantToken) });
    const items = JSON.parse(list.body).data;
    expect(items.some((h: any) => h.id === id)).toBe(true);
    const drafts = items.filter((h: any) => ['DRAFT', 'REVIEW', 'CONFIRMED'].includes(h.status));
    expect(drafts).toEqual([]);
  });

  it('unauthorized publish attempts fail (401/403)', async () => {
    const gen = await generateWizard();
    const { hackathon } = JSON.parse(gen.body).data;
    const anon = await app.inject({ method: 'POST', url: `/api/v1/hackathons/${hackathon.id}/publish`, payload: {} });
    expect([401, 403]).toContain(anon.statusCode);
    const part = await app.inject({ method: 'POST', url: `/api/v1/hackathons/${hackathon.id}/publish`, headers: auth(participantToken), payload: {} });
    expect([401, 403, 400]).toContain(part.statusCode);
  });

  it('audit trail records wizard lifecycle without secrets', async () => {
    const gen = await generateWizard();
    const { hackathon } = JSON.parse(gen.body).data;
    await app.inject({ method: 'POST', url: `/api/v1/hackathons/${hackathon.id}/regenerate-section`, headers: auth(orgToken), payload: { section: 'faqs' } });
    await app.inject({ method: 'PATCH', url: `/api/v1/hackathons/${hackathon.id}`, headers: auth(orgToken), payload: { title: 'Audited Title' } });
    const logs = await app.inject({ method: 'GET', url: `/api/v1/audit/logs?limit=200`, headers: auth(orgToken) });
    expect(logs.statusCode).toBe(200);
    const actions = (JSON.parse(logs.body).data as any[]).filter((l) => l.resourceId === hackathon.id).map((l) => l.action);
    expect(actions).toContain('hackathon.wizard_generated');
    expect(actions).toContain('hackathon.section_regenerated');
    expect(actions).toContain('hackathon.edited');
    const blob = JSON.stringify(JSON.parse(logs.body).data);
    expect(blob).not.toMatch(/sk-[a-zA-Z0-9_-]{10,}|ghp_[A-Za-z0-9_]+|BEGIN [A-Z ]*PRIVATE KEY/);
  });

  it('wizard responses never leak secrets or status authority', async () => {
    const res = await generateWizard();
    const blob = res.body;
    expect(blob).not.toMatch(/sk-[a-zA-Z0-9_-]{10,}|ghp_[A-Za-z0-9_]+|BEGIN [A-Z ]*PRIVATE KEY|AKIA[0-9A-Z]{16}/);
    const { hackathon } = JSON.parse(blob).data;
    expect(hackathon.status).toBe('DRAFT');
  });
});
