import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  UseGuards,
  Req,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PrismaService } from '../database/prisma.service';
import { AIProvider } from '../ai/ai.provider.interface';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

@ApiTags('post-hackathon')
@ApiBearerAuth()
@Controller('post-hackathon')
@UseGuards(JwtAuthGuard)
export class PostHackathonController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly aiProvider: AIProvider,
  ) {}

  @Post('roadmap')
  async generateRoadmap(@Req() req: any) {
    const membership = await this.prisma.teamMember.findFirst({
      where: { userId: req.user.id },
      include: {
        team: { include: { project: { include: { feedbacks: true } } } },
      },
    } as any);

    if (!membership?.team?.project) {
      throw new BadRequestException(
        'Participant must have a project to build continuation roadmap',
      );
    }

    const project = membership.team.project;

    const roadmapData = await this.aiProvider.generatePostHackathonRoadmap({
      projectTitle: project.title,
      projectDescription: project.description,
      techStack: project.techStack,
      mentorFeedback: (project.feedbacks || []).map((f: any) => f.feedback),
    });

    const record = await this.prisma.postHackathonContinuation.create({
      data: {
        projectId: project.id,
        marketSummary: roadmapData.marketSummary,
        roadmap: roadmapData.roadmapPhases as any,
        targetUsers: roadmapData.targetUsers,
        nextSteps: roadmapData.nextImmediateSteps,
      },
    } as any);

    // Also create structured ProjectContinuation and RoadmapItems (foundation without market AI)
    await this.prisma.projectContinuation
      .upsert({
        where: { projectId: project.id },
        update: { description: roadmapData.marketSummary },
        create: {
          projectId: project.id,
          status: 'PLANNING',
          description: roadmapData.marketSummary,
        },
      } as any)
      .catch(() => {});

    for (const phase of roadmapData.roadmapPhases) {
      for (const goal of phase.goals) {
        await this.prisma.roadmapItem
          .create({
            data: {
              projectId: project.id,
              phase: phase.phaseName,
              title: goal,
              status: 'PLANNED',
            },
          } as any)
          .catch(() => {});
      }
    }

    for (const user of roadmapData.targetUsers) {
      await this.prisma.projectOpportunity
        .create({
          data: {
            projectId: project.id,
            title: `Opportunity: ${user}`,
            description: `Target user segment ${user}`,
            type: 'MARKET',
          },
        } as any)
        .catch(() => {});
    }

    return {
      id: record.id,
      projectId: project.id,
      marketSummary: roadmapData.marketSummary,
      targetUsers: roadmapData.targetUsers,
      roadmapPhases: roadmapData.roadmapPhases,
      nextImmediateSteps: roadmapData.nextImmediateSteps,
    };
  }

  @Get('continuation/:projectId')
  async getContinuation(
    @Req() req: any,
    @Param('projectId') projectId: string,
  ) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
    } as any);
    if (!project) throw new NotFoundException('Project not found');
    const membership = await this.prisma.teamMember.findFirst({
      where: { userId: req.user.id },
    } as any);
    if (!membership || membership.teamId !== project.teamId)
      throw new ForbiddenException('IDOR prevented');
    const continuation = await this.prisma.projectContinuation.findUnique({
      where: { projectId },
    } as any);
    const opportunities = await this.prisma.projectOpportunity.findMany({
      where: { projectId },
    } as any);
    const roadmapItems = await this.prisma.roadmapItem.findMany({
      where: { projectId },
    } as any);
    const continuations = await this.prisma.postHackathonContinuation.findMany({
      where: { projectId },
    } as any);
    return { continuation, opportunities, roadmapItems, continuations };
  }

  @Post('continuation')
  async createContinuation(@Req() req: any, @Body() dto: any) {
    if (!dto.projectId) throw new BadRequestException('projectId required');
    const project = await this.prisma.project.findUnique({
      where: { id: dto.projectId },
    } as any);
    if (!project) throw new NotFoundException('Project not found');
    const membership = await this.prisma.teamMember.findFirst({
      where: { userId: req.user.id },
    } as any);
    if (!membership || membership.teamId !== project.teamId)
      throw new ForbiddenException('Not team member');
    const cont = await this.prisma.projectContinuation.create({
      data: {
        projectId: dto.projectId,
        status: dto.status || 'PLANNING',
        description: dto.description,
      },
    } as any);
    return cont;
  }

  @Post('opportunities')
  async createOpportunity(@Req() req: any, @Body() dto: any) {
    if (!dto.projectId || !dto.title)
      throw new BadRequestException('projectId and title required');
    const project = await this.prisma.project.findUnique({
      where: { id: dto.projectId },
    } as any);
    if (!project) throw new NotFoundException('Project not found');
    const membership = await this.prisma.teamMember.findFirst({
      where: { userId: req.user.id },
    } as any);
    if (!membership || membership.teamId !== project.teamId)
      throw new ForbiddenException('IDOR prevented');
    const opp = await this.prisma.projectOpportunity.create({
      data: {
        projectId: dto.projectId,
        title: dto.title,
        description: dto.description || dto.title,
        type: dto.type || 'GENERAL',
        url: dto.url,
      },
    } as any);
    return opp;
  }

  @Get('opportunities/:projectId')
  async listOpportunities(
    @Req() req: any,
    @Param('projectId') projectId: string,
  ) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
    } as any);
    if (!project) throw new NotFoundException('Project not found');
    const membership = await this.prisma.teamMember.findFirst({
      where: { userId: req.user.id },
    } as any);
    if (!membership || membership.teamId !== project.teamId)
      throw new ForbiddenException('IDOR prevented');
    const opps = await this.prisma.projectOpportunity.findMany({
      where: { projectId },
    } as any);
    return opps;
  }

  @Post('resources')
  async createResource(@Req() req: any, @Body() dto: any) {
    if (!dto.title || !dto.url)
      throw new BadRequestException('title and url required');
    const res = await this.prisma.recommendedResource.create({
      data: {
        projectId: dto.projectId || null,
        title: dto.title,
        url: dto.url,
        category: dto.category || 'GENERAL',
      },
    } as any);
    return res;
  }

  @Get('resources')
  async getContinuationResources(@Req() req: any) {
    // also return stored recommended resources
    const stored = await this.prisma.recommendedResource
      .findMany({ where: {} } as any)
      .catch(() => []);
    return {
      suggestedAccelerators: [
        {
          name: 'Y Combinator Developer Tools Batch',
          url: 'https://ycombinator.com/apply',
        },
        { name: 'Open Source AI Grant Program', url: 'https://aigrant.org' },
      ],
      recommendedReading: [
        'Building SaaS Developer Tools with NestJS and Fastify',
        'Graph Database Modeling with Neo4j & Cypher',
      ],
      storedResources: stored,
    };
  }

  @Post('roadmap-items')
  async createRoadmapItem(@Req() req: any, @Body() dto: any) {
    if (!dto.projectId || !dto.title)
      throw new BadRequestException('projectId and title required');
    const project = await this.prisma.project.findUnique({
      where: { id: dto.projectId },
    } as any);
    if (!project) throw new NotFoundException('Project not found');
    const membership = await this.prisma.teamMember.findFirst({
      where: { userId: req.user.id },
    } as any);
    if (!membership || membership.teamId !== project.teamId)
      throw new ForbiddenException('IDOR prevented');
    const item = await this.prisma.roadmapItem.create({
      data: {
        projectId: dto.projectId,
        phase: dto.phase || 'Phase 1',
        title: dto.title,
        description: dto.description,
        status: dto.status || 'PLANNED',
        dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
      },
    } as any);
    return item;
  }

  @Get('roadmap-items/:projectId')
  async listRoadmapItems(
    @Req() req: any,
    @Param('projectId') projectId: string,
  ) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
    } as any);
    if (!project) throw new NotFoundException('Project not found');
    const membership = await this.prisma.teamMember.findFirst({
      where: { userId: req.user.id },
    } as any);
    if (!membership || membership.teamId !== project.teamId)
      throw new ForbiddenException('IDOR prevented');
    const items = await this.prisma.roadmapItem.findMany({
      where: { projectId },
    } as any);
    return items;
  }
}
