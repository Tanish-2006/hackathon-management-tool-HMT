// Shared domain primitives

export const RoleValues = ['PARTICIPANT', 'ORGANIZER', 'MENTOR', 'ADMIN'] as const;
export type Role = (typeof RoleValues)[number];

export const PrivacyScopeValues = [
  'PUBLIC',
  'PARTICIPANT',
  'TEAM_MEMBER',
  'TEAM_LEADER',
  'MENTOR',
  'ORGANIZER',
  'ADMIN',
] as const;
export type PrivacyScope = (typeof PrivacyScopeValues)[number];

export type ISODateString = string; // ISO 8601

export interface Auditable {
  createdAt: ISODateString;
  updatedAt: ISODateString;
  createdBy?: string | null;
  updatedBy?: string | null;
}

export interface Paginated<T> {
  data: T[];
  meta: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}
