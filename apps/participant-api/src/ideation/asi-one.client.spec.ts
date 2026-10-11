import { AI_HELPER_NOT_CONFIGURED, AiBusyError, AsiOneClient } from './asi-one.client';

describe('AsiOneClient', () => {
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

  it('caps the wait queue and times out queued requests instead of waiting forever', async () => {
    let releaseFirst: () => void = () => undefined;
    jest.spyOn(globalThis, 'fetch').mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          releaseFirst = () =>
            resolve(
              new Response(
                sse(['data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n']),
                { status: 200 },
              ),
            );
        }),
    );
    const client = new AsiOneClient(
      config({
        AI_API_KEY: 'k',
        AI_MAX_CONCURRENCY: '1',
        AI_MAX_QUEUE: '1',
        AI_QUEUE_TIMEOUT_MS: '1000',
      }),
    );
    const first = collect(client);
    await new Promise((r) => setImmediate(r));
    const queued = collect(client);
    await new Promise((r) => setImmediate(r));
    expect(client.queueDepth).toBe(1);
    await expect(collect(client)).rejects.toBeInstanceOf(AiBusyError);
    await expect(queued).rejects.toThrow('timed out');
    expect(client.queueDepth).toBe(0);
    releaseFirst();
    expect(await first).toEqual(['ok']);
  });

  it('completes non-streaming requests through the same queue', async () => {
    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(
          JSON.stringify({ choices: [{ message: { content: '{"verdict":"stay"}' } }] }),
          { status: 200 },
        ),
      );
    const client = new AsiOneClient(config({ AI_API_KEY: 'k' }));
    expect(await client.complete([{ role: 'user', content: 'route' }])).toBe('{"verdict":"stay"}');
    expect(JSON.parse(String((fetchSpy.mock.calls[0][1] as RequestInit).body))).toMatchObject({
      stream: false,
      temperature: 0,
    });
    expect(client.queueDepth).toBe(0);
    expect(await new AsiOneClient(config({})).complete([])).toBe('');
  });
});
