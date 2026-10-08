/**
 * Authoritative timeline normalization layer (single source of truth).
 *
 * AI drafts only ever suggest { name, order, description } — never dates.
 * This module is the final authority that turns those suggestions into real
 * timestamps inside an EXPLICIT event window [eventStart, eventEnd].
 *
 * Rules enforced:
 *  1. Every phase lies completely inside [windowStart, windowEnd].
 *  2. Phases are sequential in `order`, touching boundaries allowed
 *     (overlap = strictly `current.end > next.start`, same as validateTimeline).
 *  3. `start < end` for every phase.
 *  4. Deterministic output for identical input (no Date.now(), no randomness).
 *  5. All parsing/comparison in epoch milliseconds (UTC instants) — no
 *     floating calendar math, no DD/MM vs MM/DD ambiguity. Local-timezone
 *     rendering stays a frontend-only concern at the API boundary.
 */

export interface PhaseSpec {
  name: string;
  order: number;
  description?: string | null;
}

export interface NormalizedPhase extends PhaseSpec {
  startsAt: string;
  endsAt: string;
}

/**
 * Parse a freeform duration ("3 days", "48-hour", "2 weeks", "90 minutes")
 * into milliseconds. Returns null when unparseable — callers decide the
 * fallback (they must never silently invent an event window from this).
 */
export function parseDurationToMs(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const m = value.match(/([\d.]+)\s*-?\s*(minutes?|hours?|hrs?|days?|weeks?|months?)/i);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  const unit = m[2].toLowerCase();
  const mult =
    unit.startsWith('minute')
      ? 60000
      : unit.startsWith('hour') || unit.startsWith('hr')
        ? 3600000
        : unit.startsWith('day')
          ? 86400000
          : unit.startsWith('week')
            ? 7 * 86400000
            : 30 * 86400000;
  return Math.round(n * mult);
}

/**
 * Allocate `specs` proportionally across [windowStart, windowEnd].
 * Phase boundaries touch exactly (end[i] === start[i+1]); touching is NOT
 * an overlap under the canonical rule, so the result always validates.
 */
export function normalizeTimeline(
  windowStart: string,
  windowEnd: string,
  specs: PhaseSpec[],
): NormalizedPhase[] {
  const start = new Date(windowStart).getTime();
  const end = new Date(windowEnd).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) {
    throw new Error('Event window has invalid start/end');
  }
  if (start >= end) {
    throw new Error('Event window start must be before end');
  }
  const ordered = [...specs].sort((a, b) => a.order - b.order);
  if (ordered.length === 0) {
    throw new Error('At least one phase is required');
  }
  const seen = new Set<number>();
  for (const s of ordered) {
    if (!s.name?.trim()) throw new Error('Phase name required');
    if (!Number.isInteger(s.order) || s.order < 1) throw new Error('Phase order must be a positive integer');
    if (seen.has(s.order)) throw new Error(`Duplicate phase order ${s.order}`);
    seen.add(s.order);
  }
  const total = end - start;
  const slice = total / ordered.length;
  return ordered.map((s, i) => {
    const sMs = Math.round(start + i * slice);
    // Last phase ends exactly on the window end (absorbs rounding).
    const eMs = i === ordered.length - 1 ? end : Math.round(start + (i + 1) * slice);
    return {
      name: s.name,
      order: s.order,
      description: s.description ?? null,
      startsAt: new Date(sMs).toISOString(),
      endsAt: new Date(eMs).toISOString(),
    };
  });
}

/**
 * Verify normalized output against the window + canonical timeline rules.
 * Returns an error message or null when valid. Used as defense-in-depth
 * after normalization and before persistence.
 */
export function verifyTimelineInWindow(
  windowStart: string,
  windowEnd: string,
  phases: Array<{ order: number; startsAt: string; endsAt: string }>,
): string | null {
  const start = new Date(windowStart).getTime();
  const end = new Date(windowEnd).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || start >= end) {
    return 'Event window is invalid';
  }
  for (const p of phases) {
    const s = new Date(p.startsAt).getTime();
    const e = new Date(p.endsAt).getTime();
    if (Number.isNaN(s) || Number.isNaN(e)) return `Phase order ${p.order} has invalid dates`;
    if (s >= e) return `Phase order ${p.order}: startsAt must be before endsAt`;
    if (s < start) return `Phase order ${p.order} starts before the event`;
    if (e > end) return `Phase order ${p.order} ends after the event`;
  }
  const sorted = [...phases].sort((a, b) => a.order - b.order);
  for (let i = 0; i < sorted.length - 1; i++) {
    if (new Date(sorted[i].endsAt).getTime() > new Date(sorted[i + 1].startsAt).getTime()) {
      return `Phases overlap between order ${sorted[i].order} and ${sorted[i + 1].order}`;
    }
  }
  return null;
}
