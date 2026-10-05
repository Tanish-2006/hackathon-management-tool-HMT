// Canonical hackathon lifecycle — single source of truth for derived status.
// Persisted states (organizer state machine): DRAFT → REVIEW → CONFIRMED → PUBLISHED → ARCHIVED
// Derived participant-facing states: REGISTRATION_OPEN, REGISTRATION_CLOSED, LIVE,
// SUBMISSION, EVALUATION, COMPLETED — computed from timestamps/phases at read time.
// Frontend must NEVER hardcode LIVE/UPCOMING/ENDED; always call deriveLifecycleStatus().

export const PersistedHackathonStatusValues = [
  'DRAFT',
  'REVIEW',
  'CONFIRMED',
  'PUBLISHED',
  'ARCHIVED',
] as const;
export type PersistedHackathonStatus =
  (typeof PersistedHackathonStatusValues)[number];

export const DerivedHackathonStatusValues = [
  'DRAFT',
  'REVIEW',
  'CONFIRMED',
  'PUBLISHED',
  'REGISTRATION_OPEN',
  'REGISTRATION_CLOSED',
  'LIVE',
  'SUBMISSION',
  'EVALUATION',
  'COMPLETED',
  'ARCHIVED',
] as const;
export type DerivedHackathonStatus =
  (typeof DerivedHackathonStatusValues)[number];

export interface LifecycleInput {
  status: string;
  registrationStart?: string | Date | null;
  registrationEnd?: string | Date | null;
  eventStart?: string | Date | null;
  eventEnd?: string | Date | null;
  // legacy participant read-model aliases
  startDate?: string | Date | null;
  endDate?: string | Date | null;
  phases?: Array<{
    name?: string;
    status?: string;
    startsAt?: string | Date | null;
    endsAt?: string | Date | null;
  }>;
  publishedAt?: string | Date | null;
  archivedAt?: string | Date | null;
}

function toTime(v: string | Date | null | undefined): number | null {
  if (v == null) return null;
  const t = v instanceof Date ? v.getTime() : new Date(v).getTime();
  return Number.isNaN(t) ? null : t;
}

/**
 * Derive the participant-facing lifecycle state.
 * - DRAFT/REVIEW/CONFIRMED/ARCHIVED pass through (drafts never visible to participants).
 * - PUBLISHED is refined using registration/event windows, falling back to
 *   startDate/endDate and phase ACTIVE markers for legacy records.
 */
export function deriveLifecycleStatus(
  input: LifecycleInput,
  now: Date = new Date(),
): DerivedHackathonStatus {
  const status = String(input.status || 'DRAFT').toUpperCase();
  if (
    status === 'DRAFT' ||
    status === 'REVIEW' ||
    status === 'CONFIRMED' ||
    status === 'ARCHIVED'
  ) {
    return status as DerivedHackathonStatus;
  }
  if (status !== 'PUBLISHED' && status !== 'IS_PUBLISHED') {
    // Unknown persisted value — treat non-published as draft-safe, published-like as PUBLISHED.
    return 'PUBLISHED';
  }

  const nowMs = now.getTime();
  const regStart = toTime(input.registrationStart);
  const regEnd = toTime(input.registrationEnd);
  const evtStart = toTime(input.eventStart ?? input.startDate);
  const evtEnd = toTime(input.eventEnd ?? input.endDate);
  const phases = Array.isArray(input.phases) ? input.phases : [];

  // Active phase name drives SUBMISSION / EVALUATION override while LIVE.
  const activePhase = phases.find(
    (p) => String(p.status || '').toUpperCase() === 'ACTIVE',
  );
  const activeName = String(activePhase?.name || '').toLowerCase();

  // 1. Registration window (Unstop/Hack2Skill pattern: explicit reg deadline drives CTA).
  if (regStart != null && nowMs < regStart) return 'PUBLISHED';
  if (regStart != null && regEnd != null) {
    if (nowMs >= regStart && nowMs <= regEnd) return 'REGISTRATION_OPEN';
    // after registration closes but before event starts
    if (nowMs > regEnd && (evtStart == null || nowMs < evtStart))
      return 'REGISTRATION_CLOSED';
  } else if (regEnd != null) {
    if (nowMs <= regEnd) return 'REGISTRATION_OPEN';
    if (evtStart == null || nowMs < evtStart) return 'REGISTRATION_CLOSED';
  }

  // 2. Event window → LIVE (+ phase overrides).
  if (evtStart != null && evtEnd != null) {
    if (nowMs < evtStart) {
      // No registration window configured → distinguish upcoming vs reg-closed.
      return regEnd != null ? 'REGISTRATION_CLOSED' : 'PUBLISHED';
    }
    if (nowMs >= evtStart && nowMs <= evtEnd) {
      if (activeName.includes('submis')) return 'SUBMISSION';
      if (activeName.includes('evalua')) return 'EVALUATION';
      return 'LIVE';
    }
    if (nowMs > evtEnd) return 'COMPLETED';
  }

  // 3. Phase-only fallback (legacy records with phases but no event dates).
  if (activePhase) {
    if (activeName.includes('submis')) return 'SUBMISSION';
    if (activeName.includes('evalua')) return 'EVALUATION';
    if (activeName.includes('regist')) return 'REGISTRATION_OPEN';
    return 'LIVE';
  }

  // 4. Default: published but no window info.
  return 'PUBLISHED';
}

/** True when AI Teammate must be available (backend + frontend share this). */
export function isLiveForAI(
  input: LifecycleInput,
  now: Date = new Date(),
): boolean {
  const derived = deriveLifecycleStatus(input, now);
  return (
    derived === 'LIVE' ||
    derived === 'SUBMISSION' ||
    derived === 'EVALUATION'
  );
}

/** Participant discovery visibility: only public lifecycle states. */
export function isDiscoverableLifecycle(
  input: LifecycleInput,
  now: Date = new Date(),
): boolean {
  const derived = deriveLifecycleStatus(input, now);
  return (
    derived === 'PUBLISHED' ||
    derived === 'REGISTRATION_OPEN' ||
    derived === 'REGISTRATION_CLOSED' ||
    derived === 'LIVE' ||
    derived === 'SUBMISSION' ||
    derived === 'EVALUATION' ||
    derived === 'COMPLETED'
  );
}

/** Bucket for My Hackathons (Registered/Upcoming/Live/Completed). */
export function bucketForMyHackathons(
  input: LifecycleInput,
  now: Date = new Date(),
): 'upcoming' | 'live' | 'completed' | 'registered' {
  const derived = deriveLifecycleStatus(input, now);
  if (
    derived === 'LIVE' ||
    derived === 'SUBMISSION' ||
    derived === 'EVALUATION'
  )
    return 'live';
  if (derived === 'COMPLETED' || derived === 'ARCHIVED') return 'completed';
  if (derived === 'PUBLISHED' || derived === 'REGISTRATION_OPEN')
    return 'upcoming';
  return 'registered';
}
