import {
  Controller,
  Post,
  Get,
  Param,
  UseGuards,
  Req,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PrismaService } from '../database/prisma.service';
import { RepositoryAnalysisEngine } from './repository-analysis.engine';
import { ScanStatus } from '@prisma/client';

import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

@ApiTags('repository')
@ApiBearerAuth()
@Controller('repository')
@UseGuards(JwtAuthGuard)
export class RepositoryController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scanner: RepositoryAnalysisEngine,
  ) {}

  @Post('analyze')
  async triggerAnalysis(@Req() req: any) {
    const membership = await this.prisma.teamMember.findFirst({
      where: { userId: req.user.id },
      include: { team: { include: { project: true } } },
    });

    if (!membership || !membership.team.project) {
      throw new BadRequestException(
        'Team must register a project repository before requesting analysis',
      );
    }

    const project = membership.team.project;

    const scan = await this.prisma.repositoryScan.create({
      data: {
        projectId: project.id,
        status: ScanStatus.SCANNING,
      },
    });

    // Execute scan asynchronously with error handling
    this.scanner
      .scanRepository(project.repoUrl || 'https://github.com/hmt/project')
      .then(async (result) => {
        await this.prisma.repositoryScan.update({
          where: { id: scan.id },
          data: {
            status: ScanStatus.COMPLETED,
            commitHash: result.commitHash,
            score: result.score,
            findings: {
              create: result.findings.map((f) => ({
                severity: f.severity,
                category: f.category,
                file: f.file,
                line: f.line,
                title: f.title,
                description: f.description,
                suggestedFix: f.suggestedFix,
                confidence: f.confidence,
              })),
            },
          },
        });
      })
      .catch(async (err) => {
        await this.prisma.repositoryScan.update({
          where: { id: scan.id },
          data: { status: ScanStatus.FAILED },
        });
      });

    return {
      scanId: scan.id,
      status: ScanStatus.SCANNING,
      message: 'Repository static analysis triggered successfully',
    };
  }

  @Get('status/:scanId')
  async getScanStatus(@Req() req: any, @Param('scanId') scanId: string) {
    const scan = await this.prisma.repositoryScan.findUnique({
      where: { id: scanId },
      include: { findings: true },
    });

    if (!scan) {
      throw new NotFoundException('Scan record not found');
    }

    // Ownership check: ensure requester belongs to scan's project team (IDOR fix: deny if no membership or mismatch)
    const membership = await this.prisma.teamMember.findFirst({
      where: { userId: req.user.id },
      include: { team: { include: { project: true } } },
    });
    if (!membership?.team?.project) {
      throw new NotFoundException('Scan record not found');
    }
    if (scan.projectId !== membership.team.project.id) {
      throw new NotFoundException('Scan record not found');
    }

    // Also verify privacy: mentor-private feedback not leaked via findings? findings are already filtered per project
    return scan;
  }

  @Get('findings')
  async getLatestFindings(@Req() req: any) {
    const membership = await this.prisma.teamMember.findFirst({
      where: { userId: req.user.id },
      include: { team: { include: { project: true } } },
    });

    if (!membership || !membership.team.project) {
      return { findings: [] };
    }

    const latestScan = await this.prisma.repositoryScan.findFirst({
      where: {
        projectId: membership.team.project.id,
        status: ScanStatus.COMPLETED,
      },
      orderBy: { createdAt: 'desc' },
      include: { findings: true },
    });

    return {
      scan: latestScan,
      findings: latestScan?.findings || [],
    };
  }
}
