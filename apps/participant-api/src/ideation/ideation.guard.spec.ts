import { IdeationGuard } from './ideation.guard';

describe('IdeationGuard', () => {
  let guard: IdeationGuard;
  let n = 0;
  const send = (user = 'u1', thread = 't1', content?: string) =>
    guard.checkSend(user, 'h1', thread, content ?? `message ${n++}`);
  const tick = (ms: number) => jest.setSystemTime(Date.now() + ms);

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-11T10:00:00Z'));
    guard = new IdeationGuard();
  });

  afterEach(() => jest.useRealTimers());

  it('allows one send per 3 seconds per user with exact retryAfter', () => {
    expect(send()).toBeNull();
    tick(1000);
    expect(send()).toEqual({ retryAfter: 2, message: expect.stringMatching(/quickly/) });
    tick(1999);
    expect(send()?.retryAfter).toBe(1);
    tick(1);
    expect(send()).toBeNull();
    expect(send('u2')).toBeNull();
  });

  it('caps 20 sends per 10 minutes and frees the oldest slot first', () => {
    for (let i = 0; i < 20; i++) {
      expect(send()).toBeNull();
      tick(3000);
    }
    const rejection = send();
    expect(rejection?.message).toMatch(/break/);
    expect(rejection?.retryAfter).toBe(600 - 60);
    tick(rejection!.retryAfter * 1000);
    expect(send()).toBeNull();
  });

  it('caps 120 sends per day per user and hackathon', () => {
    for (let i = 0; i < 120; i++) {
      expect(send()).toBeNull();
      tick(31_000);
    }
    const rejection = send();
    expect(rejection?.message).toMatch(/today/);
    expect(rejection?.retryAfter).toBe(24 * 3600 - 120 * 31);
    expect(guard.checkSend('u1', 'h2', 't9', 'other event')).toBeNull();
  });

  it('caps 60 sends per thread per 10 minutes across users', () => {
    for (let i = 0; i < 60; i++) expect(send(`user${i}`)).toBeNull();
    const rejection = send('late');
    expect(rejection?.message).toMatch(/thread/);
    expect(rejection?.retryAfter).toBe(600);
    expect(send('late', 't2')).toBeNull();
  });

  it('rejects the same message within 60 seconds, ignoring case and spacing', () => {
    expect(send('u1', 't1', 'Our idea')).toBeNull();
    tick(10_000);
    expect(send('u1', 't1', '  our   IDEA ')).toEqual({
      retryAfter: 50,
      message: expect.stringMatching(/exact message/),
    });
    expect(send('u1', 't2', 'Our idea')).toBeNull();
    tick(50_000);
    expect(send('u1', 't1', 'our idea')).toBeNull();
  });

  it('starts a 5-minute cooldown after 3 off-topic strikes within 15 minutes', () => {
    expect(guard.strike('u1')).toBe(false);
    tick(60_000);
    expect(guard.strike('u1')).toBe(false);
    tick(60_000);
    expect(guard.strike('u1')).toBe(true);
    const rejection = send();
    expect(rejection).toEqual({ retryAfter: 300, message: expect.stringMatching(/off-topic/) });
    tick(299_000);
    expect(send()?.retryAfter).toBe(1);
    tick(1000);
    expect(send()).toBeNull();
  });

  it('forgets strikes older than 15 minutes', () => {
    guard.strike('u1');
    guard.strike('u1');
    tick(15 * 60_000 + 1);
    expect(guard.strike('u1')).toBe(false);
  });

  it('allows 6 deck reviews per hour per thread', () => {
    for (let i = 0; i < 6; i++) {
      expect(guard.checkDeck(`u${i}`, 'h1', 't1')).toBeNull();
      tick(60_000);
    }
    const rejection = guard.checkDeck('u9', 'h1', 't1');
    expect(rejection?.message).toMatch(/deck/);
    expect(rejection?.retryAfter).toBe(3600 - 360);
  });
});
