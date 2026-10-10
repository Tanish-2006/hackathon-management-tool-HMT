import { describe, it, expect, beforeEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { PrivacyService } from '../privacy/privacy.service';
import { TeamController } from './team.controller';
import { ProjectController } from '../project/project.controller';

const neo4jStub = { write: async () => undefined };

function reqFor(userId: string) {
  return { user: { id: userId, role: 'PARTICIPANT' } };
}

describe('team + project — hackathon scoping (My Team is per-hackathon)', () => {
  let prisma: PrismaService;
  let teams: TeamController;
  let projects: ProjectController;

  beforeEach(() => {
    prisma = new PrismaService();
    teams = new TeamController(prisma, neo4jStub as any, new PrivacyService());
    projects = new ProjectController(prisma, new PrivacyService());
  });

  async function makeUser(email: string) {
    const u: any = await (prisma.user as any).create({
      data: { email, passwordHash: 'x', fullName: email },
    });
    return u.id as string;
  }

  async function makeHackathon(id: string) {
    await (prisma.hackathon as any).create({
      data: { id, title: `Hack ${id}`, description: 'd', status: 'PUBLISHED' },
    });
  }

  async function register(userId: string, hackathonId: string) {
    return (prisma as any).registration.create({
      data: { userId, hackathonId, status: 'REGISTERED', teamChoice: 'later' },
    });
  }

  it('getMyTeam(hackathonId) returns only that hackathon team', async () => {
    const uid = await makeUser('scoped@hmt.test');
    await makeHackathon('hack-a');
    await makeHackathon('hack-b');
    await register(uid, 'hack-a');
    await register(uid, 'hack-b');
    const teamA: any = await teams.createTeam(reqFor(uid) as any, { name: 'A-Team', hackathonId: 'hack-a' } as any);
    const meA: any = await teams.getMyTeam(reqFor(uid) as any, 'hack-a');
    expect(meA.id).toBe(teamA.id);
    const meB: any = await teams.getMyTeam(reqFor(uid) as any, 'hack-b');
    expect(meB.team).toBeNull();
  });

  it('same participant can hold different teams in different hackathons', async () => {
    const uid = await makeUser('multi-hack@hmt.test');
    await makeHackathon('hack-a');
    await makeHackathon('hack-b');
    await register(uid, 'hack-a');
    await register(uid, 'hack-b');
    const teamA: any = await teams.createTeam(reqFor(uid) as any, { name: 'A-Team', hackathonId: 'hack-a' } as any);
    // Second team in ANOTHER hackathon must succeed (was: "Already in team").
    const teamB: any = await teams.createTeam(reqFor(uid) as any, { name: 'B-Team', hackathonId: 'hack-b' } as any);
    expect(teamB.id).toBeTruthy();
    expect(teamB.id).not.toBe(teamA.id);
    expect((await teams.getMyTeam(reqFor(uid) as any, 'hack-a') as any).id).toBe(teamA.id);
    expect((await teams.getMyTeam(reqFor(uid) as any, 'hack-b') as any).id).toBe(teamB.id);
  });

  it('duplicate team in the SAME hackathon is still rejected', async () => {
    const uid = await makeUser('dup@hmt.test');
    await makeHackathon('hack-a');
    await register(uid, 'hack-a');
    await teams.createTeam(reqFor(uid) as any, { name: 'One', hackathonId: 'hack-a' } as any);
    await expect(
      teams.createTeam(reqFor(uid) as any, { name: 'Two', hackathonId: 'hack-a' } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('joinTeam in hackathon B succeeds while in a team in hackathon A', async () => {
    const leader = await makeUser('scope-lead@hmt.test');
    const joiner = await makeUser('scope-join@hmt.test');
    await makeHackathon('hack-a');
    await makeHackathon('hack-b');
    await register(leader, 'hack-b');
    await register(joiner, 'hack-a');
    await register(joiner, 'hack-b');
    await teams.createTeam(reqFor(joiner) as any, { name: 'A-Team', hackathonId: 'hack-a' } as any);
    const teamB: any = await teams.createTeam(reqFor(leader) as any, { name: 'B-Team', hackathonId: 'hack-b' } as any);
    // Approval-based: request is PENDING, then the leader accepts.
    const rq: any = await teams.joinTeam(reqFor(joiner) as any, { teamId: teamB.id } as any);
    expect(rq.status).toBe('PENDING');
    const m: any = await teams.acceptJoinRequest(reqFor(leader) as any, rq.id);
    expect(m.role).toBe('MEMBER');
    // Scoping intact: still leads A, now member of B.
    expect((await teams.getMyTeam(reqFor(joiner) as any, 'hack-a') as any).id).toBeTruthy();
    expect((await teams.getMyTeam(reqFor(joiner) as any, 'hack-b') as any).id).toBe(teamB.id);
  });

  it('leaveTeam with hackathonId leaves only that hackathon team', async () => {
    const uid = await makeUser('leave@hmt.test');
    await makeHackathon('hack-a');
    await makeHackathon('hack-b');
    await register(uid, 'hack-a');
    await register(uid, 'hack-b');
    await teams.createTeam(reqFor(uid) as any, { name: 'A-Team', hackathonId: 'hack-a' } as any);
    const teamB: any = await teams.createTeam(reqFor(uid) as any, { name: 'B-Team', hackathonId: 'hack-b' } as any);
    await teams.leaveTeam(reqFor(uid) as any, 'hack-a');
    expect((await teams.getMyTeam(reqFor(uid) as any, 'hack-a') as any).team).toBeNull();
    expect((await teams.getMyTeam(reqFor(uid) as any, 'hack-b') as any).id).toBe(teamB.id);
  });

  it('leaveTeam without context and multiple memberships asks for context', async () => {
    const uid = await makeUser('leave-amb@hmt.test');
    await makeHackathon('hack-a');
    await makeHackathon('hack-b');
    await register(uid, 'hack-a');
    await register(uid, 'hack-b');
    await teams.createTeam(reqFor(uid) as any, { name: 'A-Team', hackathonId: 'hack-a' } as any);
    await teams.createTeam(reqFor(uid) as any, { name: 'B-Team', hackathonId: 'hack-b' } as any);
    await expect(teams.leaveTeam(reqFor(uid) as any)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('getMyProject(hackathonId) never leaks another hackathon project', async () => {
    const uid = await makeUser('proj-scope@hmt.test');
    await makeHackathon('hack-a');
    await makeHackathon('hack-b');
    await register(uid, 'hack-a');
    await register(uid, 'hack-b');
    await teams.createTeam(reqFor(uid) as any, { name: 'A-Team', hackathonId: 'hack-a' } as any);
    await projects.createOrUpdateProject(reqFor(uid) as any, {
      title: 'A-Project',
      description: 'd',
      hackathonId: 'hack-a',
    } as any);
    const meB: any = await projects.getMyProject(reqFor(uid) as any, 'hack-b');
    expect(meB.project).toBeNull();
    const meA: any = await projects.getMyProject(reqFor(uid) as any, 'hack-a');
    expect(meA.project.title).toBe('A-Project');
  });
});
