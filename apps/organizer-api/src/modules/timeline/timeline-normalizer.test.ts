import { describe, it, expect } from 'vitest';
import { normalizeTimeline, verifyTimelineInWindow, parseDurationToMs } from './timeline-normalizer';

const W0 = '2026-10-08T09:00:00.000Z';
const W1 = '2026-10-10T18:00:00.000Z';

function specs(n: number) {
  return Array.from({ length: n }, (_, i) => ({ name: `p${i + 1}`, order: i + 1, description: null }));
}

describe('timeline-normalizer', () => {
  it('fits 3-day window: every phase inside, sequential, touching, deterministic', () => {
    const a = normalizeTimeline(W0, W1, specs(7));
    const b = normalizeTimeline(W0, W1, specs(7));
    expect(a).toEqual(b);
    expect(a).toHaveLength(7);
    expect(a.map((p) => p.order)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(a[0].startsAt).toBe(W0);
    expect(a[6].endsAt).toBe(W1);
    for (let i = 0; i < a.length; i++) {
      expect(new Date(a[i].startsAt).getTime()).toBeLessThan(new Date(a[i].endsAt).getTime());
      if (i > 0) expect(new Date(a[i].startsAt).getTime()).toBe(new Date(a[i - 1].endsAt).getTime());
    }
    expect(verifyTimelineInWindow(W0, W1, a)).toBeNull();
  });

  it('fits 1-day and 7-day windows', () => {
    const day = normalizeTimeline('2026-10-08T09:00:00.000Z', '2026-10-08T18:00:00.000Z', specs(3));
    expect(verifyTimelineInWindow('2026-10-08T09:00:00.000Z', '2026-10-08T18:00:00.000Z', day)).toBeNull();
    const week = normalizeTimeline('2026-10-08T09:00:00.000Z', '2026-10-15T09:00:00.000Z', specs(7));
    expect(verifyTimelineInWindow('2026-10-08T09:00:00.000Z', '2026-10-15T09:00:00.000Z', week)).toBeNull();
  });

  it('rejects unordered, duplicate, and empty specs', () => {
    expect(() => normalizeTimeline(W0, W1, [])).toThrow(/at least one phase/i);
    expect(() =>
      normalizeTimeline(W0, W1, [
        { name: 'a', order: 1 },
        { name: 'b', order: 1 },
      ]),
    ).toThrow(/duplicate/i);
    // Unordered input is normalized into deterministic order.
    const out = normalizeTimeline(W0, W1, [
      { name: 'b', order: 2 },
      { name: 'a', order: 1 },
    ]);
    expect(out.map((p) => p.order)).toEqual([1, 2]);
    expect(out[0].name).toBe('a');
  });

  it('rejects invalid windows', () => {
    expect(() => normalizeTimeline('nope', W1, specs(1))).toThrow(/invalid/i);
    expect(() => normalizeTimeline(W1, W0, specs(1))).toThrow(/before end/i);
  });

  it('verify flags pre-window starts, post-window ends, overlaps, bad ranges', () => {
    const ok = normalizeTimeline(W0, W1, specs(2));
    expect(verifyTimelineInWindow(W0, W1, ok)).toBeNull();
    expect(verifyTimelineInWindow(W0, W1, [{ ...ok[0], startsAt: '2026-10-07T00:00:00.000Z' }])).toMatch(/before the event/i);
    expect(verifyTimelineInWindow(W0, W1, [{ ...ok[1], endsAt: '2026-10-11T00:00:00.000Z' }])).toMatch(/after the event/i);
    expect(
      verifyTimelineInWindow(W0, W1, [
        { order: 1, startsAt: W0, endsAt: '2026-10-09T12:00:00.000Z' },
        { order: 2, startsAt: '2026-10-09T00:00:00.000Z', endsAt: W1 },
      ]),
    ).toMatch(/overlap/i);
    expect(verifyTimelineInWindow(W0, W1, [{ order: 1, startsAt: W1, endsAt: W0 }])).toMatch(/before endsAt/i);
  });

  it('parses durations, returns null when unparseable (never invents)', () => {
    expect(parseDurationToMs('3 days')).toBe(3 * 86400000);
    expect(parseDurationToMs('48-hour')).toBe(48 * 3600000);
    expect(parseDurationToMs('2 weeks')).toBe(14 * 86400000);
    expect(parseDurationToMs('90 minutes')).toBe(90 * 60000);
    expect(parseDurationToMs('soon')).toBeNull();
    expect(parseDurationToMs(undefined)).toBeNull();
  });

  it('48-hour event: development gets the largest share, no zero-duration, touching, in-window', () => {
    const start = '2026-10-08T09:00:00.000Z';
    const end = '2026-10-10T09:00:00.000Z'; // exactly 48h
    const names = ['registration', 'team_formation', 'ideation', 'development', 'submission', 'evaluation', 'finale'];
    const out = normalizeTimeline(
      start,
      end,
      names.map((name, i) => ({ name, order: i + 1, description: null })),
    );
    expect(out).toHaveLength(7);
    expect(out[0].startsAt).toBe(start);
    expect(out[6].endsAt).toBe(end);
    const durations = out.map((p) => new Date(p.endsAt).getTime() - new Date(p.startsAt).getTime());
    for (const d of durations) expect(d).toBeGreaterThan(0);
    // Development (index 3) strictly largest.
    expect(durations[3]).toBe(Math.max(...durations));
    expect(durations[3]).toBeGreaterThan(durations[0]);
    expect(durations[3]).toBeGreaterThan(durations[4]);
    // Sequential touching boundaries, correct order.
    expect(out.map((p) => p.order)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    for (let i = 1; i < out.length; i++) {
      expect(new Date(out[i].startsAt).getTime()).toBe(new Date(out[i - 1].endsAt).getTime());
    }
    expect(verifyTimelineInWindow(start, end, out)).toBeNull();
  });

  it('short 9-hour event: every phase keeps start < end with hour/minute precision', () => {
    const start = '2026-10-08T09:00:00.000Z';
    const end = '2026-10-08T18:00:00.000Z';
    const names = ['registration', 'team_formation', 'ideation', 'development', 'submission', 'evaluation', 'finale'];
    const out = normalizeTimeline(
      start,
      end,
      names.map((name, i) => ({ name, order: i + 1, description: null })),
    );
    expect(out).toHaveLength(7);
    for (const p of out) {
      expect(new Date(p.startsAt).getTime()).toBeLessThan(new Date(p.endsAt).getTime());
    }
    // No two phases share the same calendar day slice only — durations differ by weight.
    const durations = out.map((p) => new Date(p.endsAt).getTime() - new Date(p.startsAt).getTime());
    expect(new Set(durations).size).toBeGreaterThan(1);
    expect(verifyTimelineInWindow(start, end, out)).toBeNull();
  });

  it('long 7-day event: all phases inside window, first starts at window start, last ends at window end', () => {
    const start = '2026-10-08T09:00:00.000Z';
    const end = '2026-10-15T09:00:00.000Z';
    const out = normalizeTimeline(start, end, specs(7));
    expect(out[0].startsAt).toBe(start);
    expect(out[6].endsAt).toBe(end);
    for (const p of out) {
      expect(new Date(p.startsAt).getTime()).toBeGreaterThanOrEqual(new Date(start).getTime());
      expect(new Date(p.endsAt).getTime()).toBeLessThanOrEqual(new Date(end).getTime());
    }
    expect(verifyTimelineInWindow(start, end, out)).toBeNull();
  });

  it('unknown/custom phase names get default weight and still validate', () => {
    const out = normalizeTimeline(W0, W1, [
      { name: 'custom_kickoff', order: 1 },
      { name: 'DEVELOPMENT', order: 2 },
      { name: 'Something Else', order: 3 },
    ]);
    expect(out).toHaveLength(3);
    const dev = out.find((p) => p.order === 2)!;
    const other = out.find((p) => p.order === 1)!;
    const devDur = new Date(dev.endsAt).getTime() - new Date(dev.startsAt).getTime();
    const otherDur = new Date(other.endsAt).getTime() - new Date(other.startsAt).getTime();
    expect(devDur).toBeGreaterThan(otherDur);
    expect(verifyTimelineInWindow(W0, W1, out)).toBeNull();
  });

  it('rejects windows too small to give every phase start < end', () => {
    expect(() =>
      normalizeTimeline('2026-10-08T09:00:00.000Z', '2026-10-08T09:00:00.003Z', specs(7)),
    ).toThrow(/too small/i);
  });

  it('generated phases never overlap and manual edits stay authoritative (verify rejects overlap/zero-duration)', () => {
    const start = '2026-10-08T09:00:00.000Z';
    const end = '2026-10-10T09:00:00.000Z';
    const out = normalizeTimeline(
      start,
      end,
      ['registration', 'development', 'submission'].map((name, i) => ({ name, order: i + 1 })),
    );
    // A manual edit that creates an overlap is rejected.
    const overlapped = [
      { ...out[0], order: 1 },
      { ...out[1], order: 2, startsAt: out[0].startsAt },
    ];
    expect(verifyTimelineInWindow(start, end, overlapped)).toMatch(/overlap/i);
    // A manual zero-duration edit is rejected.
    const zeroed = [{ order: 1, startsAt: start, endsAt: start }];
    expect(verifyTimelineInWindow(start, end, zeroed)).toMatch(/before endsAt/i);
  });
});
