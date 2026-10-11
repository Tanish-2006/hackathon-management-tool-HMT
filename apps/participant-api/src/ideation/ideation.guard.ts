import { Injectable } from '@nestjs/common';

export interface GuardRejection {
  retryAfter: number;
  message: string;
}

const SEND_GAP_MS = 5000;
const SWEEP_EVERY = 500;

@Injectable()
export class IdeationGuard {
  private readonly lastSend = new Map<string, number>();
  private operations = 0;

  check(userId: string, hackathonId: string): GuardRejection | null {
    const now = Date.now();
    this.sweep(now);
    const key = `${hackathonId}:${userId}`;
    const last = this.lastSend.get(key);
    if (last !== undefined && now - last < SEND_GAP_MS) {
      return {
        retryAfter: Math.max(1, Math.ceil((last + SEND_GAP_MS - now) / 1000)),
        message: 'You are sending messages very quickly. Try again in a moment.',
      };
    }
    this.lastSend.set(key, now);
    return null;
  }

  private sweep(now: number): void {
    if (++this.operations % SWEEP_EVERY) return;
    for (const [key, last] of this.lastSend) if (now - last >= SEND_GAP_MS) this.lastSend.delete(key);
  }
}
