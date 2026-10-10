import { defaultIdeationConfig } from '@hmt/contracts';
import { AI_HELPER_NOT_CONFIGURED, AsiOneClient } from './asi-one.client';
import { IdeationService, type BuildMessagesInput } from './ideation.service';

const service = new IdeationService({} as any, { configured: true } as any);

function input(overrides: Partial<BuildMessagesInput> = {}): BuildMessagesInput {
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
      currentRound: 2,
      extraInstructions: 'Mention the campus innovation cell.',
    },
    scope: 'team',
    team: {
      id: 't1',
      name: 'Rocket',
      members: [
        { id: 'u1', name: 'Asha' },
        { id: 'u2', name: 'Ben' },
      ],
    },
    participantName: 'Asha',
    history: [],
    userTurn: { content: 'Here is our user persona', authorName: 'Asha' },
    ...overrides,
  };
}

describe('IdeationService.buildMessages', () => {
  it('scopes the system prompt to the organizer-selected round', () => {
    const [system] = service.buildMessages(input());
    expect(system.role).toBe('system');
    expect(system.content).toContain('Current round: 2 of 5 — Users & Validation');
    expect(system.content).toContain(
      'Upcoming rounds (do not start these): 3. Solution & Differentiation; 4. Feasibility & Business Model; 5. Pitch & Final Refinement',
    );
    expect(system.content).toContain(
      'Rounds already completed (build on them, do not redo them): 1. Problem Discovery',
    );
    expect(system.content).toContain('Stay strictly inside round 2');
    expect(system.content).not.toContain('Goal: Pin down one specific');
    expect(system.content).toContain('Campus Ideathon');
    expect(system.content).toContain('Reduce food waste in hostels');
    expect(system.content).toContain('Sustainability');
    expect(system.content).toContain('Mention the campus innovation cell.');
    expect(system.content).toContain('members: Asha, Ben');
  });

  it('caps history at the last 30 messages', () => {
    const history = Array.from({ length: 45 }, (_, i) => ({
      role: (i % 2 ? 'assistant' : 'user') as 'user' | 'assistant',
      content: `m${i}`,
      authorName: i % 2 ? 'AI Helper' : 'Ben',
    }));
    const messages = service.buildMessages(input({ history }));
    expect(messages).toHaveLength(1 + 30 + 1);
    expect(messages[1]).toEqual({ role: 'assistant', content: 'm15' });
    expect(messages[2]).toEqual({ role: 'user', content: 'Ben: m16' });
    expect(messages[30].content).toBe('Ben: m44');
    expect(messages[31]).toEqual({ role: 'user', content: 'Asha: Here is our user persona' });
  });

  it('prefixes user turns with author names only in team threads', () => {
    const history = [
      { role: 'user' as const, content: 'Idea A', authorName: 'Ben' },
      { role: 'assistant' as const, content: 'Why A?', authorName: 'AI Helper' },
    ];
    const team = service.buildMessages(input({ history }));
    expect(team.slice(1).map((m) => m.content)).toEqual([
      'Ben: Idea A',
      'Why A?',
      'Asha: Here is our user persona',
    ]);
    const personal = service.buildMessages(input({ history, scope: 'personal' }));
    expect(personal.slice(1).map((m) => m.content)).toEqual([
      'Idea A',
      'Why A?',
      'Here is our user persona',
    ]);
    expect(personal[0].content).toContain('personal thread');
  });
});

describe('AsiOneClient.stream', () => {
  const config = (values: Record<string, string>) => ({ get: (key: string) => values[key] }) as any;
  const sse = (chunks: string[]) =>
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
        controller.close();
      },
    });

  afterEach(() => jest.restoreAllMocks());

  async function collect(client: AsiOneClient) {
    const out: string[] = [];
    for await (const delta of client.stream([{ role: 'user', content: 'hi' }])) out.push(delta);
    return out;
  }

  it('streams a not-configured notice without calling the provider', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch');
    expect(await collect(new AsiOneClient(config({})))).toEqual([AI_HELPER_NOT_CONFIGURED]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('parses split SSE deltas, ignores thought events, stops at [DONE] and retries one 429', async () => {
    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('busy', { status: 429 }))
      .mockResolvedValueOnce(
        new Response(
          sse([
            'data: {"thought":"thinking"}\n\ndata: {"choices":[{"delta":{"content":"Hel"}}]}\n',
            '\ndata: {"choices":[{"delta":{"con',
            'tent":"lo"}}]}\n\ndata: [DONE]\n\ndata: {"choices":[{"delta":{"content":"ignored"}}]}\n\n',
          ]),
          { status: 200 },
        ),
      );
    const client = new AsiOneClient(
      config({ AI_API_KEY: 'k', AI_BASE_URL: 'https://api.example/v1/' }),
    );
    expect(await collect(client)).toEqual(['Hel', 'lo']);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls[0][0]).toBe('https://api.example/v1/chat/completions');
  });
});
