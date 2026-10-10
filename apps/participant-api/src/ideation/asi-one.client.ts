import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { setTimeout as delay } from 'node:timers/promises';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export const AI_HELPER_NOT_CONFIGURED =
  "AI Helper isn't configured yet — ask the organizer to add the AI key. Your message has been saved, so you can keep writing down your thinking in the meantime.";

export class AiBusyError extends Error {}

class UpstreamError extends Error {
  constructor(readonly status: number) {
    super(`AI provider responded with ${status}`);
  }
}

@Injectable()
export class AsiOneClient {
  private readonly logger = new Logger(AsiOneClient.name);
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly maxConcurrency: number;
  private readonly maxQueue: number;
  private readonly queueTimeoutMs: number;
  private readonly waiters: Array<() => void> = [];
  private active = 0;

  constructor(config: ConfigService) {
    this.apiKey = (config.get<string>('AI_API_KEY') ?? '').trim();
    this.baseUrl = (config.get<string>('AI_BASE_URL') || 'https://api.asi1.ai/v1').replace(
      /\/+$/,
      '',
    );
    this.model = config.get<string>('AI_MODEL') || 'asi1';
    this.timeoutMs = Number(config.get('AI_TIMEOUT_MS')) || 90_000;
    this.maxConcurrency = Math.max(1, Number(config.get('AI_MAX_CONCURRENCY')) || 16);
    this.maxQueue = Math.max(0, Number(config.get('AI_MAX_QUEUE')) || 200);
    this.queueTimeoutMs = Math.max(1000, Number(config.get('AI_QUEUE_TIMEOUT_MS')) || 120_000);
  }

  get queueDepth(): number {
    return this.waiters.length;
  }

  get configured(): boolean {
    return this.apiKey.length > 0;
  }

  async *stream(messages: ChatMessage[], signal?: AbortSignal): AsyncGenerator<string> {
    if (!this.configured) {
      yield AI_HELPER_NOT_CONFIGURED;
      return;
    }
    await this.acquire(signal);
    try {
      const timeout = AbortSignal.timeout(this.timeoutMs);
      const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
      const response = await this.open(messages, combined);
      yield* this.readDeltas(response.body!);
    } finally {
      this.release();
    }
  }

  private async open(messages: ChatMessage[], signal: AbortSignal): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ model: this.model, messages, stream: true, temperature: 0.6 }),
        signal,
      });
      if (response.ok && response.body) return response;
      await response.body?.cancel().catch(() => undefined);
      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt > 0) {
        this.logger.warn(`ASI:One request failed with ${response.status}`);
        throw new UpstreamError(response.status);
      }
      await delay(1000, undefined, { signal });
    }
  }

  private async *readDeltas(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
    const decoder = new TextDecoder();
    let buffer = '';
    for await (const bytes of body) {
      buffer += decoder.decode(bytes, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const delta = this.parseLine(line);
        if (delta === null) return;
        if (delta) yield delta;
      }
    }
    const tail = this.parseLine(buffer);
    if (tail) yield tail;
  }

  private parseLine(line: string): string | null | undefined {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) return undefined;
    const payload = trimmed.slice(5).trim();
    if (payload === '[DONE]') return null;
    try {
      const content = JSON.parse(payload)?.choices?.[0]?.delta?.content;
      return typeof content === 'string' ? content : undefined;
    } catch {
      return undefined;
    }
  }

  private async acquire(signal?: AbortSignal): Promise<void> {
    if (this.active < this.maxConcurrency) {
      this.active++;
      return;
    }
    if (this.waiters.length >= this.maxQueue) throw new AiBusyError('AI Helper queue is full');
    await new Promise<void>((resolve, reject) => {
      const leave = (error: Error) => {
        const index = this.waiters.indexOf(enter);
        if (index >= 0) this.waiters.splice(index, 1);
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        reject(error);
      };
      const enter = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        resolve();
      };
      const onAbort = () => leave(new AiBusyError('Request cancelled while queued'));
      const timer = setTimeout(() => leave(new AiBusyError('AI Helper queue wait timed out')), this.queueTimeoutMs);
      signal?.addEventListener('abort', onAbort, { once: true });
      this.waiters.push(enter);
    });
  }

  private release(): void {
    const next = this.waiters.shift();
    if (next) next();
    else this.active--;
  }
}
