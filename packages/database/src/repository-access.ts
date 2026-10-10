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
    // Optional scoping — when present, the grant only authorizes this team/repo.
    // Grants without these fields (legacy) are treated as unscoped; callers
    // MUST filter grants by teamId/repositoryIdentifier before calling.
    teamId?: string | null;
    repositoryIdentifier?: string | null;
  }>;
}

export function canAccessRepository(check: RepositoryAccessCheck): boolean {
  // Default deny: no grants => no access. Also deny on empty identifiers.
  if (!check || typeof check !== 'object') return false;
  if (!check.requesterId || !check.teamId || !check.repositoryIdentifier) return false;
  if (!Array.isArray(check.grants)) return false;
  const nowMs = Date.now();
  // Clock-skew tolerance: treat expiresAt === now as still valid for up to 30s.
  const skewMs = 30_000;
  const expiryToMs = (v: Date | string | null | undefined): number | null => {
    if (v == null) return null;
    const ms = v instanceof Date ? v.getTime() : new Date(v as string).getTime();
    return Number.isFinite(ms) ? ms : null;
  };
  const activeGrants = check.grants.filter(
    (g) => {
      if (!g || typeof g !== 'object') return false;
      if (g.status !== 'ACTIVE' || g.revokedAt) return false;
      const expMs = expiryToMs(g.expiresAt as unknown as Date | string | null);
      // Unparseable expiry fails closed (deny) rather than granting forever.
      if (g.expiresAt != null && expMs == null) return false;
      if (expMs != null && !(expMs + skewMs > nowMs)) return false;
      return true;
    },
  ).filter(
    (g) =>
      // Enforce scoping when the grant carries it — a grant for repo A
      // must never authorize repo B.
      (g.teamId == null || g.teamId === check.teamId) &&
      (g.repositoryIdentifier == null || g.repositoryIdentifier === check.repositoryIdentifier),
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
