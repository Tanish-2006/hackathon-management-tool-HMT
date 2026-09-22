/**
 * ID utilities - centralized ID generation validation.
 * Use cuid2/uuid in apps; here we provide type branding only.
 */
export type Brand<T, B> = T & { readonly __brand: B };

export type UserId = Brand<string, 'UserId'>;
export type HackathonId = Brand<string, 'HackathonId'>;
export type TeamId = Brand<string, 'TeamId'>;
export type ProjectId = Brand<string, 'ProjectId'>;
