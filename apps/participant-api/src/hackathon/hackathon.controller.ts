import {
  Controller,
  Get,
  Param,
  UseGuards,
  NotFoundException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PrismaService } from '../database/prisma.service';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

@ApiTags('hackathons')
@ApiBearerAuth()
@Controller('hackathons')
@UseGuards(JwtAuthGuard)
export class HackathonController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('current')
  async getCurrentHackathon() {
    let hackathon = await this.prisma.hackathon.findFirst({
      where: { isPublished: true },
      orderBy: { createdAt: 'desc' },
      include: { announcements: true },
    } as any);

    if (!hackathon) {
      hackathon = await this.prisma.hackathon.create({
        data: {
          title: 'HMT Global AI Hackathon 2026',
          description:
            'Build enterprise-grade AI applications and autonomous agents.',
          problemStatement:
            'Develop an AI-powered software engineering companion and developer platform.',
          rules: [
            'Open Source Code',
            'Automated AST Scan compliant',
            'Original work',
          ],
          resources: [
            { name: 'Participant API Specs', url: '/docs/API_CONTRACT.md' },
            { name: 'Neo4j Graph Schema', url: '/docs/ARCHITECTURE.md' },
          ],
          judgingCriteria: [
            { name: 'Technical Depth & Security', weight: 0.35 },
            { name: 'AI Teammate Capabilities', weight: 0.35 },
            { name: 'User Experience & UX', weight: 0.3 },
          ],
          phases: [
            { name: 'Phase 1: Foundation & Security', status: 'ACTIVE' },
            { name: 'Phase 2: AI Teammate & Code Scan', status: 'UPCOMING' },
            { name: 'Phase 3: Post-Hackathon Roadmap', status: 'UPCOMING' },
          ],
          startDate: new Date(),
          endDate: new Date(Date.now() + 86400000 * 3),
          isPublished: true,
        },
        include: { announcements: true },
      } as any);
      // add announcements explicitly if needed
      await this.prisma.announcement.create({
        data: {
          hackathonId: hackathon.id,
          title: 'Welcome!',
          content: 'Hackathon kickoff announcement',
          isPublished: true,
          visibility: 'PUBLIC_PROFILE',
        },
      } as any);
      const refreshed = await this.prisma.hackathon.findUnique({
        where: { id: hackathon.id },
        include: { announcements: true },
      } as any);
      // filter announcements to published only
      if (refreshed) {
        refreshed.announcements = (refreshed.announcements || []).filter(
          (a: any) =>
            a.isPublished &&
            a.visibility !== 'ORGANIZER_ONLY' &&
            a.visibility !== 'MENTOR_ONLY',
        );
        return refreshed;
      }
    }

    // Ensure we never expose organizer-only announcements
    if (hackathon.announcements) {
      hackathon.announcements = hackathon.announcements.filter(
        (a: any) =>
          a.isPublished &&
          !['ORGANIZER_ONLY', 'MENTOR_ONLY'].includes(a.visibility),
      );
    } else {
      // fetch published announcements separately
      const anns = await this.prisma.announcement.findMany({
        where: { hackathonId: hackathon.id, isPublished: true },
      } as any);
      hackathon.announcements = anns.filter(
        (a: any) => !['ORGANIZER_ONLY', 'MENTOR_ONLY'].includes(a.visibility),
      );
    }
    // Only return participant-visible fields; isPublished internal should not leak organizer drafts
    return {
      id: hackathon.id,
      title: hackathon.title,
      description: hackathon.description,
      problemStatement: hackathon.problemStatement,
      rules: hackathon.rules,
      resources: hackathon.resources,
      judgingCriteria: hackathon.judgingCriteria,
      phases: hackathon.phases,
      startDate: hackathon.startDate,
      endDate: hackathon.endDate,
      announcements: hackathon.announcements,
    };
  }

  @Get(':id')
  async getHackathonById(@Param('id') id: string) {
    const h = await this.prisma.hackathon.findUnique({
      where: { id },
      include: { announcements: true },
    } as any);
    if (!h) throw new NotFoundException('Hackathon not found');
    if (!h.isPublished) throw new NotFoundException('Hackathon not published');
    const filteredAnns = (h.announcements || []).filter(
      (a: any) =>
        a.isPublished &&
        !['ORGANIZER_ONLY', 'MENTOR_ONLY'].includes(a.visibility),
    );
    return { ...h, announcements: filteredAnns };
  }

  @Get(':id/problem-statement')
  async getProblemStatement(@Param('id') id: string) {
    const h = await this.prisma.hackathon.findUnique({ where: { id } } as any);
    if (!h || !h.isPublished)
      throw new NotFoundException('Hackathon not found or not published');
    return {
      problemStatement: h.problemStatement,
      rules: h.rules,
      judgingCriteria: h.judgingCriteria,
      phases: h.phases,
    };
  }

  @Get(':id/resources')
  async getResources(@Param('id') id: string) {
    const h = await this.prisma.hackathon.findUnique({ where: { id } } as any);
    if (!h || !h.isPublished)
      throw new NotFoundException('Hackathon not found');
    return { resources: h.resources || [] };
  }

  @Get(':id/announcements')
  async getAnnouncements(@Param('id') id: string) {
    const h = await this.prisma.hackathon.findUnique({ where: { id } } as any);
    if (!h || !h.isPublished)
      throw new NotFoundException('Hackathon not found');
    const anns = await this.prisma.announcement.findMany({
      where: { hackathonId: id, isPublished: true },
    } as any);
    return anns.filter(
      (a: any) => !['ORGANIZER_ONLY', 'MENTOR_ONLY'].includes(a.visibility),
    );
  }

  @Get(':id/phases')
  async getPhases(@Param('id') id: string) {
    const h = await this.prisma.hackathon.findUnique({ where: { id } } as any);
    if (!h) throw new NotFoundException('Hackathon not found');
    return { phases: h.phases || [] };
  }

  @Get(':id/judging-criteria')
  async getJudgingCriteria(@Param('id') id: string) {
    const h = await this.prisma.hackathon.findUnique({ where: { id } } as any);
    if (!h) throw new NotFoundException('Hackathon not found');
    return { judgingCriteria: h.judgingCriteria || [] };
  }
}
