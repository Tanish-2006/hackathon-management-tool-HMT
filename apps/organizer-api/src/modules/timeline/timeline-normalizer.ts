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
 * Phase duration weights for automatic allocation. Development always gets
 * the largest share; registration/submission/finale are short windows.
 * Keys are normalized phase names (lowercase, no spaces/underscores).
 * Unknown/custom phases fall back to DEFAULT_WEIGHT.
 */
const PHASE_DURATION_WEIGHTS: Record<string, number> = {
  registration: 1,
  teamformation: 1,
  ideation: 1.5,
  development: 5,
  submission: 0.75,
  evaluation: 1.5,
  finale: 0.75,
  results: 0.5,
};
const DEFAULT_PHASE_WEIGHT = 1;
// Minimum useful allocation per phase (1 hour). Enforced only when the
// window is large enough to give every phase the minimum; tiny windows
// fall back to pure proportional shares (still start < end in ms).
const MIN_PHASE_MS = 3600000;

function weightForPhase(name: string): number {
  const key = name.toLowerCase().replace(/[\s_]+/g, '');
  return PHASE_DURATION_WEIGHTS[key] ?? DEFAULT_PHASE_WEIGHT;
}

/**
 * Allocate `specs` across [windowStart, windowEnd] using phase-specific
 * duration weights (development largest), at millisecond precision.
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
  if (total < ordered.length) {
    throw new Error(
      `Event window too small for ${ordered.length} phases (needs at least ${ordered.length}ms so every phase has start < end)`,
    );
  }
  const weights = ordered.map((s) => weightForPhase(s.name));
  const weightSum = weights.reduce((a, b) => a + b, 0);
  // Raw proportional shares in ms.
  let shares = weights.map((w) => (total * w) / weightSum);
  // Enforce a minimum useful duration per phase when the window allows it,
  // taking the deficit from phases above the minimum, proportionally.
  if (total >= ordered.length * MIN_PHASE_MS) {
    let deficit = 0;
    const fixed = shares.map((share) => {
      if (share < MIN_PHASE_MS) {
        deficit += MIN_PHASE_MS - share;
        return MIN_PHASE_MS;
      }
      return share;
    });
    if (deficit > 0) {
      const surplusTotal = fixed.reduce((a, share) => a + Math.max(0, share - MIN_PHASE_MS), 0);
      if (surplusTotal > 0) {
        const take = Math.min(deficit, surplusTotal);
        shares = fixed.map((share) =>
          share <= MIN_PHASE_MS ? share : share - (take * (share - MIN_PHASE_MS)) / surplusTotal,
        );
      } else {
        shares = fixed;
      }
    } else {
      shares = fixed;
    }
  }
  // Chain boundaries so edges always touch exactly (end[i] === start[i+1]);
  // touching is NOT an overlap under the canonical rule. Millisecond
  // precision throughout — no date-only truncation, so short phases never
  // collapse to zero duration. The last phase ends exactly on the window end.
  let boundary = start;
  return ordered.map((s, i) => {
    const sMs = i === 0 ? start : boundary;
    let eMs = i === ordered.length - 1 ? end : Math.round(sMs + Math.max(1, shares[i]));
    if (eMs <= sMs) eMs = sMs + 1; // degenerate guard (unreachable after the size check above)
    boundary = eMs;
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
