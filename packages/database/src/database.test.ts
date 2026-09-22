import { describe, it, expect } from 'vitest';
import { canAccessRepository } from './repository-access';
import { REDIS_KEYS } from './redis';
import { NEO4J_INIT_CYPHER } from './neo4j';

describe('database - repository access default deny', () => {
  it('denies when no grants', () => {
    expect(
      canAccessRepository({
        teamId: 't1',
        repositoryIdentifier: 'org/repo',
        requesterId: 'ai',
        requesterType: 'ai_teammate',
        scope: 'READ',
        grants: [],
      }),
    ).toBe(false);
  });
  it('allows with active READ grant', () => {
    expect(
      canAccessRepository({
        teamId: 't1',
        repositoryIdentifier: 'org/repo',
        requesterId: 'hmt-ai-teammate',
        requesterType: 'ai_teammate',
        scope: 'READ',
        grants: [{ grantedTo: 'hmt-ai-teammate', grantedToUserId: null, scope: 'READ', status: 'ACTIVE', revokedAt: null, expiresAt: null }],
      }),
    ).toBe(true);
  });
  it('denies READ_WRITE without write scope', () => {
    expect(
      canAccessRepository({
        teamId: 't1',
        repositoryIdentifier: 'org/repo',
        requesterId: 'hmt-ai-teammate',
        requesterType: 'ai_teammate',
        scope: 'READ_WRITE',
        grants: [{ grantedTo: 'hmt-ai-teammate', grantedToUserId: null, scope: 'READ', status: 'ACTIVE', revokedAt: null, expiresAt: null }],
      }),
    ).toBe(false);
  });
  it('denies revoked grant', () => {
    expect(
      canAccessRepository({
        teamId: 't1',
        repositoryIdentifier: 'org/repo',
        requesterId: 'hmt-ai-teammate',
        requesterType: 'ai_teammate',
        scope: 'READ',
        grants: [{ grantedTo: 'hmt-ai-teammate', grantedToUserId: null, scope: 'READ', status: 'REVOKED', revokedAt: new Date(), expiresAt: null }],
      }),
    ).toBe(false);
  });
});

describe('database - redis keys', () => {
  it('generates prefixed keys', () => {
    expect(REDIS_KEYS.rateLimit('127.0.0.1')).toBe('rl:127.0.0.1');
    expect(REDIS_KEYS.revokedJti('jti-1')).toBe('auth:revoked:jti-1');
  });
});

describe('database - neo4j cypher', () => {
  it('init cypher contains constraints', () => {
    expect(NEO4J_INIT_CYPHER).toContain('CONSTRAINT');
    expect(NEO4J_INIT_CYPHER).toContain('User');
  });
});
