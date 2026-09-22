export type Role = 'PARTICIPANT' | 'ORGANIZER' | 'MENTOR' | 'ADMIN';
export type PrivacyScope = 'PUBLIC' | 'PARTICIPANT' | 'TEAM_MEMBER' | 'TEAM_LEADER' | 'MENTOR' | 'ORGANIZER' | 'ADMIN';

// Role hierarchy: ADMIN > ORGANIZER > MENTOR > PARTICIPANT
const ROLE_HIERARCHY: Record<Role, number> = {
  PARTICIPANT: 1,
  MENTOR: 2,
  ORGANIZER: 3,
  ADMIN: 4,
};

export function hasRole(userRole: Role, requiredRole: Role): boolean {
  const a = ROLE_HIERARCHY[userRole];
  const b = ROLE_HIERARCHY[requiredRole];
  if (a === undefined || b === undefined) return false;
  return a >= b;
}

export function canAccessScope(userRole: Role, requiredScope: PrivacyScope): boolean {
  const scopeToMinRole: Record<PrivacyScope, Role> = {
    PUBLIC: 'PARTICIPANT', // everyone including unauth can see public, but for authed check we allow PARTICIPANT
    PARTICIPANT: 'PARTICIPANT',
    TEAM_MEMBER: 'PARTICIPANT', // further checked via ownership
    TEAM_LEADER: 'PARTICIPANT',
    MENTOR: 'MENTOR',
    ORGANIZER: 'ORGANIZER',
    ADMIN: 'ADMIN',
  };
  // PUBLIC is always allowed; for other scopes use hierarchy check
  if (requiredScope === 'PUBLIC') return true;
  const minRole = scopeToMinRole[requiredScope];
  return hasRole(userRole, minRole);
}

export interface ResourceOwnershipCheck {
  userId: string;
  role: Role;
  resourceOwnerId?: string | null;
  teamMemberIds?: string[] | null;
  teamLeaderId?: string | null;
}

/**
 * Server-side authorization: never trust userId/teamId/projectId/role from client.
 * All IDs must be derived from verified JWT + DB lookups.
 */
export function isResourceOwner(check: ResourceOwnershipCheck): boolean {
  if (check.role === 'ADMIN') return true;
  if (check.role === 'ORGANIZER') return true; // organizers have broad read, but write still scoped per hackathon
  if (!check.resourceOwnerId) return false;
  return check.userId === check.resourceOwnerId;
}

export function isTeamMember(check: ResourceOwnershipCheck): boolean {
  if (check.role === 'ADMIN' || check.role === 'ORGANIZER') return true;
  if (!check.teamMemberIds) return false;
  return check.teamMemberIds.includes(check.userId);
}

export function isTeamLeader(check: ResourceOwnershipCheck): boolean {
  if (check.role === 'ADMIN') return true;
  if (!check.teamLeaderId) return false;
  return check.userId === check.teamLeaderId;
}

/**
 * Central RBAC guard helper - to be used in NestJS guards.
 */
export const PERMISSIONS = {
  // Hackathon
  HACKATHON_CREATE: ['ORGANIZER', 'ADMIN'] as Role[],
  HACKATHON_UPDATE: ['ORGANIZER', 'ADMIN'] as Role[],
  HACKATHON_PUBLISH: ['ORGANIZER', 'ADMIN'] as Role[],
  HACKATHON_VIEW_PUBLIC: ['PARTICIPANT', 'MENTOR', 'ORGANIZER', 'ADMIN'] as Role[],
  HACKATHON_VIEW_PRIVATE: ['ORGANIZER', 'ADMIN'] as Role[],

  // Team
  TEAM_CREATE: ['PARTICIPANT', 'MENTOR', 'ORGANIZER', 'ADMIN'] as Role[],
  TEAM_UPDATE: ['PARTICIPANT', 'ADMIN'] as Role[], // + ownership check

  // Project
  PROJECT_VIEW_TEAM_PRIVATE: ['PARTICIPANT', 'MENTOR', 'ORGANIZER', 'ADMIN'] as Role[],

  // Mentor feedback
  MENTOR_FEEDBACK_CREATE: ['MENTOR', 'ORGANIZER', 'ADMIN'] as Role[],
  MENTOR_FEEDBACK_VIEW_PRIVATE: ['MENTOR', 'ORGANIZER', 'ADMIN'] as Role[],
} as const;

export function hasPermission(userRole: Role, allowed: readonly Role[]): boolean {
  return (allowed as readonly string[]).includes(userRole);
}
