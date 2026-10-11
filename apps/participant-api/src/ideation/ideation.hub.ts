import { Injectable } from '@nestjs/common';

export type HubListener = (event: string, data: unknown) => void;

@Injectable()
export class IdeationHub {
  private readonly threads = new Map<string, Set<HubListener>>();

  subscribe(threadId: string, listener: HubListener): () => void {
    const listeners = this.threads.get(threadId) ?? new Set<HubListener>();
    listeners.add(listener);
    this.threads.set(threadId, listeners);
    return () => {
      listeners.delete(listener);
      if (!listeners.size) this.threads.delete(threadId);
    };
  }

  publish(threadId: string, event: string, data: unknown): void {
    for (const listener of this.threads.get(threadId) ?? []) {
      try {
        listener(event, data);
      } catch {
        continue;
      }
    }
  }

  watchers(threadId: string): number {
    return this.threads.get(threadId)?.size ?? 0;
  }
}
