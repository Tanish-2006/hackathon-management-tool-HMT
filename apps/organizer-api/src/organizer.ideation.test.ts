import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { DEFAULT_PHASES, defaultIdeationConfig } from '@hmt/contracts';
import { buildApp } from './main';
import { memoryStore } from './store/memory.store';

describe('Organizer ideation phases', () => {
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

  const validConfig = (extraInstructions = 'Focus on campus problems.') => ({
    ...defaultIdeationConfig(),
    extraInstructions,
  });

  it('returns the six default phases', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/hackathons/${hackathonId}/ideation`,
      headers: auth(orgToken),
    });
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body).data;
    expect(data.currentRound).toBeUndefined();
    expect(data.phases).toHaveLength(6);
    expect(data.phases.map((p: any) => p.id)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(data.phases.map((p: any) => p.title)).toEqual(DEFAULT_PHASES.map((p) => p.title));
    expect(data.phases[5].goal).toMatch(/60-second/);
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
    const put = (payload: unknown) =>
      app.inject({
        method: 'PUT',
        url: `/api/v1/hackathons/${hackathonId}/ideation`,
        headers: auth(orgToken),
        payload,
      });
    expect((await put({ ...validConfig(), currentRound: 2 })).statusCode).toBe(400);
    expect(
      (await put({ ...validConfig(), phases: validConfig().phases.slice(0, 5) })).statusCode,
    ).toBe(400);
    const swapped = validConfig().phases;
    [swapped[0], swapped[1]] = [swapped[1], swapped[0]];
    expect((await put({ ...validConfig(), phases: swapped })).statusCode).toBe(400);
    const longCheck = validConfig();
    longCheck.phases[2] = { ...longCheck.phases[2], exitCheck: 'x'.repeat(1501) };
    expect((await put(longCheck)).statusCode).toBe(400);
    expect((await put(validConfig('x'.repeat(4001)))).statusCode).toBe(400);
    const emptyQuestions = validConfig();
    emptyQuestions.phases[0] = { ...emptyQuestions.phases[0], questions: [] };
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
    expect(JSON.parse(read.body).data.extraInstructions).toBe('Focus on campus problems.');
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
      payload: validConfig('Push me'),
    });
    expect(delivered.statusCode).toBe(200);
    const [url, init] = ok.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(new RegExp(`/sync/ideation/${hackathonId}$`));
    expect(init.method).toBe('PUT');
    expect(JSON.parse(String(init.body)).extraInstructions).toBe('Push me');
    ok.mockResolvedValue(new Response('{}', { status: 500 }));
    const failed = await app.inject({
      method: 'PUT',
      url: `/api/v1/hackathons/${hackathonId}/ideation`,
      headers: auth(orgToken),
      payload: validConfig('Fail me'),
    });
    expect(failed.statusCode).toBe(502);
    expect(JSON.parse(failed.body).error.code).toBe('SYNC_FAILED');
  });

  it('delivers rapid config changes in order so the participant app ends on the latest config', async () => {
    const stored = memoryStore.hackathons.get(hackathonId)!;
    memoryStore.hackathons.set(hackathonId, { ...stored, status: 'PUBLISHED' });
    const delivered: string[] = [];
    let call = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const round = JSON.parse(String((init as RequestInit).body)).extraInstructions;
      await new Promise((resolve) => setTimeout(resolve, call++ === 0 ? 40 : 0));
      delivered.push(round);
      return new Response('{}', { status: 200 });
    });
    const put = (round: string) =>
      app.inject({
        method: 'PUT',
        url: `/api/v1/hackathons/${hackathonId}/ideation`,
        headers: auth(orgToken),
        payload: validConfig(round),
      });
    const [first, second] = await Promise.all([put('first'), put('second')]);
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(delivered[delivered.length - 1]).toBe('second');
    expect(memoryStore.hackathons.get(hackathonId)!.ideation!.extraInstructions).toBe('second');
  });
});
