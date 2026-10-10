import { Pool } from 'pg';

type MapTrack = {
  kind: 'map';
  collection: string;
  map: Map<string, unknown>;
  persisted: Map<string, string>;
  refs: Map<string, unknown>;
};

type ValueTrack = {
  kind: 'value';
  collection: string;
  get: () => unknown;
  persisted: Map<string, string>;
  ref: unknown;
  length: number;
  tail: unknown;
};

type Tracked = MapTrack | ValueTrack;

type Upsert = { collection: string; id: string; data: string; track: Tracked; remember: () => void };
type Delete = { collection: string; id: string; track: Tracked };

const VALUE_ID = '_';

export class PgMapStore {
  private readonly pool: Pool;
  private readonly tracked: Tracked[] = [];
  private timer: NodeJS.Timeout | null = null;
  private flushing: Promise<void> | null = null;
  private ready: Promise<void> | null = null;
  private ticks = 0;

  constructor(
    connectionString: string,
    private readonly namespace: string,
    private readonly intervalMs = 1000,
    private readonly onError: (error: unknown) => void = (error) => console.error('[PgMapStore] flush failed', error),
    private readonly fullDiffEveryTicks = 30,
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
    const refs = new Map<string, unknown>();
    map.clear();
    for (const row of rows) {
      map.set(row.id, PgMapStore.deserialize(row.data) as V);
      persisted.set(row.id, row.data);
    }
    for (const [id, value] of map) {
      persisted.set(id, PgMapStore.serialize(value));
      refs.set(id, value);
    }
    this.tracked.push({ kind: 'map', collection, map: map as Map<string, unknown>, persisted, refs });
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
    const track: ValueTrack = { kind: 'value', collection, get, persisted, ref: undefined, length: 0, tail: undefined };
    PgMapStore.valueSnapshot(track, get())();
    this.tracked.push(track);
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.flush().catch(this.onError), this.intervalMs);
    this.timer.unref();
  }

  async flush(full = false): Promise<void> {
    if (this.flushing) {
      if (!full) return this.flushing;
      await this.flushing.catch(() => undefined);
      return this.flush(true);
    }
    const isFull = full || ++this.ticks % this.fullDiffEveryTicks === 0;
    this.flushing = this.writeChanges(isFull).finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }

  async close(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.flush(true);
    await this.pool.end();
  }

  private static valueSnapshot(track: ValueTrack, value: unknown): () => void {
    const length = Array.isArray(value) ? value.length : 0;
    const tail = Array.isArray(value) ? value[length - 1] : undefined;
    return () => {
      track.ref = value;
      track.length = length;
      track.tail = tail;
    };
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

  private collectChanges(full: boolean) {
    const upserts: Upsert[] = [];
    const deletes: Delete[] = [];
    for (const track of this.tracked) {
      if (track.kind === 'map') this.collectMap(track, full, upserts, deletes);
      else this.collectValue(track, full, upserts);
    }
    return { upserts, deletes };
  }

  private collectMap(track: MapTrack, full: boolean, upserts: Upsert[], deletes: Delete[]): void {
    const seen = new Set<string>();
    for (const [rawId, value] of track.map) {
      const id = String(rawId);
      seen.add(id);
      if (!full && track.refs.get(id) === value && track.refs.has(id)) continue;
      const data = PgMapStore.serialize(value);
      const remember = () => track.refs.set(id, value);
      if (track.persisted.get(id) === data) remember();
      else upserts.push({ collection: track.collection, id, data, track, remember });
    }
    for (const id of track.persisted.keys()) {
      if (!seen.has(id)) deletes.push({ collection: track.collection, id, track });
    }
  }

  private collectValue(track: ValueTrack, full: boolean, upserts: Upsert[]): void {
    const value = track.get();
    const unchanged =
      !full &&
      Array.isArray(value) &&
      value === track.ref &&
      value.length === track.length &&
      value[value.length - 1] === track.tail;
    if (unchanged) return;
    const data = PgMapStore.serialize(value);
    const remember = PgMapStore.valueSnapshot(track, value);
    if (track.persisted.get(VALUE_ID) === data) remember();
    else upserts.push({ collection: track.collection, id: VALUE_ID, data, track, remember });
  }

  private async writeChanges(full: boolean): Promise<void> {
    const { upserts, deletes } = this.collectChanges(full);
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
    for (const u of upserts) {
      u.track.persisted.set(u.id, u.data);
      u.remember();
    }
    for (const d of deletes) {
      d.track.persisted.delete(d.id);
      if (d.track.kind === 'map') d.track.refs.delete(d.id);
    }
  }
}
