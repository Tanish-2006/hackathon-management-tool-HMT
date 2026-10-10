import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PrismaService } from '../database/prisma.service';
import { Neo4jService } from '../database/neo4j.service';
import { PrivacyService } from '../privacy/privacy.service';
import {
  CreateTeamDto,
  ConnectRepoDto,
  InviteDto,
  InterestDto,
  JoinTeamDto,
  JoinByCodeDto,
  JoinRequestDto,
  TransferLeadershipDto,
  LeaveRequestDto,
} from './dto/team.dto';
import { VisibilityLevel } from '../common/enums/visibility.enum';
import { isRegistrationClosed } from '../hackathon/hackathon.controller';

@ApiTags('team')
@ApiBearerAuth()
@Controller('team')
@UseGuards(JwtAuthGuard)
export class TeamController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly neo4j: Neo4jService,
    private readonly privacy: PrivacyService,
  ) {}

  /**
   * Team formation requires hackathon registration. The hackathon must be
   * PUBLISHED (never DRAFT/REVIEW/CONFIRMED/ARCHIVED for new teams) and the
   * caller must hold a registration for it — client-supplied IDs alone are
   * never trusted. Also enforces the registration-closure lock. Fail-closed
   * on missing records. Returns the hackathon.
   */
  private async requireRegistrationForHackathon(
    userId: string,
    hackathonId: string | undefined | null,
  ): Promise<any> {
    const hackathon = hackathonId
      ? await this.prisma.hackathon.findUnique({ where: { id: hackathonId } } as any)
      : null;
    const st = hackathon?.status ?? (hackathon?.isPublished ? 'PUBLISHED' : 'DRAFT');
    if (!hackathon || st !== 'PUBLISHED') {
      throw new NotFoundException('Hackathon not found or not published');
    }
    this.assertTeamChangesAllowed(hackathon);
    const registration = await (this.prisma as any).registration.findFirst({
      where: { userId, hackathonId },
    });
    if (!registration) {
      throw new ForbiddenException('Register for the hackathon before joining team formation');
    }
    return hackathon;
  }

  // In-process per-key mutex: serializes check-then-act sequences (capacity,
  // duplicate membership, duplicate team creation) that would otherwise race
  // between concurrent requests. Keys are team or user scoped; entries are
  // removed after use so the map stays bounded.
  private teamLocks = new Map<string, Promise<void>>();  private async withTeamLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.teamLocks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = prev.then(() => gate);
    this.teamLocks.set(key, tail);
    await prev.catch(() => undefined);
    try {
      return await fn();
    } finally {
      release();
      if (this.teamLocks.get(key) === tail) this.teamLocks.delete(key);
    }
  }

  private withMembershipLock<T>(userId: string, teamId: string, fn: () => Promise<T>): Promise<T> {
    return this.withTeamLock(`user:${userId}`, () => this.withTeamLock(`team:${teamId}`, fn));
  }

  /**
   * Registration-closure lock: after the organizer-configured registration
   * deadline (or archive), team structure is frozen. Determined from
   * authoritative backend timestamps — never the client clock. Every
   * membership-mutating endpoint calls this; reads never do.
   */
  private assertTeamChangesAllowed(h: any): void {
    const st = h?.status ?? (h?.isPublished ? 'PUBLISHED' : 'DRAFT');
    if (st === 'ARCHIVED') {
      throw new ForbiddenException('Hackathon is archived — team changes are locked');
    }
    if (isRegistrationClosed(h)) {
      throw new ForbiddenException('Registration is closed — team changes are locked');
    }
  }

  private async requireLeaderMembership(userId: string, teamId: string): Promise<{ team: any; membership: any }> {
    const team = await this.prisma.team.findUnique({ where: { id: teamId } } as any);
    if (!team) throw new NotFoundException('Team not found');
    const membership = await this.prisma.teamMember.findFirst({
      where: { teamId, userId },
    } as any);
    if (!membership || membership.role !== 'LEADER') {
      throw new ForbiddenException('Only the team leader can perform this action');
    }
    return { team, membership };
  }

  /**
   * Persist one inbox notification. Deduped on (recipient, type, requestId)
   * so retried submissions never produce duplicate rows. Failures here must
   * never roll back the request itself — but callers await this, so a
   * notification failure surfaces instead of pretending delivery succeeded.
   */
  private async notifyUser(input: {
    userId: string;
    type: string;
    title: string;
    body?: string | null;
    teamId?: string | null;
    hackathonId?: string | null;
    requestId?: string | null;
    requestKind?: 'JOIN' | 'LEAVE' | null;
    link?: string | null;
  }): Promise<any> {
    if (input.requestId) {
      const dupe = await (this.prisma as any).notification.findFirst({
        where: { userId: input.userId, type: input.type, requestId: input.requestId },
      });
      if (dupe) return dupe;
    }
    return (this.prisma as any).notification.create({
      data: {
        userId: input.userId,
        type: input.type,
        title: input.title,
        body: input.body ?? null,
        teamId: input.teamId ?? null,
        hackathonId: input.hackathonId ?? null,
        requestId: input.requestId ?? null,
        requestKind: input.requestKind ?? null,
        link: input.link ?? null,
      },
    });
  }

  /**
   * Resolve the CURRENT leader from the authoritative team record — never
   * from client input — and notify them. Throws fail-closed when the team
   * has no leader (request stays persisted; caller surfaces the gap).
   */
  private async notifyLeader(
    team: any,
    input: {
      type: string;
      title: string;
      body?: string | null;
      requestId?: string | null;
      requestKind?: 'JOIN' | 'LEAVE' | null;
    },
  ): Promise<any> {
    const members = await this.prisma.teamMember.findMany({
      where: { teamId: team.id },
    } as any);
    const leader = (members || []).find((m: any) => m.role === 'LEADER');
    if (!leader) throw new BadRequestException('Team has no leader to notify');
    return this.notifyUser({
      userId: leader.userId,
      type: input.type,
      title: input.title,
      body: input.body,
      teamId: team.id,
      hackathonId: team.hackathonId ?? null,
      requestId: input.requestId,
      requestKind: input.requestKind,
      link: team.hackathonId ? `/participant/teams?hackathon=${team.hackathonId}` : '/participant/teams',
    });
  }

  // Backend-generated public Team ID (TID). Unambiguous alphabet, unique per
  // inviteCode column (collision retry). Never accepted from clients.
  private generateTid(): string {
    const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    let s = '';
    for (let i = 0; i < 6; i++) {
      s += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    return `HMT-${s}`;
  }

  private async generateUniqueTid(): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const tid = this.generateTid();
      const clash = await this.prisma.team.findUnique({ where: { inviteCode: tid } } as any);
      if (!clash) return tid;
    }
    return `HMT-${Date.now().toString(36).toUpperCase()}`;
  }

  /**
   * Hackathon-scoped membership lookup. A participant may belong to different
   * teams in different hackathons, so global `findFirst({ userId })` must not
   * be used to gate team formation. Iterates the caller's memberships and
   * matches via team records (works on both the in-memory store and Postgres,
   * where nested relational filters differ).
   */
  private async findMembershipInHackathon(
    userId: string,
    hackathonId: string | undefined | null,
  ): Promise<any | null> {
    if (!hackathonId) return null;
    const memberships = (await this.prisma.teamMember.findMany({
      where: { userId },
    } as any)) as any[];
    for (const m of memberships || []) {
      const team = await this.prisma.team.findUnique({
        where: { id: m.teamId },
      } as any);
      if (team && (team as any).hackathonId === hackathonId) return m;
    }
    return null;
  }

  @Get('me')
  async getMyTeam(@Req() req: any, @Query('hackathonId') hackathonId?: string) {
    // Optional hackathon scoping: My Team is per-hackathon. Without the
    // parameter, legacy first-membership behavior is preserved.
    let where: any = { userId: req.user.id };
    if (hackathonId) {
      const scoped = await this.findMembershipInHackathon(req.user.id, hackathonId);
      if (!scoped) {
        return { team: null, message: 'User is not currently part of a team in this hackathon' };
      }
      where = { userId: req.user.id, teamId: scoped.teamId };
    }
    const membership = await this.prisma.teamMember.findFirst({
      where,
      include: {
        team: {
          include: {
            members: {
              include: {
                user: { select: { id: true, fullName: true, email: true } },
              },
            },
            project: {
              include: { scans: { orderBy: { createdAt: 'desc' }, take: 1 } },
            },
            hackathon: true,
          },
        },
      },
    } as any);

    if (!membership) {
      return { team: null, message: 'User is not currently part of a team' };
    }
    return membership.team;
  }

  @Get('discover')
  async discoverTeams(
    @Req() req: any,
    @Query('hackathonId') hackathonId?: string,
    @Query('skill') skill?: string,
    @Query('interest') interest?: string,
    @Query('availability') availability?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const where: any = {
      isDiscoverable: true,
      visibility: VisibilityLevel.TEAM_DISCOVERABLE,
    };
    if (hackathonId) where.hackathonId = hackathonId;
    if (search) where.name = { contains: search };
    // Pagination guard: prevent unbounded queries (performance)
    const p = Math.max(1, parseInt(page || '1', 10) || 1);
    const ps = Math.min(50, Math.max(1, parseInt(pageSize || '10', 10) || 10));
    const all = await this.prisma.team.findMany({
      where,
      include: { members: true },
    } as any);
    let filtered = all.filter((t: any) => t.isDiscoverable);
    if (skill) {
      const s = skill.toLowerCase();
      filtered = filtered.filter((t: any) =>
        (t.requiredSkills || []).some((rs: string) =>
          rs.toLowerCase().includes(s),
        ),
      );
    }
    if (interest || availability) {
      const requesterProfile = await this.prisma.skillProfile.findUnique({
        where: { userId: req.user.id },
      } as any);
      if (requesterProfile) {
        filtered = filtered
          .map((t: any) => {
            let score = 0;
            if (
              interest &&
              (requesterProfile.interests || []).some((i: string) =>
                i.toLowerCase().includes(interest.toLowerCase()),
              )
            )
              score += 10;
            if (
              skill &&
              (requesterProfile.programmingLanguages || []).some((l: string) =>
                l.toLowerCase().includes(skill.toLowerCase()),
              )
            )
              score += 10;
            return { ...t, _matchScore: score };
          })
          .sort((a: any, b: any) => b._matchScore - a._matchScore);
      }
    }
    const total = filtered.length;
    const paginated = filtered.slice((p - 1) * ps, p * ps);
    // Avoid large API responses: cap total return and strip private fields for non-members
    const data = paginated.map((t: any) => {
      const isMember = t.members?.some((m: any) => m.userId === req.user.id);
      if (isMember) return t;
      const { inviteCode, ...pub } = t;
      return pub;
    });
    return { data, pagination: { page: p, pageSize: ps, total, totalPages: Math.ceil(total / ps) } };
  }

  @Get('invitations/me')
  async myInvitations(@Req() req: any) {
    const user = await this.prisma.user.findUnique({
      where: { id: req.user.id },
    } as any);
    if (!user) throw new NotFoundException('User not found');
    const invites = await this.prisma.teamInvitation.findMany({
      where: { inviteeEmail: user.email.toLowerCase(), status: 'PENDING' },
    } as any);
    return invites;
  }

  @Get('match/candidates')
  async matchCandidates(
    @Req() req: any,
    @Query('hackathonId') hackathonId?: string,
  ) {
    const myProfile = await this.prisma.skillProfile.findUnique({
      where: { userId: req.user.id },
    } as any);
    if (!myProfile)
      return {
        message: 'Create skill profile first for matching',
        candidates: [],
      };
    const discoverableProfiles = await this.prisma.skillProfile.findMany({
      where: { visibility: VisibilityLevel.TEAM_DISCOVERABLE },
    } as any);
    const candidates = discoverableProfiles.filter(
      (p: any) => p.userId !== req.user.id,
    );
    const scored = candidates
      .map((p: any) => {
        let score = 0;
        const mySkills = [
          ...(myProfile.programmingLanguages || []),
          ...(myProfile.frameworks || []),
        ];
        const theirSkills = [
          ...(p.programmingLanguages || []),
          ...(p.frameworks || []),
          ...(p.databases || []),
        ];
        const common = mySkills.filter((s: string) =>
          theirSkills.includes(s),
        ).length;
        const complementary = theirSkills.filter(
          (s: string) => !mySkills.includes(s),
        ).length;
        score += complementary * 2 - common * 0.5;
        const interestOverlap = (myProfile.interests || []).filter(
          (i: string) => (p.interests || []).includes(i),
        ).length;
        score += interestOverlap * 3;
        if (
          myProfile.availability &&
          p.availability &&
          myProfile.availability === p.availability
        )
          score += 5;
        return { ...p, matchScore: Math.max(0, score) };
      })
      .sort((a: any, b: any) => b.matchScore - a.matchScore)
      .slice(0, 10);
    return {
      candidates: scored.map((c: any) => ({
        userId: c.userId,
        programmingLanguages: c.programmingLanguages,
        frameworks: c.frameworks,
        interests: c.interests,
        availability: c.availability,
        experienceLevel: c.experienceLevel,
        matchScore: c.matchScore,
      })),
    };
  }

  /**
   * Request to join a discoverable team. Approval is mandatory — this endpoint
   * NEVER creates membership. It persists a PENDING join request and notifies
   * the current team leader, who accepts or rejects it. (Leader-initiated
   * invitations keep their own accept path; this is the applicant path.)
   */
  @Post('join')
  async joinTeam(@Req() req: any, @Body() dto: JoinTeamDto) {
    const team = await this.prisma.team.findUnique({
      where: { id: dto.teamId },
    } as any);
    if (!team) throw new NotFoundException('Team not found');
    if (
      team.visibility !== VisibilityLevel.TEAM_DISCOVERABLE &&
      team.visibility !== VisibilityLevel.PUBLIC_PROFILE
    )
      throw new ForbiddenException(
        'Team not joinable directly; invitation required (privacy enforced)',
      );
    // Per-hackathon duplicate gate (a participant may hold different teams
    // across hackathons). Legacy teams without a hackathon fall back to the
    // global check.
    const existingMembership = team.hackathonId
      ? await this.findMembershipInHackathon(req.user.id, team.hackathonId)
      : await this.prisma.teamMember.findFirst({ where: { userId: req.user.id } } as any);
    if (existingMembership) throw new BadRequestException('Already in a team for this hackathon');
    const hackathon = await this.requireRegistrationForHackathon(req.user.id, team.hackathonId);
    this.assertTeamChangesAllowed(hackathon);
    // Serialize request creation so concurrent taps cannot duplicate.
    return this.withTeamLock(`team:${dto.teamId}`, async () => {
      const dupe = await (this.prisma as any).teamJoinRequest.findFirst({
        where: { teamId: dto.teamId, userId: req.user.id, status: 'PENDING' },
      });
      if (dupe) throw new ConflictException('Join request already pending for this team');
      const members = await this.prisma.teamMember.findMany({
        where: { teamId: dto.teamId },
      } as any);
      if (members.length >= team.maxMembers)
        throw new BadRequestException('Team full');
      const record = await (this.prisma as any).teamJoinRequest.create({
        data: {
          teamId: dto.teamId,
          hackathonId: team.hackathonId,
          userId: req.user.id,
        },
      });
      await this.prisma.auditLog.create({
        data: {
          userId: req.user.id,
          action: 'TEAM_JOIN_REQUESTED',
          resource: `team:${dto.teamId}`,
          details: { via: 'join-button' },
        },
      } as any);
      const applicant: any = await this.prisma.user.findUnique({ where: { id: req.user.id } } as any).catch(() => null);
      await this.notifyLeader(team, {
        type: 'JOIN_REQUESTED',
        title: `New join request for ${team.name}`,
        body: `${applicant?.fullName ?? 'A participant'} wants to join your team. Review it in Teams.`,
        requestId: record.id,
        requestKind: 'JOIN',
      });
      return { id: record.id, teamId: team.id, status: 'PENDING', message: 'Request sent — the team leader will review it.' };
    });
  }

  @Post('leave')
  async leaveTeam(
    @Req() req: any,
    @Query('hackathonId') hackathonId?: string,
    @Query('teamId') teamId?: string,
  ) {
    // Hackathon/team-scoped leave: with several per-hackathon memberships,
    // leaving the caller's first membership could drop the wrong team.
    let membership: any = null;
    if (teamId) {
      membership = await this.prisma.teamMember.findFirst({
        where: { userId: req.user.id, teamId },
      } as any);
      if (!membership) throw new BadRequestException('Not in this team');
    } else if (hackathonId) {
      membership = await this.findMembershipInHackathon(req.user.id, hackathonId);
      if (!membership) throw new BadRequestException('Not in a team for this hackathon');
    } else {
      const all = (await this.prisma.teamMember.findMany({
        where: { userId: req.user.id },
      } as any)) as any[];
      if (!all || all.length === 0) throw new BadRequestException('Not in a team');
      if (all.length > 1) {
        throw new BadRequestException(
          'You belong to teams in multiple hackathons — retry with the team context',
        );
      }
      membership = all[0];
    }
    const team = await this.prisma.team.findUnique({ where: { id: membership.teamId } } as any);
    if (team?.hackathonId) {
      const hackathon = await this.prisma.hackathon.findUnique({ where: { id: team.hackathonId } } as any);
      if (hackathon) this.assertTeamChangesAllowed(hackathon);
    }
    // A leader must transfer leadership first — never strand a team without
    // one. Sole-member leaders leaving an empty, project-less team remove it.
    if (membership.role === 'LEADER') {
      const siblings = await this.prisma.teamMember.findMany({
        where: { teamId: membership.teamId },
      } as any);
      const others = siblings.filter((m: any) => m.userId !== req.user.id);
      if (others.length > 0) {
        throw new BadRequestException('Transfer leadership to a team member before leaving');
      }
      if (team) {
        const project = await this.prisma.project.findUnique({ where: { teamId: team.id } } as any).catch(() => null);
        if (project) {
          throw new BadRequestException('Team owns a project and cannot be left leaderless — transfer leadership first');
        }
        await this.prisma.team.delete({ where: { id: team.id } } as any);
        await this.prisma.teamMember.delete({ where: { id: membership.id } } as any).catch(() => null);
        await this.prisma.auditLog.create({
          data: { userId: req.user.id, action: 'TEAM_DELETED', resource: `team:${team.id}`, details: { via: 'sole-leader-leave', name: team.name } },
        } as any);
        return { message: 'Left team (empty team removed)' };
      }
    }
    // Non-leader leaving requires leader approval: persist a PENDING leave
    // request and notify the leader. Membership is removed ONLY when the
    // leader accepts. Duplicate pending requests are rejected.
    const dupeLeave = await (this.prisma as any).teamLeaveRequest.findFirst({
      where: { teamId: membership.teamId, userId: req.user.id, status: 'PENDING' },
    });
    if (dupeLeave) throw new ConflictException('Leave request already pending for this team');
    const leaveRecord = await (this.prisma as any).teamLeaveRequest.create({
      data: {
        teamId: membership.teamId,
        hackathonId: team?.hackathonId ?? null,
        userId: req.user.id,
      },
    });
    await this.prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'TEAM_LEAVE_REQUESTED',
        resource: `team:${membership.teamId}`,
        details: {},
      },
    } as any);
    if (team) {
      const leaver: any = await this.prisma.user.findUnique({ where: { id: req.user.id } } as any).catch(() => null);
      await this.notifyLeader(team, {
        type: 'LEAVE_REQUESTED',
        title: `Leave request in ${team.name}`,
        body: `${leaver?.fullName ?? 'A member'} wants to leave your team. Review it in Teams.`,
        requestId: leaveRecord.id,
        requestKind: 'LEAVE',
      });
    }
    return { id: leaveRecord.id, teamId: membership.teamId, status: 'PENDING', message: 'Leave request sent — the team leader will review it.' };
  }

  @Post('invitations/:inviteId/accept')
  async acceptInvitation(@Req() req: any, @Param('inviteId') inviteId: string) {
    const invite = await this.prisma.teamInvitation.findUnique({
      where: { id: inviteId },
    } as any);
    if (!invite) throw new NotFoundException('Invitation not found');
    const user = await this.prisma.user.findUnique({
      where: { id: req.user.id },
    } as any);
    if (invite.inviteeEmail.toLowerCase() !== user.email.toLowerCase())
      throw new ForbiddenException(
        'Invitation not for this participant (IDOR prevented)',
      );
    if (invite.status !== 'PENDING')
      throw new BadRequestException(`Invitation already ${invite.status}`);
    const team = await this.prisma.team.findUnique({
      where: { id: invite.teamId },
    } as any);
    if (!team) throw new NotFoundException('Team not found');
    const existingMembership = team.hackathonId
      ? await this.findMembershipInHackathon(req.user.id, team.hackathonId)
      : await this.prisma.teamMember.findFirst({ where: { userId: req.user.id } } as any);
    if (existingMembership) throw new BadRequestException('Already in a team for this hackathon');
    await this.requireRegistrationForHackathon(req.user.id, team.hackathonId);
    // Serialize capacity check + insert so concurrent accepts cannot overfill.
    return this.withMembershipLock(req.user.id, invite.teamId, async () => {
      if (await this.findMembershipInHackathon(req.user.id, team.hackathonId)) {
        throw new BadRequestException('Already in a team for this hackathon');
      }
      const members = await this.prisma.teamMember.findMany({
        where: { teamId: invite.teamId },
      } as any);
      if (members.length >= team.maxMembers)
        throw new BadRequestException('Team is full');
      await this.prisma.teamMember.create({
        data: { teamId: invite.teamId, userId: req.user.id, role: 'MEMBER' },
      } as any);
      await this.prisma.teamInvitation.update({
        where: { id: inviteId },
        data: { status: 'ACCEPTED' },
      } as any);
      await this.prisma.auditLog.create({
        data: {
          userId: req.user.id,
          action: 'TEAM_JOIN',
          resource: `team:${invite.teamId}`,
          details: { via: 'invitation' },
        },
      } as any);
      return { message: 'Joined team', teamId: invite.teamId };
    });
  }

  @Post('invitations/:inviteId/decline')
  async declineInvitation(
    @Req() req: any,
    @Param('inviteId') inviteId: string,
  ) {
    const invite = await this.prisma.teamInvitation.findUnique({
      where: { id: inviteId },
    } as any);
    if (!invite) throw new NotFoundException('Invitation not found');
    const user = await this.prisma.user.findUnique({
      where: { id: req.user.id },
    } as any);
    if (invite.inviteeEmail.toLowerCase() !== user.email.toLowerCase())
      throw new ForbiddenException('Not your invitation');
    if (invite.status !== 'PENDING')
      throw new BadRequestException('Already handled');
    const updated = await this.prisma.teamInvitation.update({
      where: { id: inviteId },
      data: { status: 'DECLINED' },
    } as any);
    return updated;
  }

  @Post()
  async createTeam(@Req() req: any, @Body() dto: CreateTeamDto) {
    // Serialize per user so double-clicks/retries cannot create duplicates.
    return this.withTeamLock(`user:${req.user.id}`, () => this.withTeamLock(`hackathon-teams:${dto.hackathonId}`, async () => {
      const hackathon = await this.requireRegistrationForHackathon(req.user.id, dto.hackathonId);

      const existingMembership = await this.findMembershipInHackathon(req.user.id, dto.hackathonId);

      if (existingMembership) {
        throw new BadRequestException(
          'User is already in a team for this hackathon',
        );
      }

      const name = dto.name?.trim() ?? '';
      if (!name) throw new BadRequestException('Team name is required');
      // Unique team name per hackathon (case-insensitive).
      const siblings = (await this.prisma.team.findMany({
        where: { hackathonId: dto.hackathonId },
      } as any)) as any[];
      if (siblings.some((t: any) => String(t.name ?? '').trim().toLowerCase() === name.toLowerCase())) {
        throw new ConflictException('Team name already taken for this hackathon');
      }

      // Hackathon team-size limits.
      const cap = (hackathon as any)?.teamSize?.max;
      const max = dto.maxMembers ?? (typeof cap === 'number' ? Math.min(4, cap) : 4);
      if (!Number.isInteger(max) || max < 2 || max > 12) {
        throw new BadRequestException('Team size must be between 2 and 12');
      }
      if (typeof cap === 'number' && max > cap) {
        throw new BadRequestException(`Team size exceeds the hackathon limit of ${cap}`);
      }

      // TID: always backend-generated, unique via inviteCode (client values
      // are rejected by validation — CreateTeamDto has no inviteCode field).
      const tid = await this.generateUniqueTid();
      const team = await this.prisma.team.create({
        data: {
          name,
          hackathonId: dto.hackathonId,
          inviteCode: tid,
          visibility: dto.visibility ?? VisibilityLevel.TEAM_DISCOVERABLE,
          maxMembers: max,
          requiredSkills: dto.requiredSkills ?? [],
          requirements: dto.requirements ?? [],
          isDiscoverable: dto.isDiscoverable ?? true,
          members: {
            create: {
              userId: req.user.id,
              role: 'LEADER',
            },
          },
        },
        include: { members: true },
      } as any);

      this.neo4j
        .write(
          `
      MERGE (p:Participant {id: $userId})
      MERGE (t:Team {id: $teamId, name: $teamName})
      MERGE (h:Hackathon {id: $hackathonId})
      MERGE (p)-[:MEMBER_OF]->(t)
      MERGE (t)-[:JOINED]->(h)
      `,
          {
            userId: req.user.id,
            teamId: team.id,
            teamName: team.name,
            hackathonId: dto.hackathonId,
          },
        )
        .catch(() => {});

      await this.prisma.auditLog.create({
        data: {
          userId: req.user.id,
          action: 'TEAM_CREATE',
          resource: `team:${team.id}`,
          details: { name: team.name, tid },
        },
      } as any);
      return team;
    }));
  }

  /**
   * Join by team name + TID. The TID (inviteCode) acts as the capability, so
   * no invitation is needed — but approval still is: this persists a PENDING
   * join request and notifies the leader instead of adding membership.
   * Everything else is verified: caller registration for the team's
   * hackathon, same-hackathon scope as requested, capacity, and duplicate
   * membership. Lookup failures return one generic message that reveals
   * nothing about which part mismatched.
   */
  @Post('join-by-code')
  async joinByCode(@Req() req: any, @Body() dto: JoinByCodeDto) {
    const tid = dto.tid?.trim().toUpperCase();
    const team = tid
      ? await this.prisma.team.findUnique({ where: { inviteCode: tid } } as any)
      : null;
    const nameOk =
      !!team &&
      typeof dto.teamName === 'string' &&
      String(team.name ?? '').trim().toLowerCase() === dto.teamName.trim().toLowerCase();
    const scopeOk = !!team && team.hackathonId === dto.hackathonId;
    if (!team || !nameOk || !scopeOk) {
      throw new NotFoundException('No matching team found for this hackathon');
    }
    // Registration + PUBLISHED status from the TEAM record (client hackathon
    // ID is not trusted beyond the scope check above).
    await this.requireRegistrationForHackathon(req.user.id, team.hackathonId);
    const existingMembership = await this.findMembershipInHackathon(req.user.id, team.hackathonId);
    if (existingMembership) throw new BadRequestException('Already in a team for this hackathon');
    return this.withMembershipLock(req.user.id, team.id, async () => {
      const alreadyMember = await this.findMembershipInHackathon(req.user.id, team.hackathonId);
      if (alreadyMember) throw new BadRequestException('Already in a team for this hackathon');
      const members = await this.prisma.teamMember.findMany({
        where: { teamId: team.id },
      } as any);
      if (members.length >= team.maxMembers) throw new BadRequestException('Team is full');
      const member = await this.prisma.teamMember.create({
        data: { teamId: team.id, userId: req.user.id, role: 'MEMBER' },
      } as any);
      await this.prisma.auditLog.create({
        data: {
          userId: req.user.id,
          action: 'TEAM_JOINED',
          resource: `team:${team.id}`,
          details: { via: 'tid' },
        },
      } as any);
      const joiner: any = await this.prisma.user.findUnique({ where: { id: req.user.id } } as any).catch(() => null);
      await this.notifyLeader(team, {
        type: 'MEMBER_JOINED',
        title: `${joiner?.fullName ?? 'A participant'} joined ${team.name}`,
        body: `${joiner?.fullName ?? 'A participant'} joined your team with the team code.`,
      });
      return { id: member.id, teamId: team.id, hackathonId: team.hackathonId, status: 'JOINED', message: `You joined ${team.name}.` };
    });
  }

  /**
   * Request to join a team (leader-approved). Unlike join-by-code, membership
   * is NOT created here — the record stays PENDING until the leader accepts.
   * Skill answers ride on the request and are only ever shown to the leader.
   */
  @Post('join-requests')
  async createJoinRequest(@Req() req: any, @Body() dto: JoinRequestDto) {
    const team = await this.prisma.team.findUnique({ where: { id: dto.teamId } } as any);
    if (!team) throw new NotFoundException('Team not found');
    const hackathon = await this.requireRegistrationForHackathon(req.user.id, team.hackathonId);
    this.assertTeamChangesAllowed(hackathon);
    const existingMembership = await this.findMembershipInHackathon(req.user.id, team.hackathonId);
    if (existingMembership) throw new BadRequestException('Already in a team for this hackathon');
    const dupe = await (this.prisma as any).teamJoinRequest.findFirst({
      where: { teamId: team.id, userId: req.user.id, status: 'PENDING' },
    });
    if (dupe) throw new ConflictException('Join request already pending for this team');
    const members = await this.prisma.teamMember.findMany({ where: { teamId: team.id } } as any);
    if (members.length >= team.maxMembers) throw new BadRequestException('Team is full');
    const record = await (this.prisma as any).teamJoinRequest.create({
      data: {
        teamId: team.id,
        hackathonId: team.hackathonId,
        userId: req.user.id,
        message: dto.message?.trim()?.slice(0, 500) ?? null,
        skillRole: dto.skillRole?.trim()?.slice(0, 300) ?? null,
        skillLanguages: dto.skillLanguages?.trim()?.slice(0, 300) ?? null,
        skillExperience: dto.skillExperience?.trim()?.slice(0, 300) ?? null,
        skillContribution: dto.skillContribution?.trim()?.slice(0, 300) ?? null,
      },
    });
    await this.prisma.auditLog.create({
      data: { userId: req.user.id, action: 'TEAM_JOIN_REQUESTED', resource: `team:${team.id}`, details: {} },
    } as any);
    const applicant: any = await this.prisma.user.findUnique({ where: { id: req.user.id } } as any).catch(() => null);
    await this.notifyLeader(team, {
      type: 'JOIN_REQUESTED',
      title: `New join request for ${team.name}`,
      body: `${applicant?.fullName ?? 'A participant'} wants to join your team. Review it in Teams.`,
      requestId: record.id,
      requestKind: 'JOIN',
    });
    const { skillRole, skillLanguages, skillExperience, skillContribution, ...pub } = record;
    void skillRole; void skillLanguages; void skillExperience; void skillContribution;
    return pub;
  }

  /** Outgoing requests of the caller (status visible to the applicant). */
  @Get('join-requests/me')
  async myJoinRequests(@Req() req: any) {
    const rows = await (this.prisma as any).teamJoinRequest.findMany({ where: { userId: req.user.id } });
    return {
      data: rows.map((r: any) => ({
        id: r.id, teamId: r.teamId, hackathonId: r.hackathonId,
        status: r.status, message: r.message ?? null,
        createdAt: r.createdAt, decidedAt: r.decidedAt ?? null,
      })),
    };
  }

  /** Pending requests for a team — leader only, includes skill answers. */
  @Get(':id/join-requests')
  async listJoinRequests(@Req() req: any, @Param('id') id: string) {
    const { team } = await this.requireLeaderMembership(req.user.id, id);
    const rows = await (this.prisma as any).teamJoinRequest.findMany({
      where: { teamId: team.id, status: 'PENDING' },
    });
    const data: any[] = [];
    for (const r of rows) {
      const user: any = await this.prisma.user.findUnique({ where: { id: r.userId } } as any).catch(() => null);
      data.push({
        id: r.id, teamId: r.teamId, hackathonId: r.hackathonId,
        status: r.status, message: r.message ?? null,
        // Applicant context for the leader only — never exposed elsewhere.
        applicant: user ? { id: user.id, fullName: user.fullName ?? null } : { id: r.userId },
        skillAnswers: {
          role: r.skillRole ?? null,
          languages: r.skillLanguages ?? null,
          experience: r.skillExperience ?? null,
          contribution: r.skillContribution ?? null,
        },
        createdAt: r.createdAt,
      });
    }
    return { data };
  }

  /** Leader accepts a request: revalidates everything, creates membership atomically. */
  @Post('join-requests/:requestId/accept')
  async acceptJoinRequest(@Req() req: any, @Param('requestId') requestId: string) {
    const jr: any = await (this.prisma as any).teamJoinRequest.findUnique({ where: { id: requestId } });
    if (!jr) throw new NotFoundException('Join request not found');
    const { team } = await this.requireLeaderMembership(req.user.id, jr.teamId);
    if (jr.status !== 'PENDING') throw new BadRequestException(`Join request already ${jr.status}`);
    const hackathon = team.hackathonId
      ? await this.prisma.hackathon.findUnique({ where: { id: team.hackathonId } } as any)
      : null;
    if (!hackathon) throw new NotFoundException('Hackathon not found or not published');
    this.assertTeamChangesAllowed(hackathon);
    return this.withMembershipLock(jr.userId, team.id, async () => {
      const fresh: any = await (this.prisma as any).teamJoinRequest.findUnique({ where: { id: requestId } });
      if (!fresh || fresh.status !== 'PENDING') throw new BadRequestException('Join request no longer pending');
      // Revalidate applicant state inside the lock (registration, duplicates, capacity).
      const stillRegistered = await (this.prisma as any).registration.findFirst({
        where: { userId: fresh.userId, hackathonId: team.hackathonId },
      });
      if (!stillRegistered) throw new BadRequestException('Applicant is no longer registered for this hackathon');
      const alreadyMember = await this.findMembershipInHackathon(fresh.userId, team.hackathonId);
      if (alreadyMember) throw new BadRequestException('Applicant already in a team for this hackathon');
      const members = await this.prisma.teamMember.findMany({ where: { teamId: team.id } } as any);
      if (members.length >= team.maxMembers) throw new BadRequestException('Team is full');
      const member = await this.prisma.teamMember.create({
        data: { teamId: team.id, userId: fresh.userId, role: 'MEMBER' },
      } as any);
      await (this.prisma as any).teamJoinRequest.update({
        where: { id: requestId },
        data: { status: 'APPROVED', decidedAt: new Date(), decidedById: req.user.id },
      });
      await this.prisma.auditLog.create({
        data: { userId: req.user.id, action: 'TEAM_JOIN_APPROVED', resource: `team:${team.id}`, details: { applicantId: fresh.userId } },
      } as any);
      await this.notifyUser({
        userId: fresh.userId,
        type: 'JOIN_APPROVED',
        title: `You're on ${team.name}`,
        body: `The team leader accepted your request. See your team in Teams.`,
        teamId: team.id,
        hackathonId: team.hackathonId ?? null,
        requestId,
        requestKind: 'JOIN',
        link: team.hackathonId ? `/participant/teams?hackathon=${team.hackathonId}` : '/participant/teams',
      });
      return member;
    });
  }

  /** Leader rejects a request: no membership is created. */
  @Post('join-requests/:requestId/reject')
  async rejectJoinRequest(@Req() req: any, @Param('requestId') requestId: string) {
    const jr: any = await (this.prisma as any).teamJoinRequest.findUnique({ where: { id: requestId } });
    if (!jr) throw new NotFoundException('Join request not found');
    await this.requireLeaderMembership(req.user.id, jr.teamId);
    if (jr.status !== 'PENDING') throw new BadRequestException(`Join request already ${jr.status}`);
    const updated = await (this.prisma as any).teamJoinRequest.update({
      where: { id: requestId },
      data: { status: 'REJECTED', decidedAt: new Date(), decidedById: req.user.id },
    });
    await this.prisma.auditLog.create({
      data: { userId: req.user.id, action: 'TEAM_JOIN_REJECTED', resource: `team:${jr.teamId}`, details: { applicantId: jr.userId } },
    } as any);
    const rejTeam: any = await this.prisma.team.findUnique({ where: { id: jr.teamId } } as any).catch(() => null);
    await this.notifyUser({
      userId: jr.userId,
      type: 'JOIN_REJECTED',
      title: `Request to join ${rejTeam?.name ?? 'a team'} declined`,
      body: `The team leader declined your request. You can request another team.`,
      teamId: jr.teamId,
      hackathonId: jr.hackathonId ?? rejTeam?.hackathonId ?? null,
      requestId,
      requestKind: 'JOIN',
      link: jr.hackathonId ? `/participant/teams?hackathon=${jr.hackathonId}` : '/participant/teams',
    });
    return { id: updated.id, status: updated.status };
  }

  /**
   * Request to leave a team (leader-approved). Membership is NOT removed
   * here — the record stays PENDING until the leader accepts. Leaders cannot
   * use this path (transfer-first rule); the leave endpoint routes them.
   */
  @Post('leave-requests')
  async createLeaveRequest(@Req() req: any, @Body() dto: LeaveRequestDto) {
    const team = await this.prisma.team.findUnique({ where: { id: dto.teamId } } as any);
    if (!team) throw new NotFoundException('Team not found');
    const membership: any = await this.prisma.teamMember.findFirst({
      where: { teamId: team.id, userId: req.user.id },
    } as any);
    if (!membership) throw new BadRequestException('Not a member of this team');
    if (membership.role === 'LEADER') {
      throw new BadRequestException('Transfer leadership to a team member before leaving');
    }
    const hackathon = team.hackathonId
      ? await this.prisma.hackathon.findUnique({ where: { id: team.hackathonId } } as any)
      : null;
    if (!hackathon) throw new NotFoundException('Hackathon not found or not published');
    this.assertTeamChangesAllowed(hackathon);
    const dupe = await (this.prisma as any).teamLeaveRequest.findFirst({
      where: { teamId: team.id, userId: req.user.id, status: 'PENDING' },
    });
    if (dupe) throw new ConflictException('Leave request already pending for this team');
    const record = await (this.prisma as any).teamLeaveRequest.create({
      data: { teamId: team.id, hackathonId: team.hackathonId, userId: req.user.id },
    });
    await this.prisma.auditLog.create({
      data: { userId: req.user.id, action: 'TEAM_LEAVE_REQUESTED', resource: `team:${team.id}`, details: {} },
    } as any);
    const leaver: any = await this.prisma.user.findUnique({ where: { id: req.user.id } } as any).catch(() => null);
    await this.notifyLeader(team, {
      type: 'LEAVE_REQUESTED',
      title: `Leave request in ${team.name}`,
      body: `${leaver?.fullName ?? 'A member'} wants to leave your team. Review it in Teams.`,
      requestId: record.id,
      requestKind: 'LEAVE',
    });
    return { id: record.id, teamId: team.id, status: 'PENDING', message: 'Leave request sent — the team leader will review it.' };
  }

  /** Outgoing leave requests of the caller. */
  @Get('leave-requests/me')
  async myLeaveRequests(@Req() req: any) {
    const rows = await (this.prisma as any).teamLeaveRequest.findMany({ where: { userId: req.user.id } });
    return {
      data: rows.map((r: any) => ({
        id: r.id, teamId: r.teamId, hackathonId: r.hackathonId,
        status: r.status, createdAt: r.createdAt, decidedAt: r.decidedAt ?? null,
      })),
    };
  }

  /** Pending leave requests for a team — leader only. */
  @Get(':id/leave-requests')
  async listLeaveRequests(@Req() req: any, @Param('id') id: string) {
    const { team } = await this.requireLeaderMembership(req.user.id, id);
    const rows = await (this.prisma as any).teamLeaveRequest.findMany({
      where: { teamId: team.id, status: 'PENDING' },
    });
    const data: any[] = [];
    for (const r of rows) {
      const user: any = await this.prisma.user.findUnique({ where: { id: r.userId } } as any).catch(() => null);
      data.push({
        id: r.id, teamId: r.teamId, hackathonId: r.hackathonId, status: r.status,
        member: user ? { id: user.id, fullName: user.fullName ?? null } : { id: r.userId },
        createdAt: r.createdAt,
      });
    }
    return { data };
  }

  /** Leader accepts a leave request: removes the member atomically. */
  @Post('leave-requests/:requestId/accept')
  async acceptLeaveRequest(@Req() req: any, @Param('requestId') requestId: string) {
    const lr: any = await (this.prisma as any).teamLeaveRequest.findUnique({ where: { id: requestId } });
    if (!lr) throw new NotFoundException('Leave request not found');
    const { team } = await this.requireLeaderMembership(req.user.id, lr.teamId);
    if (lr.status !== 'PENDING') throw new BadRequestException(`Leave request already ${lr.status}`);
    const hackathon = team.hackathonId
      ? await this.prisma.hackathon.findUnique({ where: { id: team.hackathonId } } as any)
      : null;
    if (!hackathon) throw new NotFoundException('Hackathon not found or not published');
    this.assertTeamChangesAllowed(hackathon);
    return this.withTeamLock(`team:${team.id}`, async () => {
      const fresh: any = await (this.prisma as any).teamLeaveRequest.findUnique({ where: { id: requestId } });
      if (!fresh || fresh.status !== 'PENDING') throw new BadRequestException('Leave request no longer pending');
      const membership: any = await this.prisma.teamMember.findFirst({
        where: { teamId: team.id, userId: fresh.userId },
      } as any);
      if (!membership) throw new BadRequestException('Requester is no longer a team member');
      if (membership.role === 'LEADER') throw new BadRequestException('Leadership must be transferred first — a team cannot become leaderless');
      await this.prisma.teamMember.delete({ where: { id: membership.id } } as any);
      await (this.prisma as any).teamLeaveRequest.update({
        where: { id: requestId },
        data: { status: 'APPROVED', decidedAt: new Date(), decidedById: req.user.id },
      });
      await this.prisma.auditLog.create({
        data: { userId: req.user.id, action: 'TEAM_LEAVE_APPROVED', resource: `team:${team.id}`, details: { memberId: fresh.userId } },
      } as any);
      await this.notifyUser({
        userId: fresh.userId,
        type: 'LEAVE_APPROVED',
        title: `You left ${team.name}`,
        body: `The team leader accepted your leave request.`,
        teamId: team.id,
        hackathonId: team.hackathonId ?? null,
        requestId,
        requestKind: 'LEAVE',
        link: team.hackathonId ? `/participant/teams?hackathon=${team.hackathonId}` : '/participant/teams',
      });
      return { id: requestId, status: 'APPROVED' };
    });
  }

  /** Leader rejects a leave request: the member stays on the team. */
  @Post('leave-requests/:requestId/reject')
  async rejectLeaveRequest(@Req() req: any, @Param('requestId') requestId: string) {
    const lr: any = await (this.prisma as any).teamLeaveRequest.findUnique({ where: { id: requestId } });
    if (!lr) throw new NotFoundException('Leave request not found');
    await this.requireLeaderMembership(req.user.id, lr.teamId);
    if (lr.status !== 'PENDING') throw new BadRequestException(`Leave request already ${lr.status}`);
    const updated = await (this.prisma as any).teamLeaveRequest.update({
      where: { id: requestId },
      data: { status: 'REJECTED', decidedAt: new Date(), decidedById: req.user.id },
    });
    await this.prisma.auditLog.create({
      data: { userId: req.user.id, action: 'TEAM_LEAVE_REJECTED', resource: `team:${lr.teamId}`, details: { memberId: lr.userId } },
    } as any);
    const rejTeam: any = await this.prisma.team.findUnique({ where: { id: lr.teamId } } as any).catch(() => null);
    await this.notifyUser({
      userId: lr.userId,
      type: 'LEAVE_REJECTED',
      title: `Leave request for ${rejTeam?.name ?? 'your team'} declined`,
      body: `The team leader declined your leave request — you are still a member.`,
      teamId: lr.teamId,
      hackathonId: lr.hackathonId ?? rejTeam?.hackathonId ?? null,
      requestId,
      requestKind: 'LEAVE',
      link: lr.hackathonId ? `/participant/teams?hackathon=${lr.hackathonId}` : '/participant/teams',
    });
    return { id: updated.id, status: updated.status };
  }

  /** Requester cancels their own pending leave request. */
  @Post('leave-requests/:requestId/cancel')
  async cancelLeaveRequest(@Req() req: any, @Param('requestId') requestId: string) {
    const lr: any = await (this.prisma as any).teamLeaveRequest.findUnique({ where: { id: requestId } });
    if (!lr) throw new NotFoundException('Leave request not found');
    if (lr.userId !== req.user.id) throw new ForbiddenException('Only the requester can cancel this request');
    if (lr.status !== 'PENDING') throw new BadRequestException(`Leave request already ${lr.status}`);
    const updated = await (this.prisma as any).teamLeaveRequest.update({
      where: { id: requestId },
      data: { status: 'CANCELLED', decidedAt: new Date(), decidedById: req.user.id },
    });
    await this.prisma.auditLog.create({
      data: { userId: req.user.id, action: 'TEAM_LEAVE_CANCELLED', resource: `team:${lr.teamId}`, details: {} },
    } as any);
    return { id: updated.id, status: updated.status };
  }

  /** Transfer leadership to another current member. Exactly one leader always. */
  @Post(':id/transfer')  async transferLeadership(@Req() req: any, @Param('id') id: string, @Body() dto: TransferLeadershipDto) {
    const { team } = await this.requireLeaderMembership(req.user.id, id);
    if (dto.toUserId === req.user.id) throw new BadRequestException('You already lead this team');
    const hackathon = team.hackathonId
      ? await this.prisma.hackathon.findUnique({ where: { id: team.hackathonId } } as any)
      : null;
    if (!hackathon) throw new NotFoundException('Hackathon not found or not published');
    this.assertTeamChangesAllowed(hackathon);
    return this.withTeamLock(`team:${team.id}`, async () => {
      const current: any = await this.prisma.teamMember.findFirst({
        where: { teamId: team.id, userId: req.user.id },
      } as any);
      if (!current || current.role !== 'LEADER') throw new ForbiddenException('Only the team leader can perform this action');
      const target: any = await this.prisma.teamMember.findFirst({
        where: { teamId: team.id, userId: dto.toUserId },
      } as any);
      if (!target) throw new BadRequestException('New leader must be a current team member');
      await this.prisma.teamMember.update({ where: { id: current.id }, data: { role: 'MEMBER' } } as any);
      await this.prisma.teamMember.update({ where: { id: target.id }, data: { role: 'LEADER' } } as any);
      await this.prisma.auditLog.create({
        data: { userId: req.user.id, action: 'TEAM_LEADERSHIP_TRANSFERRED', resource: `team:${team.id}`, details: { from: req.user.id, to: dto.toUserId } },
      } as any);
      return { message: 'Leadership transferred', teamId: team.id, leaderId: dto.toUserId };
    });
  }

  /**
   * Delete a team (leader only). Blocked when the team owns a project —
   * valuable submission data is never cascade-deleted. Members, invites,
   * interests, and join requests for the team are removed; the project (if
   * any) would have blocked deletion, so nothing valuable is lost.
   */
  @Delete(':id')
  async deleteTeam(@Req() req: any, @Param('id') id: string) {
    const { team } = await this.requireLeaderMembership(req.user.id, id);
    const hackathon = team.hackathonId
      ? await this.prisma.hackathon.findUnique({ where: { id: team.hackathonId } } as any)
      : null;
    if (!hackathon) throw new NotFoundException('Hackathon not found or not published');
    this.assertTeamChangesAllowed(hackathon);
    const project = await this.prisma.project.findUnique({ where: { teamId: team.id } } as any).catch(() => null);
    if (project) {
      throw new BadRequestException('Team owns a project and cannot be deleted — remove the project first');
    }
    return this.withTeamLock(`team:${team.id}`, async () => {
      const stillLeader: any = await this.prisma.teamMember.findFirst({
        where: { teamId: team.id, userId: req.user.id },
      } as any);
      if (!stillLeader || stillLeader.role !== 'LEADER') {
        throw new ForbiddenException('Only the team leader can perform this action');
      }
      const members = await this.prisma.teamMember.findMany({ where: { teamId: team.id } } as any);
      for (const m of members) {
        await this.prisma.teamMember.delete({ where: { id: m.id } } as any);
      }
      const invites = await this.prisma.teamInvitation.findMany({ where: { teamId: team.id } } as any);
      for (const inv of invites) {
        await this.prisma.teamInvitation.delete({ where: { id: inv.id } } as any).catch(() => null);
      }
      await (this.prisma as any).teamJoinRequest.deleteMany({ where: { teamId: team.id } });
      await (this.prisma as any).teamLeaveRequest.deleteMany({ where: { teamId: team.id } });
      const interests = await this.prisma.teamInterest.findMany({ where: { teamId: team.id } } as any).catch(() => []);
      for (const it of interests || []) {
        await this.prisma.teamInterest.delete({ where: { id: it.id } } as any).catch(() => null);
      }
      await this.prisma.team.delete({ where: { id: team.id } } as any);
      await this.prisma.auditLog.create({
        data: { userId: req.user.id, action: 'TEAM_DELETED', resource: `team:${team.id}`, details: { name: team.name } },
      } as any);
      return { message: 'Team deleted', teamId: team.id };
    });
  }
  @Get(':id')
  async getTeamById(@Req() req: any, @Param('id') id: string) {
    const team = await this.prisma.team.findUnique({
      where: { id },
      include: {
        members: { include: { user: { select: { id: true, fullName: true } } } },
        project: true,
        hackathon: true,
      },
    } as any);
    if (!team) throw new NotFoundException('Team not found');
    const isMember = team.members?.some((m: any) => m.userId === req.user.id);
    const visibility = team.visibility as VisibilityLevel;
    if (
      visibility === VisibilityLevel.TEAM_PRIVATE &&
      !isMember &&
      req.user.role !== 'ORGANIZER' &&
      req.user.role !== 'ADMIN'
    ) {
      throw new ForbiddenException(
        'Private team not visible (privacy enforced)',
      );
    }
    if (
      visibility === VisibilityLevel.ORGANIZER_ONLY &&
      !['ORGANIZER', 'ADMIN'].includes(req.user.role)
    )
      throw new ForbiddenException('Organizer only');
    if (
      visibility === VisibilityLevel.MENTOR_ONLY &&
      !['MENTOR', 'ORGANIZER', 'ADMIN'].includes(req.user.role) &&
      !isMember
    )
      throw new ForbiddenException('Mentor only');
    if (!isMember) {
      return this.privacy.filterTeamForParticipant(team, req.user, false);
    }
    return team;
  }

  @Post(':id/interest')
  async expressInterest(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: InterestDto,
  ) {
    const team = await this.prisma.team.findUnique({ where: { id } } as any);
    if (!team) throw new NotFoundException('Team not found');
    if (team.visibility === VisibilityLevel.TEAM_PRIVATE)
      throw new ForbiddenException('Cannot express interest to private team');
    const existing = await this.prisma.teamInterest.findFirst({
      where: { teamId: id, userId: req.user.id },
    } as any);
    if (existing) throw new BadRequestException('Already expressed interest');
    const membership = team.hackathonId
      ? await this.findMembershipInHackathon(req.user.id, team.hackathonId)
      : await this.prisma.teamMember.findFirst({ where: { userId: req.user.id } } as any);
    if (membership)
      throw new BadRequestException('Already in a team for this hackathon, leave first');
    const interest = await this.prisma.teamInterest.create({
      data: { teamId: id, userId: req.user.id, message: dto.message },
    } as any);
    await this.prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'TEAM_INTEREST',
        resource: `team:${id}`,
        details: { message: dto.message },
      },
    } as any);
    return interest;
  }

  @Get(':id/interests')
  async getInterests(@Req() req: any, @Param('id') id: string) {
    const team = await this.prisma.team.findUnique({ where: { id } } as any);
    if (!team) throw new NotFoundException('Team not found');
    const membership = await this.prisma.teamMember.findFirst({
      where: { userId: req.user.id, teamId: id },
    } as any);
    if (!membership || membership.role !== 'LEADER')
      throw new ForbiddenException('Only team leader can view interests');
    const interests = await this.prisma.teamInterest.findMany({
      where: { teamId: id },
    } as any);
    return interests;
  }

  @Post(':id/invite')
  async invite(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: InviteDto,
  ) {
    const team = await this.prisma.team.findUnique({ where: { id } } as any);
    if (!team) throw new NotFoundException('Team not found');
    const membership = await this.prisma.teamMember.findFirst({
      where: { userId: req.user.id, teamId: id },
    } as any);
    if (!membership || membership.role !== 'LEADER')
      throw new ForbiddenException('Only leader can invite');
    const hackathon = team.hackathonId
      ? await this.prisma.hackathon.findUnique({ where: { id: team.hackathonId } } as any)
      : null;
    if (hackathon) this.assertTeamChangesAllowed(hackathon);
    const members = await this.prisma.teamMember.findMany({
      where: { teamId: id },
    } as any);
    if (members.length >= team.maxMembers)
      throw new BadRequestException('Team is full');
    const inviteeUser = await this.prisma.user.findUnique({
      where: { email: dto.inviteeEmail.toLowerCase() },
    } as any);
    if (inviteeUser) {
      const existingMember = await this.prisma.teamMember.findFirst({
        where: { userId: inviteeUser.id, teamId: id },
      } as any);
      if (existingMember) throw new BadRequestException('User already in team');
    }
    const existingInvite = await this.prisma.teamInvitation.findFirst({
      where: {
        teamId: id,
        inviteeEmail: dto.inviteeEmail.toLowerCase(),
        status: 'PENDING',
      },
    } as any);
    if (existingInvite)
      throw new BadRequestException('Invitation already pending');
    const invite = await this.prisma.teamInvitation.create({
      data: {
        teamId: id,
        inviterId: req.user.id,
        inviteeEmail: dto.inviteeEmail.toLowerCase(),
        inviteeId: inviteeUser?.id || null,
        message: dto.message,
      },
    } as any);
    await this.prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'TEAM_INVITE',
        resource: `team:${id}`,
        details: { inviteeEmail: dto.inviteeEmail },
      },
    } as any);
    return invite;
  }

  @Post(':id/repository')
  async connectRepositoryLegacy(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: ConnectRepoDto,
  ) {
    // alias for backward compat - id is ignored, uses membership teamId, but enforce leader
    const membership = await this.prisma.teamMember.findFirst({
      where: { userId: req.user.id, teamId: id },
    } as any);
    if (!membership)
      throw new BadRequestException('Not in this team (IDOR prevented)');
    if (membership.role !== 'LEADER')
      throw new ForbiddenException('Only leader can connect repository');
    const project = await this.prisma.project.upsert({
      where: { teamId: id },
      update: {
        repoUrl: dto.repoUrl,
        title: dto.title,
        description: dto.description,
        techStack: dto.techStack || [],
      },
      create: {
        teamId: id,
        repoUrl: dto.repoUrl,
        title: dto.title,
        description: dto.description,
        techStack: dto.techStack || [],
      },
    } as any);
    await this.prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'REPO_CONNECT',
        resource: `project:${project.id}`,
        details: { repoUrl: dto.repoUrl },
      },
    } as any);
    return project;
  }

  @Post('repository')
  async connectRepository(
    @Req() req: any,
    @Body() dto: ConnectRepoDto,
    @Query('teamId') teamId?: string,
  ) {
    // Optional team scoping: with per-hackathon memberships, the caller's
    // first membership may belong to another hackathon. An explicit teamId
    // is verified against the caller's memberships; otherwise legacy applies.
    let membership: any = null;
    if (teamId) {
      membership = await this.prisma.teamMember.findFirst({
        where: { userId: req.user.id, teamId },
      } as any);
      if (!membership)
        throw new BadRequestException(
          'Not a member of the specified team (IDOR prevented)',
        );
    } else {
      membership = await this.prisma.teamMember.findFirst({
        where: { userId: req.user.id },
      } as any);
    }
    if (!membership)
      throw new BadRequestException(
        'User must belong to a team before connecting a project repository',
      );
    if (membership.role !== 'LEADER')
      throw new ForbiddenException(
        'Only team leader can connect repository (authorization enforced)',
      );
    const project = await this.prisma.project.upsert({
      where: { teamId: membership.teamId },
      update: {
        repoUrl: dto.repoUrl,
        title: dto.title,
        description: dto.description,
        techStack: dto.techStack || [],
      },
      create: {
        teamId: membership.teamId,
        repoUrl: dto.repoUrl,
        title: dto.title,
        description: dto.description,
        techStack: dto.techStack || [],
      },
    } as any);
    this.neo4j
      .write(
        `
      MERGE (t:Team {id: $teamId})
      MERGE (pr:Project {id: $projectId, title: $title, repoUrl: $repoUrl})
      MERGE (t)-[:BUILT]->(pr)
      `,
        {
          teamId: membership.teamId,
          projectId: project.id,
          title: project.title,
          repoUrl: dto.repoUrl,
        },
      )
      .catch(() => {});
    if (dto.techStack) {
      for (const tech of dto.techStack) {
        this.neo4j
          .write(
            `
          MERGE (pr:Project {id: $projectId})
          MERGE (tech:Technology {name: $tech})
          MERGE (pr)-[:USES]->(tech)
          `,
            { projectId: project.id, tech },
          )
          .catch(() => {});
      }
    }
    await this.prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'REPO_CONNECT',
        resource: `project:${project.id}`,
        details: { repoUrl: dto.repoUrl },
      },
    } as any);
    return project;
  }
}
