import { Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import * as argon2 from 'argon2';
import { Role } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { AuthService } from '../auth/auth.service';
import { RosterTeamDto } from './roster.dto';

export const NOT_ON_LIST = "This email isn't on the shortlist. Please go to the help desk.";

@Injectable()
export class RosterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
  ) {}

  async import(hackathonId: string, teams: RosterTeamDto[]) {
    const hackathon = await this.prisma.hackathon.findUnique({ where: { id: hackathonId } } as any);
    if (!hackathon) throw new NotFoundException('Hackathon is not published to participants yet');
    const existing = (await this.prisma.team.findMany({ where: { hackathonId } } as any)) as any[];
    const unusablePasswordHash = await argon2.hash(randomBytes(32).toString('hex'), { type: argon2.argon2id });
    let members = 0;
    for (const entry of teams) {
      const fields = {
        name: entry.name.trim(),
        leadEmail: entry.leadEmail.trim().toLowerCase(),
        rosterNumber: entry.number,
        slot: entry.slot ?? null,
        date: entry.date ?? null,
      };
      let team = existing.find((t) => t.rosterNumber === entry.number);
      if (team) {
        await this.prisma.team.update({ where: { id: team.id }, data: fields } as any);
      } else {
        team = await this.prisma.team.create({
          data: { ...fields, hackathonId, maxMembers: 4, isDiscoverable: false, visibility: 'TEAM_PRIVATE' },
        } as any);
      }
      for (const [index, fullName] of entry.members.entries()) {
        await this.upsertMember(hackathonId, team.id, entry.number, index, fullName.trim(), unusablePasswordHash);
        members++;
      }
    }
    return { teams: teams.length, members };
  }

  async lookup(email: string) {
    const teams = await this.teamsFor(email);
    return {
      teams: await Promise.all(
        teams.map(async (t) => ({ id: t.id, number: t.rosterNumber, name: t.name, members: await this.membersOf(t.id) })),
      ),
    };
  }

  async enter(email: string, memberId: string) {
    for (const team of await this.teamsFor(email)) {
      if ((await this.membersOf(team.id)).some((m) => m.id === memberId)) {
        return this.auth.startSession(await this.prisma.user.findUnique({ where: { id: memberId } } as any));
      }
    }
    throw new NotFoundException(NOT_ON_LIST);
  }

  private async teamsFor(rawEmail: string) {
    const email = String(rawEmail ?? '').trim().toLowerCase();
    const all = (await this.prisma.team.findMany({} as any)) as any[];
    const teams = email ? all.filter((t) => t.leadEmail === email) : [];
    if (!teams.length) throw new NotFoundException(NOT_ON_LIST);
    return teams.sort((a, b) => a.rosterNumber - b.rosterNumber);
  }

  private async membersOf(teamId: string) {
    const members = (await this.prisma.teamMember.findMany({ where: { teamId }, include: { user: true } } as any)) as any[];
    return members.filter((m) => m.user).map((m) => ({ id: m.userId as string, name: m.user.fullName as string }));
  }

  private async upsertMember(hackathonId: string, teamId: string, number: number, index: number, fullName: string, passwordHash: string) {
    const scope = hackathonId.slice(0, 8);
    const id = `roster_${scope}_${number}_${index + 1}`;
    const user = await this.prisma.user.findUnique({ where: { id } } as any);
    if (!user) {
      await this.prisma.user.create({
        data: {
          id,
          email: `team${number}.member${index + 1}.${scope}@roster.hmt`,
          passwordHash,
          fullName,
          role: Role.PARTICIPANT,
          isPhoneVerified: true,
          profile: { create: { bio: '', skills: [] } },
        },
      } as any);
    } else if (user.fullName !== fullName) {
      await this.prisma.user.update({ where: { id }, data: { fullName } } as any);
    }
    if (!(await this.prisma.teamMember.findFirst({ where: { teamId, userId: id } } as any))) {
      await this.prisma.teamMember.create({ data: { teamId, userId: id, role: index === 0 ? 'LEADER' : 'MEMBER' } } as any);
    }
    if (!(await (this.prisma as any).registration.findFirst({ where: { userId: id, hackathonId } }))) {
      await (this.prisma as any).registration.create({
        data: { hackathonId, userId: id, status: 'REGISTERED', teamChoice: 'create', teamId, eligibilityAccepted: true },
      });
    }
  }
}
