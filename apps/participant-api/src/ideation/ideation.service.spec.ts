import { BadRequestException, ConflictException } from '@nestjs/common';
import { defaultIdeationConfig } from '@hmt/contracts';
import { PrismaService } from '../database/prisma.service';
import { AiBusyError } from './asi-one.client';
import { IdeationGuard } from './ideation.guard';
import { CoachPrompt, type CoachInput } from './ideation.prompt';
import { IdeationRouter } from './ideation.router';
import { IdeationService, type IdeationContext } from './ideation.service';

const team = {
  id: 't1',
  name: 'Rocket',
  members: [
    { id: 'u1', name: 'Asha' },
    { id: 'u2', name: 'Ben' },
  ],
};

function input(overrides: Partial<CoachInput> = {}): CoachInput {
  return {
    hackathon: {
      id: 'h1',
      title: 'Campus Ideathon',
      description: 'Ideas for campus life',
      themes: ['Sustainability'],
      problemStatement: 'Reduce food waste in hostels',
    },
    config: {
      ...defaultIdeationConfig(),
      extraInstructions: 'Mention the campus innovation cell.',
    },
    scope: 'team',
    team,
    participantName: 'Asha',
    phase: 2,
    move: null,
    history: [],
    brief: null,
    offTopic: false,
    turn: { content: 'Here is our user persona', authorName: 'Asha' },
    deckReview: false,
    ...overrides,
  };
}

const userMsg = (content: string, phase: number, authorName = 'Ben') => ({
  kind: 'user',
  role: 'user',
  content,
  authorName,
  phase,
});

describe('CoachPrompt', () => {
  it('encodes the honesty and coaching rules', () => {
    const system = CoachPrompt.system(input());
    expect(system).toMatch(/honest and unbiased/i);
    expect(system).toMatch(/no flattery/i);
    expect(system).toMatch(/at most 3 questions/i);
    expect(system).toContain(
      'Never write the idea, the solution, the pitch, the script or the slides',
    );
    expect(system).toContain('Never invent sources');
    expect(system).toContain('Mention the campus innovation cell.');
    expect(system).toContain('Reduce food waste in hostels');
  });

  it('scopes to the current phase goal, questions and exit check', () => {
    const phases = defaultIdeationConfig().phases;
    const system = CoachPrompt.system(input());
    expect(system).toContain('Current phase: 2 of 6 — Users');
    expect(system).toContain(phases[1].goal);
    expect(system).toContain(phases[1].questions[0]);
    expect(system).toContain(phases[1].exitCheck);
    expect(system).not.toContain(phases[0].goal);
  });

  it('summarises earlier phases from the participants’ own words', () => {
    const system = CoachPrompt.system(
      input({
        phase: 3,
        history: [
          userMsg('Hostel food is thrown away nightly', 1),
          userMsg('Mess managers, we talked to 4', 2, 'Asha'),
          userMsg('current', 3),
        ],
      }),
    );
    expect(system).toContain('Phase 1 (Problem):');
    expect(system).toContain('Ben: Hostel food is thrown away nightly');
    expect(system).toContain('Asha: Mess managers, we talked to 4');
    expect(system).not.toContain('Ben: current');
  });

  it('lists evidence with [n] citations or says no sources were found', () => {
    const sources = [
      { title: 'Paper A', url: 'https://doi.org/a', meta: '2020 · Nature', snippet: 'Abstract' },
    ];
    const withSources = CoachPrompt.system(
      input({ brief: { specialist: 'research', sources, verified: true } }),
    );
    expect(withSources).toContain('[1] Paper A (2020 · Nature) https://doi.org/a');
    expect(withSources).toContain('cite as [n]');
    expect(
      CoachPrompt.system(input({ brief: { specialist: 'research', sources: [], verified: true } })),
    ).toContain('no sources found');
    expect(
      CoachPrompt.system(input({ brief: { specialist: 'market', sources: [], verified: false } })),
    ).toMatch(/label them clearly as unverified/);
    expect(
      CoachPrompt.system(input({ brief: { specialist: 'devil', sources: [], verified: true } })),
    ).toContain("Devil's Advocate");
    expect(
      CoachPrompt.system(input({ brief: { specialist: 'users', sources: [], verified: true } })),
    ).toContain('User Voice');
  });

  it('adds phase move, off-topic and deck instructions', () => {
    expect(
      CoachPrompt.system(input({ phase: 3, move: { from: 2, to: 3, reason: 'Users are clear' } })),
    ).toContain('just completed phase 2');
    expect(
      CoachPrompt.system(input({ phase: 1, move: { from: 3, to: 1, reason: 'Problem changed' } })),
    ).toContain('back to phase 1 (Problem) because: Problem changed');
    expect(CoachPrompt.system(input({ offTopic: true }))).toContain('short, polite redirect');
    expect(CoachPrompt.system(input({ phase: 6, deckReview: true }))).toContain('slide by slide');
  });

  it('caps history at 30 chat messages and prefixes authors only in team threads', () => {
    const history = Array.from({ length: 45 }, (_, i) =>
      i % 2
        ? {
            kind: 'assistant',
            role: 'assistant',
            content: `m${i}`,
            authorName: 'AI Coach',
            phase: 1,
          }
        : userMsg(`m${i}`, 1),
    );
    const messages = CoachPrompt.build(
      input({
        history: [
          ...history,
          { kind: 'card', role: 'system', content: 'card', authorName: null, phase: 1 },
        ],
      }),
    );
    expect(messages).toHaveLength(1 + 30 + 1);
    expect(messages[1]).toEqual({ role: 'assistant', content: 'm15' });
    expect(messages[2]).toEqual({ role: 'user', content: 'Ben: m16' });
    expect(messages[31]).toEqual({ role: 'user', content: 'Asha: Here is our user persona' });
    const personal = CoachPrompt.build(
      input({ scope: 'personal', history: [userMsg('Idea A', 1)] }),
    );
    expect(personal.slice(1).map((m) => m.content)).toEqual(['Idea A', 'Here is our user persona']);
    expect(personal[0].content).toContain('personal thread');
  });
});

describe('IdeationService', () => {
  let prisma: PrismaService;
  let guard: IdeationGuard;
  let routerDecide: jest.Mock;
  let scoutSearch: jest.Mock;
  let marketSearch: jest.Mock;
  let streamed: string[][];
  let service: IdeationService;
  let events: Array<[string, any]>;
  const emit = (event: string, data: unknown) => events.push([event, data]);
  const context: IdeationContext = {
    userId: 'u1',
    userName: 'Asha',
    hackathon: { id: 'h1', title: 'Campus Ideathon' },
    config: defaultIdeationConfig(),
    team,
  };
  const verdict = (overrides: object) => ({ ...IdeationRouter.fallback(), ...overrides });
  const flow = () => events.map(([event, data]) => (event === 'stage' ? data.name : event));
  const thread = (scope: 'team' | 'personal' = 'team') =>
    (service as any).loadThread(service.threadId(context, scope));
  const startAt = (phase: number) =>
    prisma.aiConversation.create({
      data: { id: service.threadId(context, 'team'), phase, phaseHistory: [] },
    });

  beforeEach(() => {
    prisma = new PrismaService();
    guard = new IdeationGuard();
    routerDecide = jest.fn().mockResolvedValue(IdeationRouter.fallback());
    scoutSearch = jest
      .fn()
      .mockResolvedValue([
        { title: 'Paper', url: 'https://doi.org/p', meta: '2020', snippet: 's' },
      ]);
    marketSearch = jest.fn().mockResolvedValue({ sources: [], verified: false });
    streamed = [];
    const asi = {
      configured: true,
      async *stream(messages: any[]) {
        streamed.push(messages.map((m) => m.content));
        yield 'Who ';
        yield 'exactly?';
      },
    };
    service = new IdeationService(
      prisma,
      asi as any,
      { decide: routerDecide } as any,
      { search: scoutSearch } as any,
      { search: marketSearch } as any,
      guard,
    );
    events = [];
  });

  it('stores user and assistant messages with kinds and streams stage/delta events', async () => {
    const result = await service.send(context, 'team', 'Students waste food', emit);
    expect(flow()).toEqual(['routing', 'writing', 'delta', 'delta']);
    const view = await thread();
    expect(view.phase).toBe(1);
    expect(view.phaseHistory).toEqual([{ phase: 1, at: expect.any(Date), reason: 'Started' }]);
    expect(view.messages.map((m: any) => [m.kind, m.role, m.content, m.phase])).toEqual([
      ['user', 'user', 'Students waste food', 1],
      ['assistant', 'assistant', 'Who exactly?', 1],
    ]);
    expect(view.messages[0]).toMatchObject({ authorId: 'u1', authorName: 'Asha' });
    expect(result).toEqual({
      userMessageId: view.messages[0].id,
      assistantMessageId: view.messages[1].id,
      phase: 1,
    });
  });

  it('runs the research specialist, stores a card and cites it to the master', async () => {
    routerDecide.mockResolvedValue(verdict({ specialist: 'research', query: 'hostel food waste' }));
    await service.send(context, 'team', 'Is this studied?', emit);
    expect(scoutSearch).toHaveBeenCalledWith('hostel food waste', undefined);
    expect(flow()).toEqual(['routing', 'research', 'card', 'writing', 'delta', 'delta']);
    expect(events[2][1]).toEqual({
      id: expect.any(String),
      specialist: 'research',
      title: 'Research Scout',
      sources: [{ title: 'Paper', url: 'https://doi.org/p', meta: '2020' }],
    });
    expect(streamed[0][0]).toContain('[1] Paper (2020) https://doi.org/p');
    expect((await thread()).messages.map((m: any) => m.kind)).toEqual([
      'user',
      'card',
      'assistant',
    ]);
  });

  it('labels an unavailable market search as unverified and keys caps by team', async () => {
    routerDecide.mockResolvedValue(verdict({ specialist: 'market' }));
    await service.send(context, 'team', 'Who are our competitors?', emit);
    expect(marketSearch).toHaveBeenCalledWith('Who are our competitors?', 'team:t1', undefined);
    expect(events.find(([e]) => e === 'card')![1].title).toMatch(/unverified/);
    expect(streamed[0][0]).toMatch(/label them clearly as unverified/);
    await service.send(context, 'personal', 'Competitors again?', emit);
    expect(marketSearch).toHaveBeenLastCalledWith('Competitors again?', 'user:u1', undefined);
  });

  it('advances one phase, records history and tells the master', async () => {
    routerDecide.mockResolvedValue(verdict({ verdict: 'advance', reason: 'Problem is sharp' }));
    const result = await service.send(context, 'team', 'Our problem is X', emit);
    expect(result.phase).toBe(2);
    expect(flow()).toEqual(['routing', 'phase', 'writing', 'delta', 'delta']);
    expect(events.find(([e]) => e === 'phase')![1]).toEqual({
      from: 1,
      to: 2,
      reason: 'Problem is sharp',
    });
    const view = await thread();
    expect(view.phase).toBe(2);
    expect(view.phaseHistory.map((h: any) => [h.phase, h.reason])).toEqual([
      [1, 'Started'],
      [2, 'Problem is sharp'],
    ]);
    expect(view.messages.map((m: any) => [m.kind, m.phase])).toEqual([
      ['user', 1],
      ['phase', 2],
      ['assistant', 2],
    ]);
    expect(view.messages[1].phaseChange).toEqual({ from: 1, to: 2, reason: 'Problem is sharp' });
    expect(streamed[0][0]).toContain('Current phase: 2 of 6');
    expect((await thread('personal')).phase).toBe(1);
  });

  it('revisits an earlier phase and clamps advance at phase 6', async () => {
    await startAt(4);
    routerDecide.mockResolvedValue(
      verdict({ verdict: 'revisit', revisitTo: 2, reason: 'New user group' }),
    );
    expect(
      (await service.send(context, 'team', 'Actually our users are teachers', emit)).phase,
    ).toBe(2);
    expect(events.find(([e]) => e === 'phase')![1]).toEqual({
      from: 4,
      to: 2,
      reason: 'New user group',
    });
    await prisma.aiConversation.update({
      where: { id: service.threadId(context, 'team') },
      data: { phase: 6 },
    });
    routerDecide.mockResolvedValue(verdict({ verdict: 'advance' }));
    events = [];
    expect((await service.send(context, 'team', 'Done?', emit)).phase).toBe(6);
    expect(events.some(([e]) => e === 'phase')).toBe(false);
  });

  it('counts off-topic strikes toward the cooldown', async () => {
    routerDecide.mockResolvedValue(verdict({ offTopic: true }));
    for (const text of ['a', 'b', 'c']) await service.send(context, 'personal', text, emit);
    expect(guard.checkSend('u1', 'h1', 'any', 'new')?.message).toMatch(/off-topic/);
    expect(streamed[0][0]).toContain('short, polite redirect');
  });

  it('keeps the user message when the model fails', async () => {
    (service as any).asi = {
      configured: true,
      stream: () => ({
        [Symbol.asyncIterator]: () => ({
          next: () => Promise.reject(new AiBusyError('queue full')),
        }),
      }),
    };
    await expect(service.send(context, 'team', 'hello', emit)).rejects.toBeInstanceOf(AiBusyError);
    expect((await thread()).messages.map((m: any) => m.kind)).toEqual(['user']);
  });

  it('validates decks: size limits and phase 6 only', async () => {
    const slide = (index: number, text = 'x') => ({ index, title: `S${index}`, text });
    await expect(service.assertDeckAllowed(context, 'team', [slide(1)])).rejects.toBeInstanceOf(
      ConflictException,
    );
    await startAt(6);
    await expect(service.assertDeckAllowed(context, 'team', [slide(1)])).resolves.toBeUndefined();
    await expect(
      service.assertDeckAllowed(
        context,
        'team',
        Array.from({ length: 61 }, (_, i) => slide(i + 1)),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.assertDeckAllowed(context, 'team', [slide(1, 'y'.repeat(24_000))]),
    ).rejects.toThrow(/too long/);
    await expect(service.assertDeckAllowed(context, 'personal', [slide(1)])).rejects.toThrow(
      /phase 6/,
    );
  });

  it('reviews a deck slide by slide and stores a deck message', async () => {
    await startAt(6);
    const result = await service.reviewDeck(
      context,
      'team',
      'pitch.pptx',
      [
        { index: 2, title: 'Problem', text: 'Food waste' },
        { index: 1, title: '', text: '' },
      ],
      emit,
    );
    expect(flow()).toEqual(['reading', 'writing', 'delta', 'delta']);
    const view = await thread();
    expect(view.messages[0]).toMatchObject({
      kind: 'deck',
      role: 'user',
      deck: { fileName: 'pitch.pptx', slideCount: 2 },
    });
    expect(view.messages[0].content).toBe('Slide 1:\n(no text)\n\nSlide 2:\nProblem\nFood waste');
    expect(result).toEqual({
      userMessageId: view.messages[0].id,
      assistantMessageId: view.messages[1].id,
      phase: 6,
    });
    expect(streamed[0][0]).toContain('slide by slide');
    expect(routerDecide).not.toHaveBeenCalled();
  });

  it('reads legacy v1 messages without kind or phase', async () => {
    await prisma.aiMessage.create({
      data: {
        conversationId: service.threadId(context, 'team'),
        role: 'assistant',
        content: 'old',
        round: 3,
      },
    });
    expect((await thread()).messages[0]).toMatchObject({
      kind: 'assistant',
      role: 'assistant',
      phase: 3,
    });
  });
});
