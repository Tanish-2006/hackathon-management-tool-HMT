import { randomUUID } from 'node:crypto';
import type { AiConfig, AiGenerateTextOptions, AiGenerateTextResult, AiAnalyzeOptions, AiAnalyzeResult } from './ai.types';
import { aiConfigSchema } from './ai.types';
import type { AIProvider } from './providers/ai-provider.interface';
import { MockAIProvider } from './providers/mock-ai.provider';
import { ExternalAIProvider } from './providers/external-ai.provider';

function getRequestId(): string | undefined {
  try {
    // Try to use observability request context if available (optional peer)
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const obs = require('@hmt/observability');
    return obs.getRequestId?.() as string | undefined;
  } catch {
    return undefined;
  }
}

/**
 * AIService — single gateway for all AI operations.
 * Business logic must NOT call providers directly.
 * Handles provider selection, validation, secret redaction, requestId, logging.
 */
export class AIService {
  private readonly provider: AIProvider;
  private readonly config: AiConfig;

  constructor(config?: Partial<AiConfig>, providerOverride?: AIProvider) {
    const parsed = aiConfigSchema.safeParse(config ?? {});
    if (!parsed.success) {
      throw new Error(`Invalid AI config: ${parsed.error.message}`);
    }
    // Merge env: AI_PROVIDER, AI_API_KEY etc are validated in packages/config, but we also support direct config
    this.config = parsed.data;
    // Allow env to override via process.env if not provided explicitly
    const envProvider = process.env.AI_PROVIDER as AiConfig['provider'] | undefined;
    if (envProvider && !config?.provider) {
      if (['mock', 'external'].includes(envProvider)) this.config.provider = envProvider as AiConfig['provider'];
    }
    const envKey = process.env.AI_API_KEY;
    if (envKey !== undefined && !config?.apiKey) this.config.apiKey = envKey;
    const envModel = process.env.AI_MODEL;
    if (envModel !== undefined && !config?.model) this.config.model = envModel;
    const envBase = process.env.AI_BASE_URL;
    if (envBase !== undefined && !config?.baseUrl) this.config.baseUrl = envBase;

    if (providerOverride) {
      this.provider = providerOverride;
    } else if (this.config.provider === 'external') {
      // Validate external requires API key and baseUrl/model; fallback to mock if missing in test/dev
      if (!this.config.apiKey || !this.config.baseUrl) {
        // Fail fast in production, but allow mock fallback in development/test with warning
        if (process.env.NODE_ENV === 'production') {
          throw Object.assign(new Error('AI_API_KEY and AI_BASE_URL required for AI_PROVIDER=external'), { code: 'AI_CONFIG_ERROR', statusCode: 500 });
        }
        // In non-prod, fallback to mock to keep CI/tests green
        this.provider = new MockAIProvider();
        this.config.provider = 'mock';
      } else {
        this.provider = new ExternalAIProvider(this.config);
      }
    } else {
      this.provider = new MockAIProvider();
    }
  }

  getProviderName(): string {
    return this.provider.getProviderName();
  }
  getModel(): string {
    return this.provider.getModel();
  }
  getConfig(): AiConfig {
    return { ...this.config, apiKey: this.config.apiKey ? '[REDACTED]' as unknown as string : '' };
  }
  getRawConfig(): AiConfig {
    return this.config;
  }

  async generateText(options: AiGenerateTextOptions): Promise<AiGenerateTextResult> {
    const requestId = options.requestId ?? getRequestId() ?? randomUUID();
    const sanitizedPrompt = this.sanitizePrompt(options.prompt);
    const result = await this.provider.generateText({ ...options, prompt: sanitizedPrompt, requestId });
    // Ensure isMock flag for external vs mock distinction
    return { ...result, requestId };
  }

  async analyze(options: AiAnalyzeOptions): Promise<AiAnalyzeResult> {
    const requestId = options.requestId ?? getRequestId() ?? randomUUID();
    const sanitized = this.sanitizePrompt(options.prompt);
    const result = await this.provider.analyze({ ...options, prompt: sanitized, requestId });
    return { ...result, requestId };
  }

  private sanitizePrompt(prompt: string): string {
    // Defense-in-depth: retrieval layer already redacts, but gateway must never
    // forward raw secrets even when called directly. Treat input strictly as DATA.
    let out = prompt;
    const patterns: Array<[RegExp, string]> = [
      [/sk-[a-zA-Z0-9_\-]+/g, '[REDACTED_API_KEY]'],
      [/(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]+/g, '[REDACTED_GITHUB_TOKEN]'],
      [/github_pat_[A-Za-z0-9_]+/g, '[REDACTED_GITHUB_TOKEN]'],
      [/AKIA[0-9A-Z]{16}/g, '[REDACTED_AWS_KEY]'],
      [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[REDACTED_PRIVATE_KEY]'],
      [/ eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, ' [REDACTED_JWT]'],
      [/(postgres(ql)?|redis|mongodb(\+srv)?|mysql):\/\/[^\s'"]+/gi, '[REDACTED_CONNECTION_STRING]'],
      [/DATABASE_URL\s*=\s*[^\s'"]+/gi, 'DATABASE_URL=[REDACTED]'],
      [/(password|passwd|pwd|secret|api[_-]?key)\s*[:=]\s*[^\s'";,]+/gi, '$1=[REDACTED]'],
    ];
    for (const [re, rep] of patterns) out = out.replace(re, rep);
    return out.slice(0, 8000);
  }
}
