import { describe, expect, it } from 'vitest';
import { PgMapStore } from './pg-map-store';

const url = process.env.PG_MAP_STORE_TEST_URL;

describe('PgMapStore serialization', () => {
  it('round-trips Date, Map and Set exactly', () => {
    const value = { at: new Date('2026-10-10T10:00:00.000Z'), tags: new Set(['a']), index: new Map([['k', 1]]), n: null };
    expect(PgMapStore.deserialize(PgMapStore.serialize(value))).toEqual(value);
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
