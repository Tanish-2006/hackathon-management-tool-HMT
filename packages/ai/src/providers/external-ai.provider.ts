import { randomUUID } from 'node:crypto';
import type { AIProvider } from './ai-provider.interface';
import type { AiGenerateTextOptions, AiGenerateTextResult, AiAnalyzeOptions, AiAnalyzeResult, AiConfig } from '../ai.types';

/**
 * ExternalAIProvider — OpenAI-compatible (OpenAI, Anthropic via compat, self-hosted).
 * Uses global fetch with timeout, retry, requestId, secret redaction.
 * Never logs API key, never exposes to frontend, never includes in exceptions.
 */
export class ExternalAIProvider implements AIProvider {
  constructor(private readonly config: AiConfig) {}

  getProviderName(): 'external' {
    return 'external';
  }
  getModel(): string {
    return this.config.model || 'external-model';
  }

  async generateText(options: AiGenerateTextOptions): Promise<AiGenerateTextResult> {
    const start = Date.now();
    const requestId = options.requestId ?? randomUUID();
    if (!this.config.apiKey || this.config.apiKey.trim().length === 0) {
      throw Object.assign(new Error('AI_API_KEY is required for external provider (AI_PROVIDER=external)'), { statusCode: 500, code: 'AI_CONFIG_ERROR' });
    }
    if (!this.config.baseUrl) {
      throw Object.assign(new Error('AI_BASE_URL is required for external provider'), { statusCode: 500, code: 'AI_CONFIG_ERROR' });
    }
    const url = this.buildUrl();
    const body = JSON.stringify({
      model: this.config.model,
      messages: [
        ...(options.systemPrompt ? [{ role: 'system', content: options.systemPrompt }] : []),
        { role: 'user', content: options.prompt },
      ],
      max_tokens: options.maxTokens ?? 1024,
      temperature: options.temperature ?? 0.7,
    });

    const resultText = await this.fetchWithRetry(url, body, requestId);
    return {
      text: resultText,
      provider: 'external',
      model: this.getModel(),
      latencyMs: Date.now() - start,
      requestId,
      isMock: false,
      rawResponse: { url: this.redactedUrl(url) },
    };
  }

  async analyze(options: AiAnalyzeOptions): Promise<AiAnalyzeResult> {
    const base = await this.generateText(options);
    // For external, we expect model to return hints; we wrap as structured analysis
    // Do not return code blocks — instruct model to not generate code
    return {
      ...base,
      analysis: [
        {
          problem: 'External AI analysis (hints only)',
          evidence: `Provider ${this.getModel()} analyzed sanitized repository context (no code logged).`,
          hint: base.text.slice(0, 500),
        },
      ],
    };
  }

  private buildUrl(): string {
    // Support both full URL (https://api.openai.com/v1/chat/completions) or base (https://api.openai.com/v1)
    const base = this.config.baseUrl.replace(/\/$/, '');
    if (base.endsWith('/chat/completions')) return base;
    return `${base}/chat/completions`;
  }

  private redactedUrl(url: string): string {
    // Never log full URL with keys
    return url.replace(/api[_-]?key=[^&]+/gi, 'api_key=[REDACTED]');
  }

  private async fetchWithRetry(url: string, body: string, requestId: string): Promise<string> {
    let lastError: unknown;
    const retries = this.config.maxRetries;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.config.apiKey}`,
            'X-Request-Id': requestId,
            'X-Correlation-Id': requestId,
          },
          body,
          signal: controller.signal,
        });
        clearTimeout(timeout);
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          // Do not include API key in error
          throw Object.assign(new Error(`AI provider error: ${res.status} ${res.statusText} ${this.sanitizeError(text).slice(0, 500)}`), {
            statusCode: 502,
            code: 'AI_PROVIDER_ERROR',
            providerStatus: res.status,
          });
        }
        const json = (await res.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
          content?: string;
          text?: string;
        };
        const content = json.choices?.[0]?.message?.content ?? json.content ?? json.text ?? '';
        if (!content) throw Object.assign(new Error('AI provider returned empty content'), { statusCode: 502, code: 'AI_EMPTY_RESPONSE' });
        return content;
      } catch (e) {
        lastError = e;
        const isAbort = e instanceof Error && e.name === 'AbortError';
        if (isAbort) {
          throw Object.assign(new Error(`AI provider timeout after ${this.config.timeoutMs}ms`), { statusCode: 504, code: 'AI_TIMEOUT' });
        }
        // Retry only on 429, 5xx, or network errors, not on 4xx (except 429)
        const status = (e as { providerStatus?: number }).providerStatus;
        const retryable = status === 429 || (status !== undefined && status >= 500) || status === undefined;
        if (!retryable || attempt === retries) throw e;
        // exponential backoff
        await new Promise((r) => setTimeout(r, 200 * Math.pow(2, attempt)));
      }
    }
    throw lastError;
  }

  private sanitizeError(text: string): string {
    return text
      .replace(/sk-[a-zA-Z0-9_-]+/g, '[REDACTED]')
      .replace(/Bearer\s+[^\s]+/gi, 'Bearer [REDACTED]')
      .slice(0, 1000);
  }
}
