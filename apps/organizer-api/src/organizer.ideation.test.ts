import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { DEFAULT_IDEATION_ROUNDS, defaultIdeationConfig } from '@hmt/contracts';
import { buildApp } from './main';
import { memoryStore } from './store/memory.store';

describe('Organizer ideation rounds', () => {
  let app: any;
  let orgToken = '';
  let otherOrgToken = '';
  let hackathonId = '';
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function register(email: string, phoneNumber: string) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email,
        password: 'Str0ngPass123!',
        displayName: email,
        role: 'ORGANIZER',
        phoneNumber,
      },
    });
    return JSON.parse(res.body).accessToken as string;
  }

  beforeAll(async () => {
    process.env.DATABASE_URL =
      process.env.DATABASE_URL ||
      'postgresql://hmt:hmt_dev_password_change_in_prod@localhost:5432/hmt?schema=public';
    process.env.NEO4J_PASSWORD = process.env.NEO4J_PASSWORD || 'hmt_neo4j_password';
    process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'a'.repeat(32);
    process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'b'.repeat(32);
    process.env.AI_PROVIDER = 'mock';
    app = await buildApp();
    await app.ready();
    memoryStore.clear();
    orgToken = await register('ideation-org@test.hmt', '+14155550031');
    otherOrgToken = await register('ideation-other@test.hmt', '+14155550032');
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/hackathons',
      headers: auth(orgToken),
      payload: { title: 'Ideathon', description: 'Incubate ideas' },
    });
    hackathonId = JSON.parse(created.body).data.id;
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const validConfig = () => ({
    ...defaultIdeationConfig(),
    currentRound: 2,
    extraInstructions: 'Focus on campus problems.',
  });

  it('returns the five default rounds with round 1 active', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/hackathons/${hackathonId}/ideation`,
      headers: auth(orgToken),
    });
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body).data;
    expect(data.currentRound).toBe(1);
    expect(data.rounds).toHaveLength(5);
    expect(data.rounds.map((r: any) => r.title)).toEqual(
      DEFAULT_IDEATION_ROUNDS.map((r) => r.title),
    );
  });

  it('rejects non-owners', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/hackathons/${hackathonId}/ideation`,
      headers: auth(otherOrgToken),
    });
    expect(res.statusCode).toBe(403);
  });

  it('validates the config shape', async () => {
    const badRound = await app.inject({
      method: 'PUT',
      url: `/api/v1/hackathons/${hackathonId}/ideation`,
      headers: auth(orgToken),
      payload: { ...validConfig(), currentRound: 6 },
    });
    expect(badRound.statusCode).toBe(400);
    const fourRounds = await app.inject({
      method: 'PUT',
      url: `/api/v1/hackathons/${hackathonId}/ideation`,
      headers: auth(orgToken),
      payload: { ...validConfig(), rounds: validConfig().rounds.slice(0, 4) },
    });
    expect(fourRounds.statusCode).toBe(400);
    const emptyQuestions = validConfig();
    emptyQuestions.rounds[0] = { ...emptyQuestions.rounds[0], questions: [] };
    const noQuestions = await app.inject({
      method: 'PUT',
      url: `/api/v1/hackathons/${hackathonId}/ideation`,
      headers: auth(orgToken),
      payload: emptyQuestions,
    });
    expect(noQuestions.statusCode).toBe(400);
  });

  it('saves a draft hackathon config without pushing and audits it', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/hackathons/${hackathonId}/ideation`,
      headers: auth(orgToken),
      payload: validConfig(),
    });
    expect(res.statusCode).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();
    const read = await app.inject({
      method: 'GET',
      url: `/api/v1/hackathons/${hackathonId}/ideation`,
      headers: auth(orgToken),
    });
    expect(JSON.parse(read.body).data.currentRound).toBe(2);
    expect(
      Array.from(memoryStore.auditLogs.values()).some(
        (log) => log.action === 'hackathon.ideation_updated' && log.resourceId === hackathonId,
      ),
    ).toBe(true);
  });

  it('pushes published hackathons to the participant app and returns 502 when delivery fails', async () => {
    const stored = memoryStore.hackathons.get(hackathonId)!;
    memoryStore.hackathons.set(hackathonId, { ...stored, status: 'PUBLISHED' });
    const ok = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
    const delivered = await app.inject({
      method: 'PUT',
      url: `/api/v1/hackathons/${hackathonId}/ideation`,
      headers: auth(orgToken),
      payload: { ...validConfig(), currentRound: 3 },
    });
    expect(delivered.statusCode).toBe(200);
    const [url, init] = ok.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(new RegExp(`/sync/ideation/${hackathonId}$`));
    expect(init.method).toBe('PUT');
    expect(JSON.parse(String(init.body)).currentRound).toBe(3);
    ok.mockResolvedValue(new Response('{}', { status: 500 }));
    const failed = await app.inject({
      method: 'PUT',
      url: `/api/v1/hackathons/${hackathonId}/ideation`,
      headers: auth(orgToken),
      payload: { ...validConfig(), currentRound: 4 },
    });
    expect(failed.statusCode).toBe(502);
    expect(JSON.parse(failed.body).error.code).toBe('SYNC_FAILED');
  });

  it('delivers rapid round changes in order so the participant app ends on the latest round', async () => {
    const stored = memoryStore.hackathons.get(hackathonId)!;
    memoryStore.hackathons.set(hackathonId, { ...stored, status: 'PUBLISHED' });
    const delivered: number[] = [];
    let call = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const round = JSON.parse(String((init as RequestInit).body)).currentRound;
      await new Promise((resolve) => setTimeout(resolve, call++ === 0 ? 40 : 0));
      delivered.push(round);
      return new Response('{}', { status: 200 });
    });
    const put = (round: number) =>
      app.inject({
        method: 'PUT',
        url: `/api/v1/hackathons/${hackathonId}/ideation`,
        headers: auth(orgToken),
        payload: { ...validConfig(), currentRound: round },
      });
    const [first, second] = await Promise.all([put(3), put(4)]);
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(delivered[delivered.length - 1]).toBe(4);
    expect(memoryStore.hackathons.get(hackathonId)!.ideation!.currentRound).toBe(4);
  });
});
