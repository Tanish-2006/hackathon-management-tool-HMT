import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  UseGuards,
  Req,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SensitiveRateLimitGuard } from '../common/guards/rate-limit.guard';
import { PrismaService } from '../database/prisma.service';

@ApiTags('repository-access')
@ApiBearerAuth()
@Controller('repository-access')
@UseGuards(JwtAuthGuard, SensitiveRateLimitGuard)
export class RepositoryAccessController {
  constructor(private readonly prisma: PrismaService) {}

  private async assertLeader(
    userId: string,
    projectId?: string,
    teamId?: string,
  ) {
    let teamIdToCheck = teamId;
    let project: any = null;
    if (projectId) {
      project = await this.prisma.project.findUnique({
        where: { id: projectId },
      } as any);
      if (!project) throw new NotFoundException('Project not found');
      teamIdToCheck = project.teamId;
    }
    if (!teamIdToCheck)
      throw new BadRequestException('teamId or projectId required');
    const membership = await this.prisma.teamMember.findFirst({
      where: { userId, teamId: teamIdToCheck },
    } as any);
    if (!membership)
      throw new ForbiddenException('Not a member of team (IDOR prevented)');
    if (membership.role !== 'LEADER')
      throw new ForbiddenException(
        'Only team leader can manage repository access',
      );
    return { teamId: teamIdToCheck, project, membership };
  }

  @Post('grant')
  async grant(@Req() req: any, @Body() dto: any) {
    // dto expects projectId
    if (!dto.projectId) throw new BadRequestException('projectId required');
    const { project } = await this.assertLeader(req.user.id, dto.projectId);
    const grant = await this.prisma.repositoryAccessGrant.create({
      data: {
        projectId: dto.projectId,
        teamId: project.teamId,
        grantedById: req.user.id,
        status: 'GRANTED',
        auditNote: dto.note,
      },
    } as any);
    return grant;
  }

  @Post('revoke')
  async revoke(@Req() req: any, @Body() dto: any) {
    if (!dto.grantId) throw new BadRequestException('grantId required');
    const grant = await this.prisma.repositoryAccessGrant.findUnique({
      where: { id: dto.grantId },
    } as any);
    if (!grant) throw new NotFoundException('Grant not found');
    await this.assertLeader(req.user.id, grant.projectId);
    const updated = await this.prisma.repositoryAccessGrant.update({
      where: { id: dto.grantId },
      data: { status: 'REVOKED', revokedAt: new Date() },
    } as any);
    return updated;
  }

  @Get('history/:projectId')
  async history(@Req() req: any, @Param('projectId') projectId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
    } as any);
    if (!project) throw new NotFoundException('Project not found');
    const membership = await this.prisma.teamMember.findFirst({
      where: { userId: req.user.id, teamId: project.teamId },
    } as any);
    if (!membership)
      throw new ForbiddenException(
        'Not authorized to view access history (IDOR)',
      );
    const history = await this.prisma.repositoryAccessGrant.findMany({
      where: { projectId },
      orderBy: { grantedAt: 'desc' },
    } as any);
    return { projectId, history };
  }

  @Get('check/:projectId')
  async checkAccess(@Req() req: any, @Param('projectId') projectId: string) {
    const grant = await this.prisma.repositoryAccessGrant.findFirst({
      where: { projectId, status: 'GRANTED', revokedAt: null },
    } as any);
    // Enforce IDOR: requester must be team member for hasAccess=true
    const project = await this.prisma.project.findUnique({ where: { id: projectId } } as any);
    let isMember = false;
    if (project) {
      const membership = await this.prisma.teamMember.findFirst({ where: { userId: req.user.id, teamId: project.teamId } } as any);
      isMember = !!membership;
    }
    const hasAccess = !!grant && isMember;
    return { projectId, hasAccess: grant ? hasAccess : false, grant: hasAccess ? grant : null };
  }

  @Post('connect')
  async connectRepository(@Req() req: any, @Body() dto: any) {
    // Only leader can connect repository
    const membership = await this.prisma.teamMember.findFirst({
      where: { userId: req.user.id },
    } as any);
    if (!membership) throw new ForbiddenException('Must be in team');
    if (membership.role !== 'LEADER')
      throw new ForbiddenException('Only team leader can connect repository');
    if (!dto.repoUrl || !dto.title)
      throw new BadRequestException('repoUrl and title required');
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
        description: dto.description || dto.title,
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
}
