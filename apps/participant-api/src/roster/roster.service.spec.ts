import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { NOT_ON_LIST, RosterService } from './roster.service';

describe('RosterService', () => {
  let prisma: PrismaService;
  let roster: RosterService;
  let hackathonId: string;
  const auth = { startSession: async (user: any) => ({ user, accessToken: 'token' }) };
  const teams = [
    { number: 1, name: 'Team Alpha', leadEmail: 'Lead@Example.com', members: ['Asha Rao', 'Bilal Khan'] },
    { number: 35, name: 'Team Beta', leadEmail: 'shared@example.com', members: ['Chen Li'] },
    { number: 37, name: 'Team Gamma', leadEmail: 'shared@example.com', members: ['Chen Li'] },
  ];

  beforeEach(async () => {
    prisma = new PrismaService();
    roster = new RosterService(prisma, auth as any);
    const hackathon: any = await (prisma.hackathon as any).create({ data: { title: 'Ideathon 2026', status: 'PUBLISHED', isPublished: true } });
    hackathonId = hackathon.id;
  });

  it('imports teams with registered members and is idempotent on re-import', async () => {
    expect(await roster.import(hackathonId, teams)).toEqual({ teams: 3, members: 4 });
    await roster.import(hackathonId, [{ ...teams[0]!, name: 'Team Alpha X', members: ['Asha Rao', 'Bilal K.'] }]);

    const all = (await prisma.team.findMany({ where: { hackathonId } } as any)) as any[];
    expect(all).toHaveLength(3);
    const lookup = await roster.lookup(' lead@example.com ');
    expect(lookup.teams).toEqual([
      { id: expect.any(String), number: 1, name: 'Team Alpha X', members: [
        { id: expect.stringMatching(/_1_1$/), name: 'Asha Rao' },
        { id: expect.stringMatching(/_1_2$/), name: 'Bilal K.' },
      ] },
    ]);
    const leader = lookup.teams[0]!.members[0]!.id;
    expect(await (prisma as any).registration.findFirst({ where: { userId: leader, hackathonId } })).toMatchObject({ teamId: lookup.teams[0]!.id });
    expect(await prisma.teamMember.findFirst({ where: { userId: leader } } as any)).toMatchObject({ role: 'LEADER' });
  });

  it('returns every team that shares a lead email', async () => {
    await roster.import(hackathonId, teams);
    expect((await roster.lookup('shared@example.com')).teams.map((t) => t.name)).toEqual(['Team Beta', 'Team Gamma']);
  });

  it('enters only a member of a team led by that email', async () => {
    await roster.import(hackathonId, teams);
    const alpha = (await roster.lookup('lead@example.com')).teams[0]!;
    const outsider = (await roster.lookup('shared@example.com')).teams[0]!.members[0]!;

    expect(await roster.enter('LEAD@example.com', alpha.members[1]!.id)).toMatchObject({ user: { fullName: 'Bilal Khan' }, accessToken: 'token' });
    await expect(roster.enter('lead@example.com', outsider.id)).rejects.toThrow(NOT_ON_LIST);
  });

  it('rejects emails that are not on the list', async () => {
    await roster.import(hackathonId, teams);
    await expect(roster.lookup('stranger@example.com')).rejects.toBeInstanceOf(NotFoundException);
    await expect(roster.lookup('')).rejects.toThrow(NOT_ON_LIST);
  });
});
