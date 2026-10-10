import { describe, it, expect, beforeEach } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { PerformanceController } from './performance.controller';

const neo4jStub = { write: async () => undefined };

function reqFor(userId: string, role = 'PARTICIPANT') {
  return { user: { id: userId, role } };
}

describe('performance — write authorization + project scoping', () => {
  let prisma: PrismaService;
  let perf: PerformanceController;

  beforeEach(() => {
    prisma = new PrismaService();
    perf = new PerformanceController(prisma, neo4jStub as any);
  });

  async function makeUser(email: string, role = 'PARTICIPANT') {
    const u: any = await (prisma.user as any).create({
      data: { email, passwordHash: 'x', fullName: email, role },
    });
    return u.id as string;
  }

  async function setupTeam(ownerId: string, hackathonId: string, name: string) {
    await (prisma.hackathon as any).create({
      data: { id: hackathonId, title: hackathonId, description: 'd', status: 'PUBLISHED' },
    }).catch(() => null);
    const team: any = await (prisma.team as any).create({
      data: { name, hackathonId, visibility: 'TEAM_DISCOVERABLE' },
    });
    await (prisma.teamMember as any).create({
      data: { teamId: team.id, userId: ownerId, role: 'LEADER' },
    });
    const project: any = await (prisma.project as any).create({
      data: { teamId: team.id, hackathonId, title: `${name} project`, description: 'd' },
    });
    return { team, project };
  }

  it('cross-team phase-progress/mistake/improvement writes are forbidden', async () => {
    const a = await makeUser('perf-a@hmt.test');
    const b = await makeUser('perf-b@hmt.test');
    const { project } = await setupTeam(a, 'hack-perf', 'Victim');
    await setupTeam(b, 'hack-perf', 'Rival');
    await expect(
      perf.createPhaseProgress(reqFor(b) as any, { projectId: project.id, phaseName: 'p', status: 'DONE' } as any),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      perf.createMistake(reqFor(b) as any, { projectId: project.id, title: 't' } as any),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      perf.createImprovementArea(reqFor(b) as any, { projectId: project.id, area: 'a', suggestion: 's' } as any),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('own-team writes succeed; staff writes succeed', async () => {
    const owner = await makeUser('perf-own@hmt.test');
    const mentor = await makeUser('perf-men@hmt.test', 'MENTOR');
    const { project } = await setupTeam(owner, 'hack-perf', 'Mine');
    const pp: any = await perf.createPhaseProgress(reqFor(owner) as any, { projectId: project.id, phaseName: 'p', status: 'DONE' } as any);
    expect(pp.projectId).toBe(project.id);
    const mk: any = await perf.createMistake(reqFor(mentor, 'MENTOR') as any, { projectId: project.id, title: 't' } as any);
    expect(mk.projectId).toBe(project.id);
  });

  it('elimination ingest is organizer-only', async () => {
    const p = await makeUser('perf-part@hmt.test');
    const o = await makeUser('perf-org@hmt.test', 'ORGANIZER');
    const { project } = await setupTeam(p, 'hack-perf', 'Victim');
    await expect(
      perf.ingestElimination(reqFor(p) as any, { projectId: project.id, reason: 'r', category: 'c' } as any),
    ).rejects.toBeInstanceOf(ForbiddenException);
    const elim: any = await perf.ingestElimination(reqFor(o, 'ORGANIZER') as any, { projectId: project.id, reason: 'r', category: 'c' } as any);
    expect(elim.projectId).toBe(project.id);
  });

  it('scoped reads enforce explicit team match (no false denial, no leak)', async () => {
    const a = await makeUser('perf-ra@hmt.test');
    const b = await makeUser('perf-rb@hmt.test');
    const { project: projA } = await setupTeam(a, 'hack-a', 'TeamA');
    // b has no team: scoped read of A's project is forbidden…
    await expect(perf.getEvaluations(reqFor(b) as any, projA.id)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(perf.getPublishedFeedback(reqFor(b) as any, projA.id)).rejects.toBeInstanceOf(ForbiddenException);
    // …but b's own project in another hackathon resolves fine (no false denial).
    const { project: projB } = await setupTeam(b, 'hack-b', 'TeamB');
    const mine: any = await perf.getEvaluations(reqFor(b) as any, projB.id);
    expect(mine.projectId).toBe(projB.id);
    const tl: any = await perf.getPerformanceTimeline(reqFor(b) as any, projB.id);
    expect(tl.projectId).toBe(projB.id);
    await expect(perf.getPerformanceTimeline(reqFor(b) as any, projA.id)).rejects.toBeInstanceOf(ForbiddenException);
  });
});
