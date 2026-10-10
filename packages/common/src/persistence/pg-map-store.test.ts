import { afterEach, describe, expect, it, vi } from 'vitest';
import { PgMapStore } from './pg-map-store';

const url = process.env.PG_MAP_STORE_TEST_URL;

describe('PgMapStore serialization', () => {
  it('round-trips Date, Map and Set exactly', () => {
    const value = { at: new Date('2026-10-10T10:00:00.000Z'), tags: new Set(['a']), index: new Map([['k', 1]]), n: null };
    expect(PgMapStore.deserialize(PgMapStore.serialize(value))).toEqual(value);
  });
});

class FakePool {
  upserts: string[][] = [];
  deletes: string[][] = [];

  async query() {
    return { rows: [] };
  }

  async connect() {
    return {
      query: async (sql: string, params: string[][] = []) => {
        if (sql.includes('INSERT INTO')) this.upserts.push(params[3] ?? []);
        if (sql.includes('DELETE FROM')) this.deletes.push(params[2] ?? []);
        return { rows: [] };
      },
      release: () => undefined,
    };
  }

  async end() {}
}

async function storeWithFakePool() {
  const store = new PgMapStore('postgres://unused', 'test');
  const pool = new FakePool();
  (store as unknown as { pool: FakePool }).pool = pool;
  const users = new Map<string, any>();
  let outbox: unknown[] = [];
  await store.attachMap('users', users);
  await store.attachValue('outbox', () => outbox, (v) => (outbox = v));
  return { store, pool, users, outbox: () => outbox };
}

describe('PgMapStore dirty tracking', () => {
  afterEach(() => vi.restoreAllMocks());

  it('skips serializing and upserting entries whose reference is unchanged', async () => {
    const { store, pool, users, outbox } = await storeWithFakePool();
    users.set('u1', { id: 'u1', name: 'A' });
    users.set('u2', { id: 'u2', name: 'B' });
    outbox().push({ eventId: 'e1' });
    await store.flush();
    expect(pool.upserts).toEqual([['{"id":"u1","name":"A"}', '{"id":"u2","name":"B"}', '[{"eventId":"e1"}]']]);

    const serialize = vi.spyOn(PgMapStore, 'serialize');
    await store.flush();
    expect(serialize).not.toHaveBeenCalled();
    expect(pool.upserts).toHaveLength(1);

    users.set('u2', { ...users.get('u2'), name: 'B2' });
    users.delete('u1');
    await store.flush();
    expect(serialize).toHaveBeenCalledTimes(1);
    expect(pool.upserts[1]).toEqual(['{"id":"u2","name":"B2"}']);
    expect(pool.deletes).toEqual([['u1']]);
  });

  it('persists in-place mutations on the full diff run by close()', async () => {
    const { store, pool, users } = await storeWithFakePool();
    users.set('u1', { id: 'u1', name: 'A' });
    await store.flush();
    users.get('u1').name = 'A2';
    await store.flush();
    expect(pool.upserts).toHaveLength(1);
    await store.close();
    expect(pool.upserts[1]).toEqual(['{"id":"u1","name":"A2"}']);
  });
});

describe.skipIf(!url)('PgMapStore persistence', () => {
  it('persists set, in-place mutation, delete and arrays across reattach', async () => {
    const namespace = `test-${Date.now()}`;
    const users = new Map<string, any>();
    let outbox: unknown[] = [];
    const first = new PgMapStore(url!, namespace);
    await first.attachMap('users', users);
    await first.attachValue('outbox', () => outbox, (v) => (outbox = v));
    users.set('u1', { id: 'u1', name: 'A', createdAt: new Date('2026-01-01T00:00:00.000Z') });
    users.set('u2', { id: 'u2', name: 'B' });
    outbox.push({ eventId: 'e1' });
    await first.flush();
    users.get('u1').name = 'A2';
    users.delete('u2');
    users.set('u3', { id: 'u3' });
    await first.close();

    const reloaded = new Map<string, any>();
    let reloadedOutbox: unknown[] = [];
    const second = new PgMapStore(url!, namespace);
    await second.attachMap('users', reloaded);
    await second.attachValue('outbox', () => reloadedOutbox, (v) => (reloadedOutbox = v));
    expect([...reloaded.keys()]).toEqual(['u1', 'u3']);
    expect(reloaded.get('u1')).toEqual({ id: 'u1', name: 'A2', createdAt: new Date('2026-01-01T00:00:00.000Z') });
    expect(reloadedOutbox).toEqual([{ eventId: 'e1' }]);
    await second.close();
  });
});
