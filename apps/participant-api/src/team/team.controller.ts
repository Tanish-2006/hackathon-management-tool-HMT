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
} from './dto/team.dto';
import { VisibilityLevel } from '../common/enums/visibility.enum';

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

  @Get('me')
  async getMyTeam(@Req() req: any) {
    const membership = await this.prisma.teamMember.findFirst({
      where: { userId: req.user.id },
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
    const existingMembership = await this.prisma.teamMember.findFirst({
      where: { userId: req.user.id },
    } as any);
    if (existingMembership) throw new BadRequestException('Already in team');
    const members = await this.prisma.teamMember.findMany({
      where: { teamId: dto.teamId },
    } as any);
    if (members.length >= team.maxMembers)
      throw new BadRequestException('Team full');
    const member = await this.prisma.teamMember.create({
      data: { teamId: dto.teamId, userId: req.user.id, role: 'MEMBER' },
    } as any);
    await this.prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'TEAM_JOIN',
        resource: `team:${dto.teamId}`,
        details: {},
      },
    } as any);
    return member;
  }

  @Post('leave')
  async leaveTeam(@Req() req: any) {
    const membership = await this.prisma.teamMember.findFirst({
      where: { userId: req.user.id },
    } as any);
    if (!membership) throw new BadRequestException('Not in a team');
    await this.prisma.teamMember.delete({
      where: { id: membership.id },
    } as any);
    await this.prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'TEAM_LEAVE',
        resource: `team:${membership.teamId}`,
        details: {},
      },
    } as any);
    return { message: 'Left team' };
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
    const existingMembership = await this.prisma.teamMember.findFirst({
      where: { userId: req.user.id },
    } as any);
    if (existingMembership) throw new BadRequestException('Already in a team');
    const team = await this.prisma.team.findUnique({
      where: { id: invite.teamId },
    } as any);
    if (!team) throw new NotFoundException('Team not found');
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
    const existingMembership = await this.prisma.teamMember.findFirst({
      where: { userId: req.user.id },
    } as any);

    if (existingMembership) {
      throw new BadRequestException(
        'User is already in a team for this hackathon',
      );
    }

    const team = await this.prisma.team.create({
      data: {
        name: dto.name,
        hackathonId: dto.hackathonId,
        visibility: dto.visibility ?? VisibilityLevel.TEAM_DISCOVERABLE,
        maxMembers: dto.maxMembers ?? 4,
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
        details: { name: dto.name },
      },
    } as any);
    return team;
  }

  @Get(':id')
  async getTeamById(@Req() req: any, @Param('id') id: string) {
    const team = await this.prisma.team.findUnique({
      where: { id },
      include: { members: true, project: true, hackathon: true },
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
    const membership = await this.prisma.teamMember.findFirst({
      where: { userId: req.user.id },
    } as any);
    if (membership)
      throw new BadRequestException('Already in a team, leave first');
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
  async connectRepository(@Req() req: any, @Body() dto: ConnectRepoDto) {
    const membership = await this.prisma.teamMember.findFirst({
      where: { userId: req.user.id },
    } as any);
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
