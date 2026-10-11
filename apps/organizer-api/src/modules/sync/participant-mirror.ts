import { resolveSyncSecret } from '@hmt/config';
import { memoryStore } from '../../store/memory.store';

type Row = { id: string };
type Snapshot = Record<'participants' | 'teams' | 'teamMembers' | 'projects', Row[]>;

const COLLECTIONS = ['participants', 'teams', 'teamMembers', 'projects'] as const;

export class ParticipantMirror {
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;

  constructor(
    private readonly baseUrl = process.env.PARTICIPANT_API_URL?.replace(/\/$/, '') ?? '',
    private readonly intervalMs = 15_000,
  ) {}

  start(): void {
    if (!this.baseUrl || this.timer) return;
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), this.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  refresh(): Promise<void> {
    this.running ??= this.pull().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  apply(snapshot: Snapshot): void {
    for (const name of COLLECTIONS) {
      const target = memoryStore[name] as Map<string, unknown>;
      const rows = Array.isArray(snapshot[name]) ? snapshot[name] : [];
      const seen = new Set<string>();
      for (const row of rows) {
        seen.add(row.id);
        if (JSON.stringify(target.get(row.id)) !== JSON.stringify(row)) target.set(row.id, row);
      }
      for (const id of Array.from(target.keys())) if (!seen.has(id)) target.delete(id);
    }
  }

  private async pull(): Promise<void> {
    try {
      const response = await fetch(`${this.baseUrl}/sync/snapshot`, {
        headers: { 'x-sync-secret': resolveSyncSecret() },
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      this.apply((await response.json()) as Snapshot);
    } catch (error) {
      console.warn(`Participant mirror refresh failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

export const participantMirror = new ParticipantMirror();
