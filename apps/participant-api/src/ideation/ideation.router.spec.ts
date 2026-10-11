import { defaultIdeationConfig } from '@hmt/contracts';
import { IdeationRouter, type RouterVerdict } from './ideation.router';

const verdict = (overrides: Partial<RouterVerdict>): RouterVerdict => ({
  ...IdeationRouter.fallback(),
  ...overrides,
});

describe('IdeationRouter.parse', () => {
  it('parses a clean JSON verdict', () => {
    expect(
      IdeationRouter.parse(
        '{"verdict":"advance","specialist":"research","query":"  food waste   hostels ","offTopic":false,"reason":"Problem is clear"}',
        2,
      ),
    ).toEqual({
      verdict: 'advance',
      specialist: 'research',
      query: 'food waste hostels',
      offTopic: false,
      reason: 'Problem is clear',
    });
  });

  it('extracts JSON wrapped in code fences and prose', () => {
    const raw =
      'Sure! ```json\n{"verdict":"revisit","revisitTo":1,"specialist":"none","offTopic":false,"reason":"User changed"}\n```';
    expect(IdeationRouter.parse(raw, 3)).toEqual({
      verdict: 'revisit',
      revisitTo: 1,
      specialist: 'none',
      offTopic: false,
      reason: 'User changed',
    });
  });

  it.each(['', 'not json', '{"verdict":', '[1,2]', 'null', '{bad json}'])(
    'falls back to stay/none on %p',
    (raw) => {
      expect(IdeationRouter.parse(raw, 2)).toEqual(IdeationRouter.fallback());
    },
  );

  it('sanitises invalid fields individually', () => {
    expect(
      IdeationRouter.parse('{"verdict":"jump","specialist":"oracle","offTopic":"yes"}', 2),
    ).toEqual(IdeationRouter.fallback());
  });

  it('turns an invalid revisit target into stay', () => {
    expect(
      IdeationRouter.parse('{"verdict":"revisit","revisitTo":4,"specialist":"none"}', 3).verdict,
    ).toBe('stay');
    expect(IdeationRouter.parse('{"verdict":"revisit","specialist":"none"}', 3).verdict).toBe(
      'stay',
    );
    expect(
      IdeationRouter.parse('{"verdict":"revisit","revisitTo":0,"specialist":"none"}', 3).verdict,
    ).toBe('stay');
  });

  it('forces stay and no specialist when off-topic', () => {
    expect(
      IdeationRouter.parse(
        '{"verdict":"advance","specialist":"market","query":"x","offTopic":true,"reason":"homework"}',
        2,
      ),
    ).toEqual({
      verdict: 'stay',
      specialist: 'none',
      query: 'x',
      offTopic: true,
      reason: 'homework',
    });
  });

  it('falls back without calling the model when the client is unconfigured or fails', async () => {
    const input = { phase: 1, phases: defaultIdeationConfig().phases, history: [], content: 'hi' };
    const complete = jest.fn();
    expect(await new IdeationRouter({ configured: false, complete } as any).decide(input)).toEqual(
      IdeationRouter.fallback(),
    );
    expect(complete).not.toHaveBeenCalled();
    const failing = new IdeationRouter({
      configured: true,
      complete: jest.fn().mockRejectedValue(new Error('timeout')),
    } as any);
    expect(await failing.decide(input)).toEqual(IdeationRouter.fallback());
  });

  it('sends the phase exit check and the participant message to the model', async () => {
    const complete = jest
      .fn()
      .mockResolvedValue(
        '{"verdict":"stay","specialist":"users","offTopic":false,"reason":"vague"}',
      );
    const router = new IdeationRouter({ configured: true, complete } as any);
    const phases = defaultIdeationConfig().phases;
    const result = await router.decide({
      phase: 2,
      phases,
      history: [{ role: 'user', content: 'earlier' }],
      content: 'students waste food',
    });
    expect(result.specialist).toBe('users');
    const [system, user] = complete.mock.calls[0][0];
    expect(system.content).toContain(phases[1].exitCheck);
    expect(system.content).toContain('JSON');
    expect(user.content).toContain('students waste food');
    expect(user.content).toContain('Participant: earlier');
  });
});

describe('IdeationRouter.nextPhase', () => {
  it('advances exactly one step', () => {
    expect(IdeationRouter.nextPhase(2, verdict({ verdict: 'advance', reason: 'done' }))).toEqual({
      from: 2,
      to: 3,
      reason: 'done',
    });
  });

  it('clamps at phase 6', () => {
    expect(IdeationRouter.nextPhase(6, verdict({ verdict: 'advance' }))).toBeNull();
  });

  it('revisits only earlier phases', () => {
    expect(
      IdeationRouter.nextPhase(
        4,
        verdict({ verdict: 'revisit', revisitTo: 2, reason: 'user changed' }),
      ),
    ).toEqual({
      from: 4,
      to: 2,
      reason: 'user changed',
    });
    expect(IdeationRouter.nextPhase(2, verdict({ verdict: 'revisit', revisitTo: 3 }))).toBeNull();
    expect(IdeationRouter.nextPhase(2, verdict({ verdict: 'revisit', revisitTo: 2 }))).toBeNull();
  });

  it('stays put on stay', () => {
    expect(IdeationRouter.nextPhase(3, verdict({}))).toBeNull();
  });

  it('fills in a default reason', () => {
    expect(IdeationRouter.nextPhase(1, verdict({ verdict: 'advance' }))!.reason).toBe(
      'Exit check met',
    );
  });
});
