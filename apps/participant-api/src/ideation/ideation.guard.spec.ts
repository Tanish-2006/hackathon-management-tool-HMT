import { IdeationGuard } from './ideation.guard';

describe('IdeationGuard', () => {
  let guard: IdeationGuard;
  const tick = (ms: number) => jest.setSystemTime(Date.now() + ms);

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-11T10:00:00Z'));
    guard = new IdeationGuard();
  });

  afterEach(() => jest.useRealTimers());

  it('allows one send per 5 seconds per user and event with exact retryAfter', () => {
    expect(guard.check('u1', 'h1')).toBeNull();
    tick(1000);
    expect(guard.check('u1', 'h1')).toEqual({ retryAfter: 4, message: expect.stringMatching(/quickly/) });
    tick(3999);
    expect(guard.check('u1', 'h1')?.retryAfter).toBe(1);
    tick(1);
    expect(guard.check('u1', 'h1')).toBeNull();
    expect(guard.check('u2', 'h1')).toBeNull();
    expect(guard.check('u1', 'h2')).toBeNull();
  });

  it('has no longer-term caps', () => {
    for (let i = 0; i < 300; i++) {
      expect(guard.check('u1', 'h1')).toBeNull();
      tick(5000);
    }
  });
});
