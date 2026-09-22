/**
 * Repository access domain logic - default deny.
 * No direct DB writes here; just policy helpers.
 */

export interface RepositoryAccessCheck {
  teamId: string;
  repositoryIdentifier: string;
  requesterId: string; // who wants access
  requesterType: 'user' | 'ai_teammate';
  scope: 'READ' | 'READ_WRITE';
  grants: Array<{
    grantedTo: string;
    grantedToUserId: string | null;
    scope: 'READ' | 'READ_WRITE';
    status: 'ACTIVE' | 'REVOKED' | 'EXPIRED';
    revokedAt: Date | null;
    expiresAt: Date | null;
  }>;
}

export function canAccessRepository(check: RepositoryAccessCheck): boolean {
  // Default deny: no grants => no access
  const now = new Date();
  const activeGrants = check.grants.filter(
    (g) => g.status === 'ACTIVE' && !g.revokedAt && (!g.expiresAt || g.expiresAt > now),
  );
  if (activeGrants.length === 0) return false;

  // Check if requester has an active grant
  const matching = activeGrants.filter((g) => {
    const idMatch = g.grantedTo === check.requesterId || g.grantedToUserId === check.requesterId;
    if (!idMatch) return false;
    if (check.scope === 'READ_WRITE' && g.scope !== 'READ_WRITE') return false;
    return true;
  });

  return matching.length > 0;
}

export function requireTeamLeaderGrantsOnly(
  actorTeamRole: 'LEADER' | 'MEMBER',
): { allowed: boolean; reason?: string } {
  if (actorTeamRole !== 'LEADER') {
    return { allowed: false, reason: 'Only team leaders can grant repository access' };
  }
  return { allowed: true };
}
