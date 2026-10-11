import { Injectable } from '@nestjs/common';

export interface GuardRejection {
  retryAfter: number;
  message: string;
}

interface WindowRule {
  limit: number;
  windowMs: number;
  message: string;
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const USER_RULES: WindowRule[] = [
  {
    limit: 1,
    windowMs: 3 * SECOND,
    message: 'You are sending messages very quickly. Take a breath and try again in a moment.',
  },
  {
    limit: 20,
    windowMs: 10 * MINUTE,
    message:
      'You have sent a lot of messages in the last few minutes. Take a short break to think, then continue.',
  },
  {
    limit: 120,
    windowMs: DAY,
    message: 'You have reached today’s message limit for this event. You can continue tomorrow.',
  },
];
const THREAD_RULE: WindowRule = {
  limit: 60,
  windowMs: 10 * MINUTE,
  message: 'This thread is very busy right now. Give the coach a few minutes, then continue.',
};
const DECK_RULE: WindowRule = {
  limit: 6,
  windowMs: HOUR,
  message:
    'This thread has had several deck reviews in the last hour. Revise your slides, then upload again later.',
};
const DUPLICATE_WINDOW_MS = MINUTE;
const STRIKE_LIMIT = 3;
const STRIKE_WINDOW_MS = 15 * MINUTE;
const COOLDOWN_MS = 5 * MINUTE;
const SWEEP_EVERY = 500;

@Injectable()
export class IdeationGuard {
  private readonly hits = new Map<string, number[]>();
  private readonly recentContent = new Map<string, number>();
  private readonly cooldowns = new Map<string, number>();
  private operations = 0;

  checkSend(
    userId: string,
    hackathonId: string,
    threadId: string,
    content: string,
  ): GuardRejection | null {
    const now = Date.now();
    this.sweep(now);
    const userKey = `user:${hackathonId}:${userId}`;
    const threadKey = `thread:${threadId}`;
    const duplicateKey = `${threadId}:${userId}:${content.trim().replace(/\s+/g, ' ').toLowerCase()}`;
    const rejection =
      this.cooldown(userId, now) ??
      this.firstViolation(userKey, USER_RULES, now) ??
      this.firstViolation(threadKey, [THREAD_RULE], now) ??
      this.duplicate(duplicateKey, now);
    if (rejection) return rejection;
    this.record(userKey, now, DAY);
    this.record(threadKey, now, THREAD_RULE.windowMs);
    this.recentContent.set(duplicateKey, now);
    return null;
  }

  checkDeck(userId: string, hackathonId: string, threadId: string): GuardRejection | null {
    const now = Date.now();
    this.sweep(now);
    const userKey = `user:${hackathonId}:${userId}`;
    const deckKey = `deck:${threadId}`;
    const rejection =
      this.cooldown(userId, now) ??
      this.firstViolation(userKey, USER_RULES, now) ??
      this.firstViolation(deckKey, [DECK_RULE], now);
    if (rejection) return rejection;
    this.record(userKey, now, DAY);
    this.record(deckKey, now, DECK_RULE.windowMs);
    return null;
  }

  strike(userId: string): boolean {
    const now = Date.now();
    const key = `strike:${userId}`;
    this.record(key, now, STRIKE_WINDOW_MS);
    if ((this.hits.get(key)?.length ?? 0) < STRIKE_LIMIT) return false;
    this.hits.delete(key);
    this.cooldowns.set(userId, now + COOLDOWN_MS);
    return true;
  }

  private cooldown(userId: string, now: number): GuardRejection | null {
    const until = this.cooldowns.get(userId);
    if (!until) return null;
    if (until <= now) {
      this.cooldowns.delete(userId);
      return null;
    }
    return {
      retryAfter: Math.ceil((until - now) / SECOND),
      message:
        'Several recent messages were off-topic, so the coach is paused for a few minutes. Come back with a question about your idea.',
    };
  }

  private firstViolation(key: string, rules: WindowRule[], now: number): GuardRejection | null {
    const stamps = this.hits.get(key) ?? [];
    for (const rule of rules) {
      const inWindow = stamps.filter((stamp) => stamp > now - rule.windowMs);
      if (inWindow.length < rule.limit) continue;
      const freesAt = inWindow[inWindow.length - rule.limit] + rule.windowMs;
      return {
        retryAfter: Math.max(1, Math.ceil((freesAt - now) / SECOND)),
        message: rule.message,
      };
    }
    return null;
  }

  private duplicate(key: string, now: number): GuardRejection | null {
    const sentAt = this.recentContent.get(key);
    if (sentAt === undefined || sentAt <= now - DUPLICATE_WINDOW_MS) return null;
    return {
      retryAfter: Math.max(1, Math.ceil((sentAt + DUPLICATE_WINDOW_MS - now) / SECOND)),
      message: 'You just sent this exact message. Rephrase it or add something new.',
    };
  }

  private record(key: string, now: number, keepMs: number): void {
    const stamps = (this.hits.get(key) ?? []).filter((stamp) => stamp > now - keepMs);
    stamps.push(now);
    this.hits.set(key, stamps);
  }

  private sweep(now: number): void {
    if (++this.operations % SWEEP_EVERY) return;
    for (const [key, stamps] of this.hits)
      if (stamps[stamps.length - 1] <= now - DAY) this.hits.delete(key);
    for (const [key, sentAt] of this.recentContent)
      if (sentAt <= now - DUPLICATE_WINDOW_MS) this.recentContent.delete(key);
    for (const [key, until] of this.cooldowns) if (until <= now) this.cooldowns.delete(key);
  }
}
