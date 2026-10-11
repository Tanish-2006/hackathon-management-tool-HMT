import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface Evidence {
  title: string;
  url: string;
  meta: string;
  snippet: string;
}

export interface MarketResult {
  sources: Evidence[];
  verified: boolean;
}

const FETCH_TIMEOUT_MS = 8000;
const RESULT_LIMIT = 5;
const SNIPPET_CHARS = 320;

export class TtlCache<T> {
  private readonly entries = new Map<string, { value: T; expiresAt: number }>();

  constructor(
    private readonly ttlMs = 6 * 60 * 60 * 1000,
    private readonly maxEntries = 1000,
  ) {}

  static normalize(query: string): string {
    return query
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim()
      .replace(/\s+/g, ' ');
  }

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt > Date.now()) return entry.value;
    this.entries.delete(key);
    return undefined;
  }

  set(key: string, value: T): void {
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: Date.now() + this.ttlMs });
    while (this.entries.size > this.maxEntries)
      this.entries.delete(this.entries.keys().next().value!);
  }
}

abstract class EvidenceSource {
  protected readonly logger = new Logger(this.constructor.name);

  async search(query: string, signal?: AbortSignal): Promise<Evidence[]> {
    const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS);
    try {
      return (await this.fetchResults(query, signal ? AbortSignal.any([signal, timeout]) : timeout))
        .filter((item) => item.title && /^https?:\/\//.test(item.url))
        .slice(0, RESULT_LIMIT);
    } catch (error) {
      this.logger.warn(`${this.constructor.name} unavailable: ${(error as Error).message}`);
      return [];
    }
  }

  protected abstract fetchResults(query: string, signal: AbortSignal): Promise<Evidence[]>;

  protected async getJson(url: string, signal: AbortSignal, init: RequestInit = {}): Promise<any> {
    const response = await fetch(url, { ...init, signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  protected static snippet(text: string | null | undefined): string {
    const clean = (text ?? '').replace(/\s+/g, ' ').trim();
    return clean.length > SNIPPET_CHARS ? `${clean.slice(0, SNIPPET_CHARS)}…` : clean;
  }

  protected static meta(...parts: Array<string | number | null | undefined>): string {
    return parts
      .filter((part) => part !== null && part !== undefined && String(part).trim())
      .join(' · ');
  }
}

export class SemanticScholarSource extends EvidenceSource {
  constructor(private readonly apiKey = '') {
    super();
  }

  protected async fetchResults(query: string, signal: AbortSignal): Promise<Evidence[]> {
    const params = new URLSearchParams({
      query,
      limit: String(RESULT_LIMIT),
      fields: 'title,year,venue,url,abstract,externalIds',
    });
    const body = await this.getJson(
      `https://api.semanticscholar.org/graph/v1/paper/search?${params}`,
      signal,
      {
        headers: this.apiKey ? { 'x-api-key': this.apiKey } : {},
      },
    );
    return (body?.data ?? []).map((paper: any) => ({
      title: String(paper.title ?? '').trim(),
      url: paper.externalIds?.DOI
        ? `https://doi.org/${paper.externalIds.DOI}`
        : String(paper.url ?? ''),
      meta: EvidenceSource.meta(paper.year, paper.venue, 'Semantic Scholar'),
      snippet: EvidenceSource.snippet(paper.abstract),
    }));
  }
}

export class OpenAlexSource extends EvidenceSource {
  constructor(private readonly mailto = '') {
    super();
  }

  static abstractFrom(index: Record<string, number[]> | null | undefined): string {
    if (!index) return '';
    const words: string[] = [];
    for (const [word, positions] of Object.entries(index))
      for (const position of positions) words[position] = word;
    return words.filter(Boolean).join(' ');
  }

  protected async fetchResults(query: string, signal: AbortSignal): Promise<Evidence[]> {
    const params = new URLSearchParams({ search: query, 'per-page': String(RESULT_LIMIT) });
    if (this.mailto) params.set('mailto', this.mailto);
    const body = await this.getJson(`https://api.openalex.org/works?${params}`, signal);
    return (body?.results ?? []).map((work: any) => ({
      title: String(work.display_name ?? work.title ?? '').trim(),
      url: String(work.doi ?? work.primary_location?.landing_page_url ?? work.id ?? ''),
      meta: EvidenceSource.meta(
        work.publication_year,
        work.primary_location?.source?.display_name,
        'OpenAlex',
      ),
      snippet: EvidenceSource.snippet(OpenAlexSource.abstractFrom(work.abstract_inverted_index)),
    }));
  }
}

export class ArxivSource extends EvidenceSource {
  private static readonly entities: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
  };

  static parseAtom(xml: string): Evidence[] {
    const tag = (entry: string, name: string) =>
      ArxivSource.decode(
        entry.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`))?.[1] ?? '',
      );
    return xml
      .split(/<entry>/)
      .slice(1)
      .map((entry) => ({
        title: tag(entry, 'title').replace(/\s+/g, ' ').trim(),
        url: tag(entry, 'id')
          .trim()
          .replace(/^http:/, 'https:'),
        meta: EvidenceSource.meta(tag(entry, 'published').slice(0, 4), 'arXiv'),
        snippet: EvidenceSource.snippet(tag(entry, 'summary')),
      }));
  }

  private static decode(text: string): string {
    return text.replace(
      /&(amp|lt|gt|quot|apos);/g,
      (_, name: string) => ArxivSource.entities[name],
    );
  }

  protected async fetchResults(query: string, signal: AbortSignal): Promise<Evidence[]> {
    const terms = TtlCache.normalize(query)
      .split(' ')
      .filter((term) => term.length > 2)
      .slice(0, 4);
    if (!terms.length) return [];
    const searchQuery = terms.map((term) => `all:${term}`).join(' AND ');
    const response = await fetch(
      `https://export.arxiv.org/api/query?search_query=${encodeURIComponent(searchQuery)}&max_results=${RESULT_LIMIT}`,
      { signal },
    );
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return ArxivSource.parseAtom(await response.text());
  }
}

export class TavilySource extends EvidenceSource {
  constructor(private readonly apiKey: string) {
    super();
  }

  get configured(): boolean {
    return this.apiKey.length > 0;
  }

  protected async fetchResults(query: string, signal: AbortSignal): Promise<Evidence[]> {
    const body = await this.getJson('https://api.tavily.com/search', signal, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ query, max_results: RESULT_LIMIT, search_depth: 'basic' }),
    });
    return (body?.results ?? []).map((result: any) => ({
      title: String(result.title ?? '').trim(),
      url: String(result.url ?? ''),
      meta: TavilySource.host(String(result.url ?? '')),
      snippet: EvidenceSource.snippet(result.content),
    }));
  }

  private static host(url: string): string {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return '';
    }
  }
}

const STOPWORDS = new Set(['the', 'and', 'for', 'why', 'how', 'what', 'who', 'does', 'did', 'are', 'was', 'were', 'with', 'from', 'that', 'this', 'into', 'about', 'their', 'there', 'they', 'them', 'have', 'has', 'not', 'any', 'can', 'use', 'using', 'used', 'study', 'studies', 'research', 'evidence', 'paper', 'papers', 'systems', 'system']);

@Injectable()
export class ResearchScout {
  private readonly cache = new TtlCache<Evidence[]>();
  private readonly sources: EvidenceSource[];

  constructor(config: ConfigService) {
    this.sources = [
      new SemanticScholarSource((config.get<string>('SEMANTIC_SCHOLAR_API_KEY') ?? '').trim()),
      new OpenAlexSource((config.get<string>('OPENALEX_MAILTO') ?? '').trim()),
      new ArxivSource(),
    ];
  }

  async search(query: string, signal?: AbortSignal): Promise<Evidence[]> {
    const key = TtlCache.normalize(query);
    if (!key) return [];
    const cached = this.cache.get(key);
    if (cached) return cached;
    let papers = await this.searchAll(query, signal);
    const broader = ResearchScout.keywords(query);
    if (!papers.length && broader && broader !== key) papers = await this.searchAll(broader, signal);
    if (papers.length) this.cache.set(key, papers);
    return papers;
  }

  static keywords(query: string): string {
    const words = TtlCache.normalize(query)
      .split(' ')
      .filter((word) => word.length > 2 && !STOPWORDS.has(word));
    return [...new Set(words)].slice(0, 5).join(' ');
  }

  private async searchAll(query: string, signal?: AbortSignal): Promise<Evidence[]> {
    const batches = await Promise.all(this.sources.map((source) => source.search(query, signal)));
    return ResearchScout.merge(batches);
  }

  static merge(batches: Evidence[][]): Evidence[] {
    const seen = new Set<string>();
    const merged: Evidence[] = [];
    const depth = Math.max(0, ...batches.map((batch) => batch.length));
    for (let rank = 0; rank < depth && merged.length < RESULT_LIMIT; rank++) {
      for (const batch of batches) {
        const paper = batch[rank];
        if (!paper || merged.length >= RESULT_LIMIT) continue;
        const keys = [
          TtlCache.normalize(paper.title),
          paper.url.toLowerCase().replace(/^https?:\/\/(dx\.)?/, ''),
        ];
        if (keys.some((key) => seen.has(key))) continue;
        keys.forEach((key) => seen.add(key));
        merged.push(paper);
      }
    }
    return merged;
  }
}

@Injectable()
export class MarketGapAnalyst {
  private readonly cache = new TtlCache<Evidence[]>();
  private readonly tavily: TavilySource;
  private readonly perOwnerDaily: number;
  private readonly globalDaily: number;
  private readonly usage = new Map<string, number>();
  private day = '';

  constructor(config: ConfigService) {
    this.tavily = new TavilySource((config.get<string>('TAVILY_API_KEY') ?? '').trim());
    this.perOwnerDaily = Number(config.get('TAVILY_TEAM_DAILY_LIMIT')) || 20;
    this.globalDaily = Number(config.get('TAVILY_GLOBAL_DAILY_LIMIT')) || 900;
  }

  async search(query: string, owner: string, signal?: AbortSignal): Promise<MarketResult> {
    const key = TtlCache.normalize(query);
    if (!key) return { sources: [], verified: false };
    const cached = this.cache.get(key);
    if (cached) return { sources: cached, verified: true };
    if (!this.tavily.configured || !this.reserve(owner)) return { sources: [], verified: false };
    const sources = await this.tavily.search(query, signal);
    if (sources.length) this.cache.set(key, sources);
    return { sources, verified: sources.length > 0 };
  }

  private reserve(owner: string): boolean {
    const today = new Date().toISOString().slice(0, 10);
    if (today !== this.day) {
      this.day = today;
      this.usage.clear();
    }
    const global = this.usage.get('*') ?? 0;
    const mine = this.usage.get(owner) ?? 0;
    if (global >= this.globalDaily || mine >= this.perOwnerDaily) return false;
    this.usage.set('*', global + 1);
    this.usage.set(owner, mine + 1);
    return true;
  }
}
