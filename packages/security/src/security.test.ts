import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from './hashing';
import { createTokenPair, verifyAccessToken, verifyRefreshToken } from './jwt';
import { hasRole, hasPermission, canAccessScope } from './rbac';
import { redactAuditMetadata, buildAuditEvent } from './audit';

describe('security - hashing Argon2id', () => {
  it('hashes and verifies', async () => {
    const hash = await hashPassword('StrongPass123!');
    expect(hash).toMatch(/\$argon2id\$/);
    expect(await verifyPassword(hash, 'StrongPass123!')).toBe(true);
    expect(await verifyPassword(hash, 'wrong')).toBe(false);
  }, 15000);
});

describe('security - JWT', () => {
  const cfg = {
    accessSecret: 'a'.repeat(32),
    refreshSecret: 'b'.repeat(32),
    accessTtlSec: 900,
    refreshTtlSec: 604800,
  };
  it('creates and verifies pair', () => {
    const pair = createTokenPair(cfg, { userId: 'u1', role: 'ORGANIZER' });
    expect(pair.accessToken).toBeTruthy();
    const decoded = verifyAccessToken(cfg, pair.accessToken);
    expect(decoded.sub).toBe('u1');
    expect(decoded.role).toBe('ORGANIZER');
    expect(decoded.type).toBe('access');
    const refresh = verifyRefreshToken(cfg, pair.refreshToken);
    expect(refresh.type).toBe('refresh');
    expect(refresh.sub).toBe('u1');
  });
});

describe('security - RBAC', () => {
  it('hierarchy', () => {
    expect(hasRole('ADMIN', 'ORGANIZER')).toBe(true);
    expect(hasRole('PARTICIPANT', 'ORGANIZER')).toBe(false);
    expect(hasPermission('ORGANIZER', ['ORGANIZER', 'ADMIN'])).toBe(true);
    expect(canAccessScope('PARTICIPANT', 'PUBLIC')).toBe(true);
    expect(canAccessScope('PARTICIPANT', 'ORGANIZER')).toBe(false);
    expect(canAccessScope('ADMIN', 'ORGANIZER')).toBe(true);
  });
});

describe('security - audit redaction', () => {
  it('redacts secrets', () => {
    const out = redactAuditMetadata({ password: 'secret', foo: 'bar', JWT_ACCESS_SECRET: 'x' } as any);
    expect(out?.password).toBe('[REDACTED]');
    expect(out?.foo).toBe('bar');
    const evt = buildAuditEvent({ actorId: 'u1', action: 'auth.login', resourceType: 'user', outcome: 'success', metadata: { password: 'x' } } as any);
    expect(evt.metadata?.password).toBe('[REDACTED]');
  });
});
