import { beforeEach, describe, expect, it } from 'vitest';
import { memoryStore } from '../../store/memory.store';
import { ParticipantMirror } from './participant-mirror';

describe('ParticipantMirror', () => {
  const mirror = new ParticipantMirror('');
  const team = { id: 't1', hackathonId: 'h1', name: 'Alpha', ideationPhase: 2 };

  beforeEach(() => {
    for (const name of ['participants', 'teams', 'teamMembers', 'projects'] as const) memoryStore[name].clear();
  });

  it('copies the snapshot, keeps unchanged rows by identity and drops rows that disappeared', () => {
    mirror.apply({ participants: [{ id: 'r1' }], teams: [team, { id: 't2' }], teamMembers: [{ id: 'm1' }], projects: [] });
    const kept = memoryStore.teams.get('t1');

    mirror.apply({ participants: [{ id: 'r1' }], teams: [{ ...team }], teamMembers: [], projects: [{ id: 'p1' }] });

    expect(memoryStore.teams.get('t1')).toBe(kept);
    expect(memoryStore.teams.has('t2')).toBe(false);
    expect(memoryStore.teamMembers.size).toBe(0);
    expect(memoryStore.projects.get('p1')).toEqual({ id: 'p1' });
  });

  it('replaces a row whose content changed', () => {
    mirror.apply({ participants: [], teams: [team], teamMembers: [], projects: [] });
    mirror.apply({ participants: [], teams: [{ ...team, ideationPhase: 3 }], teamMembers: [], projects: [] });
    expect(memoryStore.teams.get('t1')).toMatchObject({ ideationPhase: 3 });
  });
});
