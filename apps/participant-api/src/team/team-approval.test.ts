import { describe, it, expect, beforeEach } from 'vitest';
import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { PrivacyService } from '../privacy/privacy.service';
import { TeamController } from './team.controller';
import { NotificationsController } from '../notifications/notifications.controller';

const neo4jStub = { write: async () => undefined };

function reqFor(userId: string) {
  return { user: { id: userId, role: 'PARTICIPANT' } };
}

describe('team approval workflows — notifications, join/leave requests', () => {
  let prisma: PrismaService;
  let teams: TeamController;
  let notifs: NotificationsController;

  beforeEach(() => {
    prisma = new PrismaService();
    teams = new TeamController(prisma, neo4jStub as any, new PrivacyService());
    notifs = new NotificationsController(prisma);
  });

  async function makeUser(email: string) {
    const u: any = await (prisma.user as any).create({
      data: { email, passwordHash: 'x', fullName: email },
    });
    return u.id as string;
  }

  async function setup() {
    const leader = await makeUser('ap-lead@hmt.test');
    const member = await makeUser('ap-member@hmt.test');
    const outsider = await makeUser('ap-out@hmt.test');
    await (prisma.hackathon as any).create({
      data: { id: 'hack-ap', title: 'H', description: 'd', status: 'PUBLISHED' },
    });
    for (const u of [leader, member, outsider]) {
      await (prisma as any).registration.create({
        data: { userId: u, hackathonId: 'hack-ap', status: 'REGISTERED', teamChoice: 'later' },
      });
    }
    const team: any = await teams.createTeam(reqFor(leader) as any, { name: 'Appr', hackathonId: 'hack-ap' } as any);
    const jr: any = await teams.joinTeam(reqFor(member) as any, { teamId: team.id } as any);
    await teams.acceptJoinRequest(reqFor(leader) as any, jr.id);
    return { leader, member, outsider, team };
  }

  it('leader inbox: notification list, unread count, read persistence', async () => {
    const { leader, member, team } = await setup();
    // Join flow produced exactly one JOIN_REQUESTED + one JOIN_APPROVED.
    const count: any = await notifs.unreadCount(reqFor(leader) as any);
    expect(count.count).toBe(1);
    const list: any = await notifs.list(reqFor(leader) as any);
    expect(list.data).toHaveLength(1);
    expect(list.data[0].type).toBe('JOIN_REQUESTED');
    expect(list.data[0].teamId).toBe(team.id);
    expect(list.data[0].requestKind).toBe('JOIN');
    expect(list.data[0].read).toBe(false);
    // Requester got the approval notice.
    const mCount: any = await notifs.unreadCount(reqFor(member) as any);
    expect(mCount.count).toBe(1);
    // Read persists across re-reads.
    await notifs.markRead(reqFor(leader) as any, list.data[0].id);
    const after: any = await notifs.unreadCount(reqFor(leader) as any);
    expect(after.count).toBe(0);
    const relist: any = await notifs.list(reqFor(leader) as any);
    expect(relist.data[0].read).toBe(true);
    // Cannot mark another user's notification.
    await expect(notifs.markRead(reqFor(member) as any, list.data[0].id)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('no duplicate notifications when the same request is retried', async () => {
    const { leader, outsider, team } = await setup();
    const first: any = await teams.joinTeam(reqFor(outsider) as any, { teamId: team.id } as any);
    await expect(teams.joinTeam(reqFor(outsider) as any, { teamId: team.id } as any)).rejects.toThrow(/already pending/);
    const rows = await (prisma as any).notification.findMany({ where: { userId: leader, type: 'JOIN_REQUESTED' } });
    const forReq = rows.filter((n: any) => n.requestId === first.id);
    expect(forReq).toHaveLength(1);
  });

  it('unauthorized users cannot accept/reject; requesters cannot self-approve', async () => {
    const { leader, member, outsider, team } = await setup();
    const jr: any = await teams.joinTeam(reqFor(outsider) as any, { teamId: team.id } as any);
    await expect(teams.acceptJoinRequest(reqFor(member) as any, jr.id)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(teams.rejectJoinRequest(reqFor(member) as any, jr.id)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(teams.acceptJoinRequest(reqFor(outsider) as any, jr.id)).rejects.toBeInstanceOf(ForbiddenException);
    // Still pending and untouched.
    const fresh: any = await (prisma as any).teamJoinRequest.findUnique({ where: { id: jr.id } });
    expect(fresh.status).toBe('PENDING');
    // Leader accepts normally afterwards.
    await teams.acceptJoinRequest(reqFor(leader) as any, jr.id);
    expect((await (prisma as any).teamJoinRequest.findUnique({ where: { id: jr.id } })).status).toBe('APPROVED');
  });

  it('leave reject keeps the member; cancel works for the requester only', async () => {
    // Fresh setup for isolation.
    const s2 = await freshSetup();
    const r1: any = await teams.createLeaveRequest(reqFor(s2.member) as any, { teamId: s2.team.id } as any);
    expect(r1.status).toBe('PENDING');
    // Outsider cannot cancel another member's request.
    await expect(teams.cancelLeaveRequest(reqFor(s2.outsider) as any, r1.id)).rejects.toBeInstanceOf(ForbiddenException);
    // Leader rejects → member stays.
    await teams.rejectLeaveRequest(reqFor(s2.leader) as any, r1.id);
    const stayed = await prisma.teamMember.findMany({ where: { teamId: s2.team.id } } as any);
    expect(stayed.some((m: any) => m.userId === s2.member)).toBe(true);
    // New request → requester cancels → still a member, request CANCELLED.
    const r2: any = await teams.createLeaveRequest(reqFor(s2.member) as any, { teamId: s2.team.id } as any);
    await teams.cancelLeaveRequest(reqFor(s2.member) as any, r2.id);
    expect((await (prisma as any).teamLeaveRequest.findUnique({ where: { id: r2.id } })).status).toBe('CANCELLED');
    expect((await prisma.teamMember.findMany({ where: { teamId: s2.team.id } } as any)).some((m: any) => m.userId === s2.member)).toBe(true);
    // Leader inbox for leave shows pending only.
    const inbox: any = await teams.listLeaveRequests(reqFor(s2.leader) as any, s2.team.id);
    expect(inbox.data).toHaveLength(0);
  });

  async function freshSetup() {
    const leader = await makeUser(`fr-l-${Date.now()}@hmt.test`);
    const member = await makeUser(`fr-m-${Date.now()}@hmt.test`);
    const outsider = await makeUser(`fr-o-${Date.now()}@hmt.test`);
    await (prisma.hackathon as any).create({
      data: { id: 'hack-ap', title: 'H', description: 'd', status: 'PUBLISHED' },
    });
    for (const u of [leader, member, outsider]) {
      await (prisma as any).registration.create({
        data: { userId: u, hackathonId: 'hack-ap', status: 'REGISTERED', teamChoice: 'later' },
      });
    }
    const team: any = await teams.createTeam(reqFor(leader) as any, { name: `F${Date.now()}`, hackathonId: 'hack-ap' } as any);
    const jr: any = await teams.joinTeam(reqFor(member) as any, { teamId: team.id } as any);
    await teams.acceptJoinRequest(reqFor(leader) as any, jr.id);
    return { leader, member, outsider, team };
  }

  it('registration lock blocks leave requests and leave acceptance', async () => {
    const leader = await makeUser('lk-lead@hmt.test');
    const member = await makeUser('lk-member@hmt.test');
    await (prisma.hackathon as any).create({
      data: { id: 'hack-lk', title: 'L', description: 'd', status: 'PUBLISHED' },
    });
    for (const u of [leader, member]) {
      await (prisma as any).registration.create({
        data: { userId: u, hackathonId: 'hack-lk', status: 'REGISTERED', teamChoice: 'later' },
      });
    }
    const team: any = await teams.createTeam(reqFor(leader) as any, { name: 'Lk', hackathonId: 'hack-lk' } as any);
    const jr: any = await teams.joinTeam(reqFor(member) as any, { teamId: team.id } as any);
    await teams.acceptJoinRequest(reqFor(leader) as any, jr.id);
    const lr: any = await teams.createLeaveRequest(reqFor(member) as any, { teamId: team.id } as any);
    expect(lr.status).toBe('PENDING');
    // Close registration (organizer-controlled timestamp, server clock).
    const h: any = await (prisma.hackathon as any).findUnique({ where: { id: 'hack-lk' } });
    h.registrationEnd = new Date(Date.now() - 1000).toISOString();
    await expect(teams.createLeaveRequest(reqFor(member) as any, { teamId: team.id } as any)).rejects.toThrow(/locked|already pending/);
    await expect(teams.acceptLeaveRequest(reqFor(leader) as any, lr.id)).rejects.toThrow(/locked/);
    // Membership unchanged by the blocked accept.
    const members = await prisma.teamMember.findMany({ where: { teamId: team.id } } as any);
    expect(members.some((m: any) => m.userId === member)).toBe(true);
    // New join requests also blocked.
    const other = await makeUser('lk-other@hmt.test');
    await (prisma as any).registration.create({
      data: { userId: other, hackathonId: 'hack-lk', status: 'REGISTERED', teamChoice: 'later' },
    });
    await expect(teams.joinTeam(reqFor(other) as any, { teamId: team.id } as any)).rejects.toThrow(/locked/);
  });

  it('leader cannot file a leave request (transfer-first); cross-hackathon requests rejected', async () => {
    const { leader, team } = await setup();
    await expect(teams.createLeaveRequest(reqFor(leader) as any, { teamId: team.id } as any)).rejects.toThrow(/Transfer leadership/);
    // Cross-hackathon: outsider registered elsewhere requests against this team.
    const x = await makeUser('ap-x@hmt.test');
    await (prisma.hackathon as any).create({
      data: { id: 'hack-x', title: 'X', description: 'd', status: 'PUBLISHED' },
    });
    await (prisma as any).registration.create({
      data: { userId: x, hackathonId: 'hack-x', status: 'REGISTERED', teamChoice: 'later' },
    });
    await expect(teams.joinTeam(reqFor(x) as any, { teamId: team.id } as any)).rejects.toBeInstanceOf(ForbiddenException);
  });
});
