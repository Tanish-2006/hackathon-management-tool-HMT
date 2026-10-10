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
  // Fail closed on null/undefined input (JS callers) — never throw on read path.
  if (!input || typeof input !== 'object') return 'DRAFT';
  const rawStatus = (input as { status?: unknown }).status;
  const status = String(typeof rawStatus === 'string' && rawStatus.trim() ? rawStatus.trim() : 'DRAFT').toUpperCase();
  if (
    status === 'DRAFT' ||
    status === 'REVIEW' ||
    status === 'CONFIRMED' ||
    status === 'ARCHIVED'
  ) {
    return status as DerivedHackathonStatus;
  }
  if (status !== 'PUBLISHED' && status !== 'IS_PUBLISHED') {
    // Unknown persisted value — fail closed to draft-safe (never expose unknown states publicly).
    return 'DRAFT';
  }

  const nowMs = now instanceof Date ? now.getTime() : NaN;
  // Invalid clock input — cannot safely derive windows; fail closed to PUBLISHED
  // only when explicitly published, otherwise DRAFT. PUBLISHED without windows
  // is the minimal public state (no CTA inference).
  if (Number.isNaN(nowMs)) return 'PUBLISHED';

  const regStart = toTime(input.registrationStart);
  const regEnd = toTime(input.registrationEnd);
  // Empty-string aliases must fall back to legacy fields (?? would keep "").
  const evtStart = toTime(input.eventStart || input.startDate);
  const evtEnd = toTime(input.eventEnd || input.endDate);
  const rawPhases = Array.isArray(input.phases) ? input.phases : [];
  // Guard null/undefined elements (Array.isArray does not validate items).
  const phases = rawPhases.filter((p): p is NonNullable<(typeof rawPhases)[number]> => p != null && typeof p === 'object');

  // Active phase name drives SUBMISSION / EVALUATION override while LIVE.
  const activePhase = phases.find(
    (p) => String(p.status || '').trim().toUpperCase() === 'ACTIVE',
  );
  const activeName = String(activePhase?.name || '').toLowerCase();

  // 1. Registration window (Unstop/Hack2Skill pattern: explicit reg deadline drives CTA).
  if (regStart != null && nowMs < regStart) return 'PUBLISHED';
  if (regStart != null && regEnd != null) {
    // Guard inverted window (misconfig): start > end — fail closed to PUBLISHED.
    if (regStart > regEnd) return 'PUBLISHED';
    if (nowMs >= regStart && nowMs <= regEnd) return 'REGISTRATION_OPEN';
    // after registration closes but before event starts
    if (nowMs > regEnd && (evtStart == null || nowMs < evtStart))
      return 'REGISTRATION_CLOSED';
  } else if (regEnd != null) {
    if (nowMs <= regEnd) return 'REGISTRATION_OPEN';
    if (evtStart == null || nowMs < evtStart) return 'REGISTRATION_CLOSED';
  } else if (regStart != null) {
    // Open-ended registration (start only, no deadline): OPEN once started.
    if (nowMs >= regStart) return 'REGISTRATION_OPEN';
  }

  // 2. Event window → LIVE (+ phase overrides).
  // Guard inverted event window.
  if (evtStart != null && evtEnd != null && evtStart > evtEnd) {
    return regEnd != null && nowMs > regEnd ? 'REGISTRATION_CLOSED' : 'PUBLISHED';
  }
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
  } else if (evtStart != null && evtEnd == null) {
    // Half-open: start only — LIVE once started, otherwise upcoming/registration-closed.
    if (nowMs < evtStart) {
      return regEnd != null ? 'REGISTRATION_CLOSED' : 'PUBLISHED';
    }
    if (activeName.includes('submis')) return 'SUBMISSION';
    if (activeName.includes('evalua')) return 'EVALUATION';
    return 'LIVE';
  } else if (evtStart == null && evtEnd != null) {
    // Half-open: end only — COMPLETED once past end.
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
  if (
    derived === 'PUBLISHED' ||
    derived === 'REGISTRATION_OPEN' ||
    derived === 'REGISTRATION_CLOSED'
  )
    return 'upcoming';
  return 'registered';
}
