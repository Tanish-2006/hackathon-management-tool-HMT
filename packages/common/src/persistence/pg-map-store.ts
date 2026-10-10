import { Pool } from 'pg';

type Tracked =
  | { kind: 'map'; collection: string; map: Map<string, unknown>; persisted: Map<string, string> }
  | { kind: 'value'; collection: string; get: () => unknown; persisted: Map<string, string> };

const VALUE_ID = '_';

export class PgMapStore {
  private readonly pool: Pool;
  private readonly tracked: Tracked[] = [];
  private timer: NodeJS.Timeout | null = null;
  private flushing: Promise<void> | null = null;
  private ready: Promise<void> | null = null;

  constructor(
    connectionString: string,
    private readonly namespace: string,
    private readonly intervalMs = 1000,
    private readonly onError: (error: unknown) => void = (error) => console.error('[PgMapStore] flush failed', error),
  ) {
    this.pool = new Pool({ connectionString, max: 4 });
  }

  static serialize(value: unknown): string {
    return JSON.stringify(value, function (this: Record<string, unknown>, key, current) {
      const raw = this[key];
      if (raw instanceof Date) return { $date: Number.isNaN(raw.getTime()) ? null : raw.toISOString() };
      if (current instanceof Map) return { $map: Array.from(current.entries()) };
      if (current instanceof Set) return { $set: Array.from(current.values()) };
      return current;
    }).replace(/\\u0000/g, '');
  }

  static deserialize(text: string): unknown {
    return JSON.parse(text, (_key, current) => {
      if (!current || typeof current !== 'object' || Array.isArray(current)) return current;
      const keys = Object.keys(current);
      if (keys.length !== 1) return current;
      if (keys[0] === '$date') return current.$date === null ? new Date(NaN) : new Date(current.$date);
      if (keys[0] === '$map' && Array.isArray(current.$map)) return new Map(current.$map);
      if (keys[0] === '$set' && Array.isArray(current.$set)) return new Set(current.$set);
      return current;
    });
  }

  async attachMap<V>(collection: string, map: Map<string, V>): Promise<void> {
    await this.ensureSchema();
    const { rows } = await this.pool.query<{ id: string; data: string }>(
      'SELECT id, data::text AS data FROM hmt_state WHERE namespace = $1 AND collection = $2 ORDER BY seq',
      [this.namespace, collection],
    );
    const persisted = new Map<string, string>();
    map.clear();
    for (const row of rows) {
      map.set(row.id, PgMapStore.deserialize(row.data) as V);
      persisted.set(row.id, row.data);
    }
    for (const [id, value] of map) persisted.set(id, PgMapStore.serialize(value));
    this.tracked.push({ kind: 'map', collection, map: map as Map<string, unknown>, persisted });
  }

  async attachValue<V>(collection: string, get: () => V, set: (value: V) => void): Promise<void> {
    await this.ensureSchema();
    const { rows } = await this.pool.query<{ data: string }>(
      'SELECT data::text AS data FROM hmt_state WHERE namespace = $1 AND collection = $2 AND id = $3',
      [this.namespace, collection, VALUE_ID],
    );
    const persisted = new Map<string, string>();
    if (rows[0]) set(PgMapStore.deserialize(rows[0].data) as V);
    persisted.set(VALUE_ID, PgMapStore.serialize(get()));
    this.tracked.push({ kind: 'value', collection, get, persisted });
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.flush().catch(this.onError), this.intervalMs);
    this.timer.unref();
  }

  async flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    this.flushing = this.writeChanges().finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }

  async close(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.flush();
    await this.pool.end();
  }

  private ensureSchema(): Promise<void> {
    this.ready ??= this.pool
      .query(
        `CREATE TABLE IF NOT EXISTS hmt_state (
          namespace text NOT NULL,
          collection text NOT NULL,
          id text NOT NULL,
          data jsonb NOT NULL,
          seq bigint GENERATED ALWAYS AS IDENTITY,
          updated_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY (namespace, collection, id)
        )`,
      )
      .then(() => undefined);
    return this.ready;
  }

  private collectChanges() {
    const upserts: { collection: string; id: string; data: string; track: Tracked }[] = [];
    const deletes: { collection: string; id: string; track: Tracked }[] = [];
    for (const track of this.tracked) {
      const current = new Map<string, string>();
      if (track.kind === 'map') {
        for (const [id, value] of track.map) current.set(String(id), PgMapStore.serialize(value));
      } else {
        current.set(VALUE_ID, PgMapStore.serialize(track.get()));
      }
      for (const [id, data] of current) {
        if (track.persisted.get(id) !== data) upserts.push({ collection: track.collection, id, data, track });
      }
      for (const id of track.persisted.keys()) {
        if (!current.has(id)) deletes.push({ collection: track.collection, id, track });
      }
    }
    return { upserts, deletes };
  }

  private async writeChanges(): Promise<void> {
    const { upserts, deletes } = this.collectChanges();
    if (upserts.length === 0 && deletes.length === 0) return;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      if (upserts.length > 0) {
        await client.query(
          `INSERT INTO hmt_state (namespace, collection, id, data)
           SELECT $1, c, i, d::jsonb FROM unnest($2::text[], $3::text[], $4::text[]) AS t(c, i, d)
           ON CONFLICT (namespace, collection, id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
          [this.namespace, upserts.map((u) => u.collection), upserts.map((u) => u.id), upserts.map((u) => u.data)],
        );
      }
      if (deletes.length > 0) {
        await client.query(
          `DELETE FROM hmt_state s USING unnest($2::text[], $3::text[]) AS t(c, i)
           WHERE s.namespace = $1 AND s.collection = t.c AND s.id = t.i`,
          [this.namespace, deletes.map((d) => d.collection), deletes.map((d) => d.id)],
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    for (const u of upserts) u.track.persisted.set(u.id, u.data);
    for (const d of deletes) d.track.persisted.delete(d.id);
  }
}
