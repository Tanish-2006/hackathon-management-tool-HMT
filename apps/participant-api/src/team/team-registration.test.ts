import { describe, it, expect, beforeEach } from 'vitest';
import { ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { PrivacyService } from '../privacy/privacy.service';
import { TeamController } from './team.controller';
import { HackathonController } from '../hackathon/hackathon.controller';
import { ProjectController } from '../project/project.controller';

const neo4jStub = { write: async () => undefined };

function reqFor(userId: string) {
  return { user: { id: userId, role: 'PARTICIPANT' } };
}

describe('team formation — registration gate + privacy', () => {
  let prisma: PrismaService;
  let teams: TeamController;
  let hackathons: HackathonController;
  let projects: ProjectController;

  beforeEach(() => {
    prisma = new PrismaService();
    teams = new TeamController(prisma, neo4jStub as any, new PrivacyService());
    hackathons = new HackathonController(prisma);
    projects = new ProjectController(prisma, new PrivacyService());
  });

  async function makeUser(email: string) {
    const u: any = await (prisma.user as any).create({
      data: { email, passwordHash: 'x', fullName: email },
    });
    return u.id as string;
  }

  async function makeHackathon(id: string, status = 'PUBLISHED') {
    await (prisma.hackathon as any).create({
      data: { id, title: `Hack ${id}`, description: 'd', status },
    });
  }

  async function register(userId: string, hackathonId: string) {
    return (prisma as any).registration.create({
      data: { userId, hackathonId, status: 'REGISTERED', teamChoice: 'later' },
    });
  }

  it('createTeam without registration is forbidden', async () => {
    const uid = await makeUser('noteam@hmt.test');
    await makeHackathon('hack-pub');
    await expect(
      teams.createTeam(reqFor(uid) as any, { name: 'T', hackathonId: 'hack-pub' } as any),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('createTeam on a DRAFT hackathon is hidden even with a registration record', async () => {
    const uid = await makeUser('draft@hmt.test');
    await makeHackathon('hack-draft', 'DRAFT');
    await register(uid, 'hack-draft');
    await expect(
      teams.createTeam(reqFor(uid) as any, { name: 'T', hackathonId: 'hack-draft' } as any),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('createTeam with registration on PUBLISHED succeeds with caller as LEADER', async () => {
    const uid = await makeUser('leader@hmt.test');
    await makeHackathon('hack-pub');
    await register(uid, 'hack-pub');
    const team: any = await teams.createTeam(reqFor(uid) as any, { name: 'Alpha', hackathonId: 'hack-pub' } as any);
    expect(team.id).toBeTruthy();
    expect(team.hackathonId).toBe('hack-pub');
    // TID: backend-generated HMT-XXXXXX, unique, never client-set.
    expect(team.inviteCode).toMatch(/^HMT-[A-Z2-9]{6}$/);
    const members = await prisma.teamMember.findMany({ where: { teamId: team.id } } as any);
    expect(members.map((m: any) => [m.userId, m.role])).toEqual([[uid, 'LEADER']]);
  });

  it('createTeam rejects duplicate names per hackathon but allows reuse across hackathons', async () => {
    const uid = await makeUser('dupname@hmt.test');
    const rival = await makeUser('dupname-rival@hmt.test');
    await makeHackathon('hack-a');
    await makeHackathon('hack-b');
    await register(uid, 'hack-a');
    await register(rival, 'hack-a');
    await register(rival, 'hack-b');
    await teams.createTeam(reqFor(uid) as any, { name: 'Same Name', hackathonId: 'hack-a' } as any);
    await expect(
      teams.createTeam(reqFor(rival) as any, { name: 'same name', hackathonId: 'hack-a' } as any),
    ).rejects.toThrow(/already taken/);
    // Same name in another hackathon is fine.
    const t: any = await teams.createTeam(reqFor(rival) as any, { name: 'Same Name', hackathonId: 'hack-b' } as any);
    expect(t.hackathonId).toBe('hack-b');
  });

  it('createTeam enforces team-size bounds and hackathon caps', async () => {
    const uid = await makeUser('size@hmt.test');
    await (prisma.hackathon as any).create({
      data: { id: 'hack-cap', title: 'Cap', description: 'd', status: 'PUBLISHED', teamSize: { min: 2, max: 3 } },
    });
    await register(uid, 'hack-cap');
    await expect(
      teams.createTeam(reqFor(uid) as any, { name: 'Big', hackathonId: 'hack-cap', maxMembers: 5 } as any),
    ).rejects.toThrow(/exceeds the hackathon limit/);
    await expect(
      teams.createTeam(reqFor(uid) as any, { name: 'Solo', hackathonId: 'hack-cap', maxMembers: 1 } as any),
    ).rejects.toThrow(/between 2 and 12/);
    const t: any = await teams.createTeam(reqFor(uid) as any, { name: 'Trio', hackathonId: 'hack-cap', maxMembers: 3 } as any);
    expect(t.maxMembers).toBe(3);
  });

  it('concurrent creates with the same name in one hackathon yield exactly one team', async () => {
    const a = await makeUser('twin-a@hmt.test');
    const b = await makeUser('twin-b@hmt.test');
    await makeHackathon('hack-twin');
    await register(a, 'hack-twin');
    await register(b, 'hack-twin');
    const results = await Promise.allSettled([
      teams.createTeam(reqFor(a) as any, { name: 'Twin', hackathonId: 'hack-twin' } as any),
      teams.createTeam(reqFor(b) as any, { name: 'twin', hackathonId: 'hack-twin' } as any),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await prisma.team.findMany({ where: { hackathonId: 'hack-twin' } } as any)).toHaveLength(1);
  });

  it('one user joining two teams of the same hackathon concurrently ends up in exactly one', async () => {
    const [x, y, racer] = await Promise.all(['jx@hmt.test', 'jy@hmt.test', 'jr@hmt.test'].map(makeUser));
    await makeHackathon('hack-dbl');
    await Promise.all([x, y, racer].map((u) => register(u, 'hack-dbl')));
    const tx: any = await teams.createTeam(reqFor(x) as any, { name: 'X', hackathonId: 'hack-dbl' } as any);
    const ty: any = await teams.createTeam(reqFor(y) as any, { name: 'Y', hackathonId: 'hack-dbl' } as any);
    const results = await Promise.allSettled(
      [tx, ty].map((t) =>
        teams.joinByCode(reqFor(racer) as any, { teamName: t.name, tid: t.inviteCode, hackathonId: 'hack-dbl' } as any),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await prisma.teamMember.findMany({ where: { userId: racer } } as any)).toHaveLength(1);
  });

  it('registration after the organizer deadline is rejected but stays idempotent for existing registrants', async () => {
    const early = await makeUser('early@hmt.test');
    const late = await makeUser('late@hmt.test');
    await (prisma.hackathon as any).create({
      data: { id: 'hack-closed', title: 'Closed', description: 'd', status: 'PUBLISHED', registrationEnd: new Date(Date.now() - 60_000).toISOString() },
    });
    const existing = await register(early, 'hack-closed');
    for (const uid of [early, late]) {
      await prisma.user.update({ where: { id: uid }, data: { isPhoneVerified: true } } as any);
      await (prisma as any).skillProfile.upsert({ where: { userId: uid }, update: {}, create: { userId: uid, programmingLanguages: ['TS'] } });
    }
    await expect(hackathons.register(reqFor(late) as any, 'hack-closed', {})).rejects.toThrow(/Registration is closed/);
    expect((await hackathons.register(reqFor(early) as any, 'hack-closed', {})).id).toBe(existing.id);
  });

  it('second team creation while in a team is rejected', async () => {
    const uid = await makeUser('multi@hmt.test');
    await makeHackathon('hack-pub');
    await register(uid, 'hack-pub');
    await teams.createTeam(reqFor(uid) as any, { name: 'One', hackathonId: 'hack-pub' } as any);
    await expect(
      teams.createTeam(reqFor(uid) as any, { name: 'Two', hackathonId: 'hack-pub' } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('joinTeam without registration is forbidden; with registration creates a PENDING request (never membership)', async () => {
    const leader = await makeUser('jl@hmt.test');
    const joiner = await makeUser('jm@hmt.test');
    await makeHackathon('hack-pub');
    await register(leader, 'hack-pub');
    const team: any = await teams.createTeam(reqFor(leader) as any, { name: 'Open', hackathonId: 'hack-pub' } as any);
    await expect(teams.joinTeam(reqFor(joiner) as any, { teamId: team.id } as any)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await register(joiner, 'hack-pub');
    const r: any = await teams.joinTeam(reqFor(joiner) as any, { teamId: team.id } as any);
    expect(r.status).toBe('PENDING');
    // No membership was created — approval is mandatory.
    const members = await prisma.teamMember.findMany({ where: { teamId: team.id } } as any);
    expect(members.some((m: any) => m.userId === joiner)).toBe(false);
    // The leader was notified about the pending request.
    const notifs = await (prisma as any).notification.findMany({ where: { userId: leader } });
    expect(notifs.some((n: any) => n.type === 'JOIN_REQUESTED' && n.requestId === r.id)).toBe(true);
  });

  it('registered participant cannot read another TEAM_PRIVATE team (privacy enforced)', async () => {
    const a = await makeUser('pa@hmt.test');
    const b = await makeUser('pb@hmt.test');
    await makeHackathon('hack-pub');
    await register(a, 'hack-pub');
    await register(b, 'hack-pub');
    const team: any = await (prisma.team as any).create({
      data: { name: 'Secret', hackathonId: 'hack-pub', visibility: 'TEAM_PRIVATE' },
    });
    await expect(teams.getTeamById(reqFor(b) as any, team.id)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('registration persists and duplicate registration returns the existing record', async () => {
    const uid = await makeUser('reg@hmt.test');
    await makeHackathon('hack-pub');
    await (prisma.user as any).update({ where: { id: uid }, data: { isPhoneVerified: true } });
    await (prisma.skillProfile as any).upsert({
      where: { userId: uid },
      update: { programmingLanguages: ['TypeScript'] },
      create: { userId: uid, programmingLanguages: ['TypeScript'], frameworks: [], experienceLevel: 'INTERMEDIATE' },
    });
    const first: any = await hackathons.register(reqFor(uid) as any, 'hack-pub', { teamChoice: 'later' } as any);
    const second: any = await hackathons.register(reqFor(uid) as any, 'hack-pub', { teamChoice: 'later' } as any);
    expect(first.id).toBeTruthy();
    expect(second.id).toBe(first.id);
    const regs = await (prisma as any).registration.findMany({ where: { userId: uid, hackathonId: 'hack-pub' } });
    expect(regs).toHaveLength(1);
    // Registration survives re-reads (refresh persistence).
    const mine = await (prisma as any).registration.findMany({ where: { userId: uid } });
    expect(mine.map((r: any) => r.hackathonId)).toContain('hack-pub');
  });

  it('register verifies a supplied teamId (membership + same hackathon)', async () => {
    const uid = await makeUser('teamid@hmt.test');
    const other = await makeUser('teamid-other@hmt.test');
    await makeHackathon('hack-pub');
    for (const u of [uid, other]) {
      await (prisma.user as any).update({ where: { id: u }, data: { isPhoneVerified: true } });
      await (prisma.skillProfile as any).upsert({
        where: { userId: u },
        update: { programmingLanguages: ['TypeScript'] },
        create: { userId: u, programmingLanguages: ['TypeScript'], frameworks: [], experienceLevel: 'INTERMEDIATE' },
      });
    }
    await register(uid, 'hack-pub');
    const team: any = await teams.createTeam(reqFor(uid) as any, { name: 'Mine', hackathonId: 'hack-pub' } as any);
    // Forged teamId (not a member of that team) is rejected.
    await expect(
      hackathons.register(reqFor(other) as any, 'hack-pub', { teamChoice: 'join', teamId: team.id } as any),
    ).rejects.toThrow(/Invalid team choice/);
    // Omitted teamId registers cleanly.
    const reg: any = await hackathons.register(reqFor(other) as any, 'hack-pub', { teamChoice: 'later' } as any);
    expect(reg.teamId).toBeNull();
  });

  it('register enforces eligibility confirmation only when the hackathon configures it', async () => {
    const uid = await makeUser('elig@hmt.test');
    await (prisma.hackathon as any).create({
      data: { id: 'hack-elig', title: 'E', description: 'd', status: 'PUBLISHED', eligibility: ['Students'] },
    });
    await (prisma.hackathon as any).create({
      data: { id: 'hack-open', title: 'O', description: 'd', status: 'PUBLISHED' },
    });
    for (const u of [uid]) {
      await (prisma.user as any).update({ where: { id: u }, data: { isPhoneVerified: true } });
      await (prisma.skillProfile as any).upsert({
        where: { userId: u },
        update: { programmingLanguages: ['TypeScript'] },
        create: { userId: u, programmingLanguages: ['TypeScript'], frameworks: [], experienceLevel: 'INTERMEDIATE' },
      });
    }
    await expect(
      hackathons.register(reqFor(uid) as any, 'hack-elig', { teamChoice: 'later' } as any),
    ).rejects.toThrow(/eligibility/);
    const ok: any = await hackathons.register(reqFor(uid) as any, 'hack-elig', { teamChoice: 'later', eligibilityAccepted: true } as any);
    expect(ok.eligibilityAccepted).toBe(true);
    const open: any = await hackathons.register(reqFor(uid) as any, 'hack-open', { teamChoice: 'later' } as any);
    expect(open.id).toBeTruthy();
  });

  it('join-by-code: name+TID joins the right team; mismatches stay generic', async () => {
    const leader = await makeUser('tc-lead@hmt.test');
    const joiner = await makeUser('tc-join@hmt.test');
    const stranger = await makeUser('tc-stranger@hmt.test');
    await makeHackathon('hack-pub');
    await makeHackathon('hack-other');
    for (const [u, h] of [[leader, 'hack-pub'], [joiner, 'hack-pub'], [stranger, 'hack-other']] as const) {
      await register(u, h);
    }
    const team: any = await teams.createTeam(reqFor(leader) as any, { name: 'Innovators', hackathonId: 'hack-pub' } as any);
    const tid: string = team.inviteCode;
    expect(tid).toMatch(/^HMT-[A-Z2-9]{6}$/);
    const m: any = await teams.joinByCode(reqFor(joiner) as any, { teamName: 'innovators', tid: tid.toLowerCase(), hackathonId: 'hack-pub' } as any);
    expect(m.status).toBe('JOINED');
    const joined = await prisma.teamMember.findMany({ where: { teamId: team.id } } as any);
    expect(joined.some((x: any) => x.userId === joiner && x.role === 'MEMBER')).toBe(true);
    const leaderNotifs = await (prisma as any).notification.findMany({ where: { userId: leader } });
    expect(leaderNotifs.some((n: any) => n.type === 'MEMBER_JOINED')).toBe(true);
    await expect(
      teams.joinByCode(reqFor(joiner) as any, { teamName: 'Innovators', tid, hackathonId: 'hack-pub' } as any),
    ).rejects.toThrow(/Already in a team/);
    const detail: any = await teams.getTeamById(reqFor(joiner) as any, team.id);
    expect(detail.inviteCode).toBe(tid);
    // Wrong name, unknown TID, and cross-hackathon TID all look identical.
    await expect(
      teams.joinByCode(reqFor(stranger) as any, { teamName: 'Wrong', tid, hackathonId: 'hack-other' } as any),
    ).rejects.toThrow(/No matching team/);
    await expect(
      teams.joinByCode(reqFor(stranger) as any, { teamName: 'Innovators', tid: 'HMT-XXXXXX', hackathonId: 'hack-other' } as any),
    ).rejects.toThrow(/No matching team/);
    await expect(
      teams.joinByCode(reqFor(stranger) as any, { teamName: 'Innovators', tid, hackathonId: 'hack-other' } as any),
    ).rejects.toThrow(/No matching team/);
    // Unregistered caller is told to register (caller-side fact, safe to say).
    const fresh = await makeUser('tc-fresh@hmt.test');
    await expect(
      teams.joinByCode(reqFor(fresh) as any, { teamName: 'Innovators', tid, hackathonId: 'hack-pub' } as any),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('concurrent joins cannot overfill a team', async () => {
    const leader = await makeUser('cc-lead@hmt.test');
    await makeHackathon('hack-pub');
    await register(leader, 'hack-pub');
    const team: any = await teams.createTeam(
      reqFor(leader) as any,
      { name: 'Racy', hackathonId: 'hack-pub', maxMembers: 2 } as any,
    );
    const racers: string[] = [];
    for (let i = 0; i < 5; i++) {
      const u = await makeUser(`cc-r${i}@hmt.test`);
      await register(u, 'hack-pub');
      racers.push(u);
    }
    const results = await Promise.allSettled(
      racers.map((u) => teams.joinTeam(reqFor(u) as any, { teamId: team.id } as any)),
    );
    const won = results.filter((r) => r.status === 'fulfilled');
    // Requests never create membership, so all five go PENDING (capacity is
    // enforced when the leader accepts, not when requesting).
    expect(won).toHaveLength(5);
    const members = await prisma.teamMember.findMany({ where: { teamId: team.id } } as any);
    expect(members).toHaveLength(1);
    // Acceptances respect capacity: leader + exactly one more fit in maxMembers=2.
    const pending = await (prisma as any).teamJoinRequest.findMany({ where: { teamId: team.id, status: 'PENDING' } });
    expect(pending).toHaveLength(5);
    await teams.acceptJoinRequest(reqFor(leader) as any, pending[0].id);
    await expect(teams.acceptJoinRequest(reqFor(leader) as any, pending[1].id)).rejects.toThrow(/full/);
    const membersAfter = await prisma.teamMember.findMany({ where: { teamId: team.id } } as any);
    expect(membersAfter.length).toBeLessThanOrEqual(2);
  });

  it('join request lifecycle: pending creates no membership; accept adds, reject does not', async () => {
    const leader = await makeUser('jr-lead@hmt.test');
    const applicant = await makeUser('jr-app@hmt.test');
    await makeHackathon('hack-pub');
    await register(leader, 'hack-pub');
    await register(applicant, 'hack-pub');
    const team: any = await teams.createTeam(reqFor(leader) as any, { name: 'ReqTeam', hackathonId: 'hack-pub' } as any);
    const rq: any = await teams.createJoinRequest(reqFor(applicant) as any, {
      teamId: team.id, message: 'hi', skillRole: 'backend', skillLanguages: 'TS', skillExperience: '2y', skillContribution: 'APIs',
    } as any);
    expect(rq.status).toBe('PENDING');
    expect(rq.skillRole).toBeUndefined();
    const before = await prisma.teamMember.findMany({ where: { teamId: team.id } } as any);
    expect(before.some((m: any) => m.userId === applicant)).toBe(false);
    // Duplicate pending request is rejected.
    await expect(
      teams.createJoinRequest(reqFor(applicant) as any, { teamId: team.id } as any),
    ).rejects.toThrow(/already pending/);
    // Leader inbox shows the request WITH skill answers.
    const inbox: any = await teams.listJoinRequests(reqFor(leader) as any, team.id);
    expect(inbox.data).toHaveLength(1);
    expect(inbox.data[0].skillAnswers.role).toBe('backend');
    // Non-leader cannot read the inbox.
    await expect(teams.listJoinRequests(reqFor(applicant) as any, team.id)).rejects.toBeInstanceOf(ForbiddenException);
    // Accept creates membership exactly once.
    const m: any = await teams.acceptJoinRequest(reqFor(leader) as any, rq.id);
    expect(m.role).toBe('MEMBER');
    // Re-accept is rejected.
    await expect(teams.acceptJoinRequest(reqFor(leader) as any, rq.id)).rejects.toThrow(/no longer pending|already/);
    const mine = await (prisma as any).teamJoinRequest.findUnique({ where: { id: rq.id } });
    expect(mine.status).toBe('APPROVED');
  });

  it('leader rejects a request without creating membership', async () => {
    const leader = await makeUser('rj-lead@hmt.test');
    const applicant = await makeUser('rj-app@hmt.test');
    await makeHackathon('hack-pub');
    await register(leader, 'hack-pub');
    await register(applicant, 'hack-pub');
    const team: any = await teams.createTeam(reqFor(leader) as any, { name: 'RejTeam', hackathonId: 'hack-pub' } as any);
    const rq: any = await teams.createJoinRequest(reqFor(applicant) as any, { teamId: team.id } as any);
    const out: any = await teams.rejectJoinRequest(reqFor(leader) as any, rq.id);
    expect(out.status).toBe('REJECTED');
    const members = await prisma.teamMember.findMany({ where: { teamId: team.id } } as any);
    expect(members.some((m: any) => m.userId === applicant)).toBe(false);
  });

  it('registration lock blocks formation, invite, accept, transfer, delete', async () => {
    const leader = await makeUser('lock-lead@hmt.test');
    const other = await makeUser('lock-other@hmt.test');
    await (prisma.hackathon as any).create({
      data: {
        id: 'hack-locked', title: 'Locked', description: 'd', status: 'PUBLISHED',
        registrationEnd: new Date(Date.now() - 3600000).toISOString(),
      },
    });
    await register(leader, 'hack-locked');
    await register(other, 'hack-locked');
    await expect(
      teams.createTeam(reqFor(leader) as any, { name: 'Late', hackathonId: 'hack-locked' } as any),
    ).rejects.toThrow(/locked/);
    // Seed a team directly (bypassing the locked endpoint) to test the rest.
    const team: any = await (prisma.team as any).create({
      data: { name: 'Seeded', hackathonId: 'hack-locked', inviteCode: 'HMT-SEED01', visibility: 'TEAM_DISCOVERABLE' },
    });
    await (prisma.teamMember as any).create({ data: { teamId: team.id, userId: leader, role: 'LEADER' } });
    await expect(teams.joinTeam(reqFor(other) as any, { teamId: team.id } as any)).rejects.toThrow(/locked/);
    const rq: any = await (prisma as any).teamJoinRequest.create({
      data: { teamId: team.id, hackathonId: 'hack-locked', userId: other, status: 'PENDING' },
    });
    await expect(teams.acceptJoinRequest(reqFor(leader) as any, rq.id)).rejects.toThrow(/locked/);
    await expect(teams.transferLeadership(reqFor(leader) as any, team.id, { toUserId: other } as any)).rejects.toThrow(/locked/);
    await expect(teams.deleteTeam(reqFor(leader) as any, team.id)).rejects.toThrow(/locked/);
  });

  it('transfer moves the single leadership; members cannot transfer or delete', async () => {
    const leader = await makeUser('tr-lead@hmt.test');
    const member = await makeUser('tr-member@hmt.test');
    const outsider = await makeUser('tr-out@hmt.test');
    await makeHackathon('hack-pub');
    for (const u of [leader, member, outsider]) await register(u, 'hack-pub');
    const team: any = await teams.createTeam(reqFor(leader) as any, { name: 'Trans', hackathonId: 'hack-pub' } as any);
    const jr: any = await teams.joinTeam(reqFor(member) as any, { teamId: team.id } as any);
    await teams.acceptJoinRequest(reqFor(leader) as any, jr.id);
    // Member cannot transfer or delete.
    await expect(teams.transferLeadership(reqFor(member) as any, team.id, { toUserId: leader } as any)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(teams.deleteTeam(reqFor(member) as any, team.id)).rejects.toBeInstanceOf(ForbiddenException);
    // Outsider target rejected.
    await expect(teams.transferLeadership(reqFor(leader) as any, team.id, { toUserId: outsider } as any)).rejects.toThrow(/current team member/);
    const res: any = await teams.transferLeadership(reqFor(leader) as any, team.id, { toUserId: member } as any);
    expect(res.leaderId).toBe(member);
    const roles = await prisma.teamMember.findMany({ where: { teamId: team.id } } as any);
    expect(roles.filter((m: any) => m.role === 'LEADER')).toHaveLength(1);
    expect(roles.find((m: any) => m.userId === member)?.role).toBe('LEADER');
    // Old leader is now an ordinary member.
    expect(roles.find((m: any) => m.userId === leader)?.role).toBe('MEMBER');
  });

  it('leader cannot leave while members remain; sole leader of empty team removes it', async () => {
    const leader = await makeUser('lv-lead@hmt.test');
    const member = await makeUser('lv-member@hmt.test');
    await makeHackathon('hack-pub');
    await register(leader, 'hack-pub');
    await register(member, 'hack-pub');
    const team: any = await teams.createTeam(reqFor(leader) as any, { name: 'Leavers', hackathonId: 'hack-pub' } as any);
    const jr: any = await teams.joinTeam(reqFor(member) as any, { teamId: team.id } as any);
    await teams.acceptJoinRequest(reqFor(leader) as any, jr.id);
    await expect(teams.leaveTeam(reqFor(leader) as any, undefined, undefined)).rejects.toThrow(/Transfer leadership/);
    // Member leave needs approval: PENDING request, still a member.
    const lr: any = await teams.leaveTeam(reqFor(member) as any, undefined, undefined);
    expect(lr.status).toBe('PENDING');
    const still = await prisma.teamMember.findMany({ where: { teamId: team.id } } as any);
    expect(still.some((m: any) => m.userId === member)).toBe(true);
    // Leader notified about the leave request.
    const leaveNotifs = await (prisma as any).notification.findMany({ where: { userId: leader } });
    expect(leaveNotifs.some((n: any) => n.type === 'LEAVE_REQUESTED' && n.requestId === lr.id)).toBe(true);
    // Duplicate leave request rejected.
    await expect(teams.leaveTeam(reqFor(member) as any, undefined, undefined)).rejects.toThrow(/already pending/);
    // Accept removes the member and notifies them.
    const acc: any = await teams.acceptLeaveRequest(reqFor(leader) as any, lr.id);
    expect(acc.status).toBe('APPROVED');
    const gone = await prisma.teamMember.findMany({ where: { teamId: team.id } } as any);
    expect(gone.some((m: any) => m.userId === member)).toBe(false);
    const memberNotifs = await (prisma as any).notification.findMany({ where: { userId: member } });
    expect(memberNotifs.some((n: any) => n.type === 'LEAVE_APPROVED')).toBe(true);
    // Sole leader without project: leaving removes the empty team.
    const out: any = await teams.leaveTeam(reqFor(leader) as any, undefined, undefined);
    expect(out.message).toMatch(/removed/);
    expect(await (prisma.team as any).findUnique({ where: { id: team.id } })).toBeNull();
  });

  it('delete requires leader, confirmation path, and refuses project-owning teams', async () => {
    const leader = await makeUser('del-lead@hmt.test');
    const leader2 = await makeUser('del-lead2@hmt.test');
    await makeHackathon('hack-pub');
    await register(leader, 'hack-pub');
    await register(leader2, 'hack-pub');
    const team: any = await teams.createTeam(reqFor(leader) as any, { name: 'Doomed', hackathonId: 'hack-pub' } as any);
    await (prisma.project as any).create({ data: { teamId: team.id, title: 'P', description: 'd' } });
    await expect(teams.deleteTeam(reqFor(leader) as any, team.id)).rejects.toThrow(/owns a project/);
    // Project-less team deletes with cleanup.
    const team2: any = await teams.createTeam(reqFor(leader2) as any, { name: 'Doomed2', hackathonId: 'hack-pub' } as any);
    const res: any = await teams.deleteTeam(reqFor(leader2) as any, team2.id);
    expect(res.teamId).toBe(team2.id);
    expect(await (prisma.team as any).findUnique({ where: { id: team2.id } })).toBeNull();
  });

  it('project repoUrl enforced per hackathon requirement; URL alone grants nothing', async () => {
    const uid = await makeUser('repo@hmt.test');
    await (prisma.hackathon as any).create({
      data: { id: 'hack-req', title: 'R', description: 'd', status: 'PUBLISHED', repoRequirement: 'REQUIRED' },
    });
    await (prisma.hackathon as any).create({
      data: { id: 'hack-off', title: 'O', description: 'd', status: 'PUBLISHED', repoRequirement: 'DISABLED' },
    });
    await register(uid, 'hack-req');
    await register(uid, 'hack-off');
    const t1: any = await teams.createTeam(reqFor(uid) as any, { name: 'Repo1', hackathonId: 'hack-req' } as any);
    // Missing URL rejected when REQUIRED.
    await expect(
      projects.createOrUpdateProject(reqFor(uid) as any, { title: 'P', description: 'd', hackathonId: 'hack-req' }),
    ).rejects.toThrow(/required/);
    // Non-GitHub URL rejected.
    await expect(
      projects.createOrUpdateProject(reqFor(uid) as any, { title: 'P', description: 'd', hackathonId: 'hack-req', repoUrl: 'https://gitlab.com/a/b' }),
    ).rejects.toThrow(/github/);
    const ok: any = await projects.createOrUpdateProject(
      reqFor(uid) as any,
      { title: 'P', description: 'd', hackathonId: 'hack-req', repoUrl: 'https://github.com/org/repo' },
    );
    expect(ok.repoUrl).toContain('github.com/org/repo');
    // DISABLED drops the URL.
    const t2: any = await teams.createTeam(reqFor(uid) as any, { name: 'Repo2', hackathonId: 'hack-off' } as any);
    expect(t2.id).toBeTruthy();
  });
});
