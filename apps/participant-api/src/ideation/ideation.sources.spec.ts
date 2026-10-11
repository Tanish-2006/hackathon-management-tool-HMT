import {
  ArxivSource,
  MarketGapAnalyst,
  OpenAlexSource,
  ResearchScout,
  SemanticScholarSource,
  TavilySource,
  TtlCache,
} from './ideation.sources';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const config = (values: Record<string, string> = {}) =>
  ({ get: (key: string) => values[key] }) as any;

const ATOM = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title type="html">ArXiv Query</title>
  <entry>
    <id>http://arxiv.org/abs/2101.00001v1</id>
    <published>2021-01-01T00:00:00Z</published>
    <title>Reducing Food
      Waste &amp; Hunger</title>
    <summary>  We study &lt;hostel&gt; kitchens.  </summary>
  </entry>
  <entry>
    <id>http://arxiv.org/abs/2202.00002v2</id>
    <published>2022-02-02T00:00:00Z</published>
    <title>Second Paper</title>
    <summary>Another abstract.</summary>
  </entry>
</feed>`;

describe('evidence sources', () => {
  afterEach(() => jest.restoreAllMocks());

  it('SemanticScholarSource maps papers and prefers DOI links', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      json({
        data: [
          {
            title: 'Paper A',
            year: 2020,
            venue: 'Nature',
            url: 'https://s2/a',
            abstract: 'Abstract A',
            externalIds: { DOI: '10.1/a' },
          },
          {
            title: 'Paper B',
            year: 2019,
            venue: '',
            url: 'https://s2/b',
            abstract: null,
            externalIds: {},
          },
        ],
      }),
    );
    const results = await new SemanticScholarSource().search('food waste');
    expect(String(fetchSpy.mock.calls[0][0])).toContain(
      'api.semanticscholar.org/graph/v1/paper/search?query=food+waste&limit=5',
    );
    expect(results).toEqual([
      {
        title: 'Paper A',
        url: 'https://doi.org/10.1/a',
        meta: '2020 · Nature · Semantic Scholar',
        snippet: 'Abstract A',
      },
      { title: 'Paper B', url: 'https://s2/b', meta: '2019 · Semantic Scholar', snippet: '' },
    ]);
  });

  it('OpenAlexSource reconstructs abstracts from the inverted index', async () => {
    expect(OpenAlexSource.abstractFrom({ waste: [1, 3], Food: [0], matters: [2] })).toBe(
      'Food waste matters waste',
    );
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      json({
        results: [
          {
            display_name: 'Work A',
            publication_year: 2023,
            doi: 'https://doi.org/10.2/w',
            primary_location: { source: { display_name: 'PLOS ONE' } },
            abstract_inverted_index: { Hello: [0], world: [1] },
          },
        ],
      }),
    );
    expect(await new OpenAlexSource('me@example.com').search('food')).toEqual([
      {
        title: 'Work A',
        url: 'https://doi.org/10.2/w',
        meta: '2023 · PLOS ONE · OpenAlex',
        snippet: 'Hello world',
      },
    ]);
  });

  it('ArxivSource parses Atom XML and decodes entities', async () => {
    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(ATOM, { status: 200 }));
    const results = await new ArxivSource().search('food waste in hostels');
    expect(decodeURIComponent(String(fetchSpy.mock.calls[0][0]))).toContain(
      'search_query=all:food AND all:waste AND all:hostels',
    );
    expect(results).toEqual([
      {
        title: 'Reducing Food Waste & Hunger',
        url: 'https://arxiv.org/abs/2101.00001v1',
        meta: '2021 · arXiv',
        snippet: 'We study <hostel> kitchens.',
      },
      {
        title: 'Second Paper',
        url: 'https://arxiv.org/abs/2202.00002v2',
        meta: '2022 · arXiv',
        snippet: 'Another abstract.',
      },
    ]);
  });

  it('TavilySource posts with a bearer key and maps results', async () => {
    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        json({
          results: [
            { title: 'Competitor', url: 'https://www.example.com/x', content: 'They do it' },
          ],
        }),
      );
    expect(await new TavilySource('key').search('food app')).toEqual([
      {
        title: 'Competitor',
        url: 'https://www.example.com/x',
        meta: 'example.com',
        snippet: 'They do it',
      },
    ]);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.tavily.com/search');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer key');
    expect(JSON.parse(String(init.body))).toEqual({
      query: 'food app',
      max_results: 5,
      search_depth: 'basic',
    });
  });

  it.each([
    ['HTTP error', () => Promise.resolve(new Response('nope', { status: 429 }))],
    ['network failure', () => Promise.reject(new Error('ECONNRESET'))],
    ['bad JSON', () => Promise.resolve(new Response('<html>', { status: 200 }))],
  ])('degrades to [] on %s', async (_label, impl) => {
    jest.spyOn(globalThis, 'fetch').mockImplementation(impl as any);
    expect(await new SemanticScholarSource().search('x')).toEqual([]);
    expect(await new TavilySource('k').search('x')).toEqual([]);
  });

  it('drops results without a usable URL', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(json({ results: [{ title: 'No link', url: 'javascript:alert(1)' }] }));
    expect(await new TavilySource('k').search('x')).toEqual([]);
  });
});

describe('TtlCache', () => {
  afterEach(() => jest.useRealTimers());

  it('normalizes queries and expires after the TTL', () => {
    jest.useFakeTimers();
    const cache = new TtlCache<number>(1000);
    expect(TtlCache.normalize('  Food-Waste, in  HOSTELS! ')).toBe('food waste in hostels');
    cache.set('a', 1);
    expect(cache.get('a')).toBe(1);
    jest.advanceTimersByTime(1001);
    expect(cache.get('a')).toBeUndefined();
  });

  it('evicts the oldest entry beyond capacity', () => {
    const cache = new TtlCache<number>(1000, 2);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('c')).toBe(3);
  });
});

describe('ResearchScout', () => {
  afterEach(() => jest.restoreAllMocks());

  const respond = () =>
    jest.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('semanticscholar'))
        return json({
          data: [
            {
              title: 'Shared Paper',
              year: 2020,
              venue: 'V',
              url: 'https://s2/shared',
              externalIds: { DOI: '10.9/shared' },
            },
            { title: 'S2 Only', year: 2021, url: 'https://s2/only', externalIds: {} },
          ],
        });
      if (url.includes('openalex'))
        return json({
          results: [
            {
              display_name: 'Shared paper!',
              doi: 'https://doi.org/10.9/shared',
              publication_year: 2020,
            },
            { display_name: 'OA One', doi: 'https://doi.org/10.9/oa1', publication_year: 2018 },
            { display_name: 'OA Two', doi: 'https://doi.org/10.9/oa2', publication_year: 2017 },
          ],
        });
      return new Response(ATOM, { status: 200 });
    });

  it('merges all three sources, dedupes and keeps the top 5', async () => {
    respond();
    const papers = await new ResearchScout(config()).search('food waste');
    expect(papers.map((p) => p.title)).toEqual([
      'Shared Paper',
      'Reducing Food Waste & Hunger',
      'S2 Only',
      'OA One',
      'Second Paper',
    ]);
  });

  it('serves repeated normalized queries from the cache', async () => {
    const fetchSpy = respond();
    const scout = new ResearchScout(config());
    const first = await scout.search('Food waste');
    const second = await scout.search('  food   WASTE ');
    expect(second).toBe(first);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it('returns [] and does not cache when every source fails', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('down'));
    const scout = new ResearchScout(config());
    expect(await scout.search('solar panel repair')).toEqual([]);
    expect(await scout.search('solar panel repair')).toEqual([]);
    expect(fetchSpy).toHaveBeenCalledTimes(6);
  });

  it('retries with a shorter keyword query when the full question finds nothing', async () => {
    const queries: string[] = [];
    jest.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      queries.push(url);
      const broad = !url.toLowerCase().includes('why');
      if (url.includes('openalex'))
        return json({ results: broad ? [{ display_name: 'Meal Opt-out Adoption', doi: 'https://doi.org/10.9/opt', publication_year: 2022 }] : [] });
      if (url.includes('semanticscholar')) return json({ data: [] });
      return new Response('<feed></feed>', { status: 200 });
    });
    const scout = new ResearchScout(config());
    const papers = await scout.search('Why do students abandon the meal opt-out systems in their hostels?');
    expect(ResearchScout.keywords('Why do students abandon the meal opt-out systems in their hostels?')).toBe('students abandon meal opt out');
    expect(papers.map((p) => p.title)).toEqual(['Meal Opt-out Adoption']);
    expect(queries).toHaveLength(6);
  });
});

describe('MarketGapAnalyst', () => {
  afterEach(() => jest.restoreAllMocks());

  const ok = () =>
    jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () =>
        json({ results: [{ title: 'Rival', url: 'https://rival.io', content: 'c' }] }),
      );

  it('falls back to unverified without a key and never calls Tavily', async () => {
    const fetchSpy = ok();
    expect(await new MarketGapAnalyst(config()).search('rivals', 'team:1')).toEqual({
      sources: [],
      verified: false,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('enforces the per-team daily cap, keeps cache hits free and resets the next day', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    jest.setSystemTime(new Date('2026-10-11T08:00:00Z'));
    const fetchSpy = ok();
    const analyst = new MarketGapAnalyst(
      config({ TAVILY_API_KEY: 'k', TAVILY_TEAM_DAILY_LIMIT: '2' }),
    );
    expect((await analyst.search('q1', 'team:1')).verified).toBe(true);
    expect((await analyst.search('q2', 'team:1')).verified).toBe(true);
    expect(await analyst.search('q3', 'team:1')).toEqual({ sources: [], verified: false });
    expect((await analyst.search('Q1', 'team:1')).verified).toBe(true);
    expect((await analyst.search('q3', 'team:2')).verified).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    jest.setSystemTime(new Date('2026-10-12T00:00:01Z'));
    expect((await analyst.search('q4', 'team:1')).verified).toBe(true);
    jest.useRealTimers();
  });

  it('enforces the global daily cap across teams', async () => {
    const fetchSpy = ok();
    const analyst = new MarketGapAnalyst(
      config({ TAVILY_API_KEY: 'k', TAVILY_GLOBAL_DAILY_LIMIT: '2' }),
    );
    await analyst.search('a', 'team:1');
    await analyst.search('b', 'team:2');
    expect(await analyst.search('c', 'team:3')).toEqual({ sources: [], verified: false });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('marks a failed search as unverified', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('x', { status: 500 }));
    expect(
      await new MarketGapAnalyst(config({ TAVILY_API_KEY: 'k' })).search('a', 'team:1'),
    ).toEqual({ sources: [], verified: false });
  });
});
