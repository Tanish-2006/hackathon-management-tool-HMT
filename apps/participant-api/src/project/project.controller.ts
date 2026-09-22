import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
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

  private async requireTeamMembership(userId: string) {
    const membership = await this.prisma.teamMember.findFirst({
      where: { userId },
      include: { team: true } as any,
    });
    if (!membership) throw new NotFoundException('User not in a team');
    return membership;
  }

  @Get('me')
  async getMyProject(@Req() req: any) {
    const membership = await this.prisma.teamMember.findFirst({
      where: { userId: req.user.id },
      include: { team: { include: { project: true } } } as any,
    });
    if (!membership?.team?.project) return { project: null, milestones: [] };
    const project = membership.team.project;
    const milestones = await this.prisma.projectMilestone.findMany({
      where: { projectId: project.id },
    } as any);
    return { project, milestones };
  }

  @Post()
  async createOrUpdateProject(@Req() req: any, @Body() dto: CreateProjectDto) {
    const membership = await this.requireTeamMembership(req.user.id);
    // ownership check: only members can upsert, but visibility enforcement
    const existing = await this.prisma.project.findUnique({
      where: { teamId: membership.teamId },
    } as any);
    const project = await this.prisma.project.upsert({
      where: { teamId: membership.teamId },
      update: { ...dto, hackathonId: membership.team.hackathonId },
      create: {
        teamId: membership.teamId,
        hackathonId: membership.team.hackathonId,
        ...dto,
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
    const membership = await this.prisma.teamMember.findFirst({
      where: { userId: req.user.id },
    });
    if (!membership || membership.teamId !== proj.teamId)
      throw new ForbiddenException('Not owner of project (IDOR prevented)');
    const updated = await this.prisma.project.update({
      where: { id },
      data: dto,
    } as any);
    return updated;
  }

  @Get(':id')
  async getProjectById(@Req() req: any, @Param('id') id: string) {
    const proj = await this.prisma.project.findUnique({
      where: { id },
      include: { milestones: true } as any,
    } as any);
    if (!proj) throw new NotFoundException('Project not found');
    const membership = await this.prisma.teamMember.findFirst({
      where: { userId: req.user.id },
    });
    const isMember = !!membership && membership.teamId === proj.teamId;
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
    const filtered = this.privacy.filterProjectForParticipant(
      proj,
      membership?.teamId || null,
      isMember,
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
    const membership = await this.prisma.teamMember.findFirst({
      where: { userId: req.user.id },
    });
    if (!membership || membership.teamId !== proj.teamId)
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
    const membership = await this.prisma.teamMember.findFirst({
      where: { userId: req.user.id },
    });
    const isMember = !!membership && membership.teamId === proj.teamId;
    if (proj.visibility === 'TEAM_PRIVATE' && !isMember)
      throw new ForbiddenException('Private');
    return this.prisma.projectMilestone.findMany({
      where: { projectId: id },
    } as any);
  }
}
