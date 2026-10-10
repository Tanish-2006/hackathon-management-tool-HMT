import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PrismaService } from '../database/prisma.service';
import { PrivacyService } from '../privacy/privacy.service';
import {
  CreateProjectDto,
  UpdateProjectDto,
  CreateMilestoneDto,
} from './dto/project.dto';

@ApiTags('project')
@ApiBearerAuth()
@Controller('project')
@UseGuards(JwtAuthGuard)
export class ProjectController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly privacy: PrivacyService,
  ) {}

  private async requireTeamMembership(userId: string, hackathonId?: string) {
    // Optional hackathon scoping: with per-hackathon memberships, the first
    // membership may belong to another hackathon. When a hackathon context is
    // given, resolve the membership inside it (fail-closed when absent).
    if (hackathonId) {
      const memberships = (await this.prisma.teamMember.findMany({
        where: { userId },
      } as any)) as any[];
      for (const m of memberships || []) {
        const team = await this.prisma.team.findUnique({ where: { id: m.teamId } } as any);
        if (team && (team as any).hackathonId === hackathonId) {
          return { ...m, team };
        }
      }
      throw new NotFoundException('User not in a team for this hackathon');
    }
    const membership = await this.prisma.teamMember.findFirst({
      where: { userId },
      include: { team: true } as any,
    });
    if (!membership) throw new NotFoundException('User not in a team');
    return membership;
  }

  @Get('me')
  async getMyProject(@Req() req: any, @Query('hackathonId') hackathonId?: string) {
    // Optional hackathon scoping: a project belongs to one team in one
    // hackathon. Without the parameter, legacy first-membership applies.
    let membership: any = null;
    if (hackathonId) {
      try {
        membership = await this.requireTeamMembership(req.user.id, hackathonId);
      } catch {
        return { project: null, milestones: [] };
      }
    } else {
      membership = await this.prisma.teamMember.findFirst({
        where: { userId: req.user.id },
        include: { team: { include: { project: true } } } as any,
      });
    }
    if (!membership) return { project: null, milestones: [] };
    // When resolved via the scoped path, membership.team may already carry
    // the team; otherwise load the project explicitly for a stable shape.
    let project = membership.team?.project ?? null;
    if (!project && membership.teamId) {
      project = await this.prisma.project.findUnique({ where: { teamId: membership.teamId } } as any).catch(() => null);
    }
    if (!project) return { project: null, milestones: [] };
    const milestones = await this.prisma.projectMilestone.findMany({
      where: { projectId: project.id },
    } as any);
    return { project, milestones };
  }

  @Post()
  async createOrUpdateProject(@Req() req: any, @Body() dto: CreateProjectDto) {
    // Prefer the DTO's hackathon context when present so multi-hackathon
    // participants upsert into the right team; otherwise legacy applies.
    const membership = await this.requireTeamMembership(req.user.id, (dto as any)?.hackathonId);
    // ownership check: only members can upsert, but visibility enforcement
    const existing = await this.prisma.project.findUnique({
      where: { teamId: membership.teamId },
    } as any);
    const repoUrl = await this.resolveRepoUrl(membership.team.hackathonId, (dto as any)?.repoUrl);
    const project = await this.prisma.project.upsert({
      where: { teamId: membership.teamId },
      update: { ...dto, repoUrl, hackathonId: membership.team.hackathonId },
      create: {
        teamId: membership.teamId,
        hackathonId: membership.team.hackathonId,
        ...dto,
        repoUrl,
      },
    } as any);
    return project;
  }

  @Put(':id')
  async updateProject(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: UpdateProjectDto,
  ) {
    const proj = await this.prisma.project.findUnique({ where: { id } } as any);
    if (!proj) throw new NotFoundException('Project not found');
    // Explicit team match: with per-hackathon memberships, the caller's first
    // membership may belong to another team (false 403) or another team's
    // membership could coincide (must not grant access).
    const membership = await this.prisma.teamMember.findFirst({
      where: { userId: req.user.id, teamId: proj.teamId },
    });
    if (!membership)
      throw new ForbiddenException('Not owner of project (IDOR prevented)');
    const repoUrl = await this.resolveRepoUrl(proj.hackathonId, (dto as any)?.repoUrl, proj.repoUrl);
    const updated = await this.prisma.project.update({
      where: { id },
      data: { ...dto, repoUrl } as any,
    } as any);
    return updated;
  }

  /**
   * One primary repository URL per team/project (metadata only — accepting a
   * URL never grants repository access; grants stay explicit). The
   * hackathon's repoRequirement (REQUIRED/OPTIONAL/DISABLED, default
   * OPTIONAL) decides whether the field is mandatory, optional, or dropped.
   * Provided URLs must be http(s) github.com URLs.
   */
  private async resolveRepoUrl(
    hackathonId: string | undefined | null,
    provided: unknown,
    existing?: unknown,
  ): Promise<string | null> {
    let requirement = 'OPTIONAL';
    if (hackathonId) {
      const h: any = await this.prisma.hackathon.findUnique({ where: { id: hackathonId } } as any).catch(() => null);
      if (h?.repoRequirement) requirement = h.repoRequirement;
    }
    const raw = typeof provided === 'string' && provided.trim() ? provided.trim() : null;
    if (requirement === 'DISABLED') return null;
    const value = raw ?? (typeof existing === 'string' && existing ? existing : null);
    if (!value) {
      if (requirement === 'REQUIRED') {
        throw new BadRequestException('A GitHub repository URL is required for this hackathon');
      }
      return null;
    }
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      throw new BadRequestException('Repository URL must be a valid https://github.com/org/repo URL');
    }
    const host = parsed.hostname.toLowerCase();
    if (parsed.protocol !== 'https:' || (host !== 'github.com' && host !== 'www.github.com')) {
      throw new BadRequestException('Repository URL must be a valid https://github.com/org/repo URL');
    }
    return parsed.toString();
  }

  @Get(':id')
  async getProjectById(@Req() req: any, @Param('id') id: string) {
    const proj = await this.prisma.project.findUnique({
      where: { id },
      include: { milestones: true } as any,
    } as any);
    if (!proj) throw new NotFoundException('Project not found');
    // Explicit team match (per-hackathon memberships): the caller's first
    // membership may belong to another team.
    const membership = await this.prisma.teamMember.findFirst({
      where: { userId: req.user.id, teamId: proj.teamId },
    });
    const isMember = !!membership;
    if (
      proj.visibility === 'TEAM_PRIVATE' &&
      !isMember &&
      req.user.role !== 'ORGANIZER' &&
      req.user.role !== 'MENTOR' &&
      req.user.role !== 'ADMIN'
    ) {
      throw new ForbiddenException('Private project not visible');
    }
    if (
      proj.visibility === 'ORGANIZER_ONLY' &&
      req.user.role !== 'ORGANIZER' &&
      req.user.role !== 'ADMIN'
    )
      throw new ForbiddenException('Organizer only');
    if (
      proj.visibility === 'MENTOR_ONLY' &&
      !['MENTOR', 'ORGANIZER', 'ADMIN'].includes(req.user.role) &&
      !isMember
    )
      throw new ForbiddenException('Mentor only');
    let hasGrant = false;
    if (isMember) {
      const grant: any = await (this.prisma as any).repositoryAccessGrant
        ?.findFirst?.({ where: { projectId: id, status: 'GRANTED', revokedAt: null } })
        .catch(() => null);
      hasGrant = !!grant && !grant.revokedAt;
    }
    const filtered = this.privacy.filterProjectForParticipant(
      proj,
      membership?.teamId || null,
      isMember,
      hasGrant,
    );
    // also filter milestones if private?
    return filtered;
  }

  @Post(':id/milestones')
  async createMilestone(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: CreateMilestoneDto,
  ) {
    const proj = await this.prisma.project.findUnique({ where: { id } } as any);
    if (!proj) throw new NotFoundException('Project not found');
    // Explicit team match (per-hackathon memberships).
    const membership = await this.prisma.teamMember.findFirst({
      where: { userId: req.user.id, teamId: proj.teamId },
    });
    if (!membership)
      throw new ForbiddenException('Not team member');
    const milestone = await this.prisma.projectMilestone.create({
      data: {
        projectId: id,
        title: dto.title,
        description: dto.description,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
      },
    } as any);
    return milestone;
  }

  @Get(':id/milestones')
  async listMilestones(@Req() req: any, @Param('id') id: string) {
    const proj = await this.prisma.project.findUnique({ where: { id } } as any);
    if (!proj) throw new NotFoundException('Project not found');
    // Explicit team match (per-hackathon memberships): the caller's first
    // membership may belong to another team.
    const membership = await this.prisma.teamMember.findFirst({
      where: { userId: req.user.id, teamId: proj.teamId },
    });
    const isMember = !!membership;
    if (proj.visibility === 'TEAM_PRIVATE' && !isMember)
      throw new ForbiddenException('Private');
    return this.prisma.projectMilestone.findMany({
      where: { projectId: id },
    } as any);
  }
}
