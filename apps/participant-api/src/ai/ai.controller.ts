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
  Optional,
  Logger,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AiRateLimitGuard } from '../common/guards/rate-limit.guard';
import { PrismaService } from '../database/prisma.service';
import { AIProvider } from './ai.provider.interface';
import {
  AIChatDto,
  CreateConversationDto,
  CreateAnalysisJobDto,
} from './dto/ai.dto';
import { ParticipantTargetedRetrievalService } from '../repository/targeted-retrieval.service';
import { AuditService } from '../audit/audit.service';
import { AIInteractionPersistenceService } from './ai-interaction-persistence.service';
import { AiAccessService } from './ai-access.service';

@ApiTags('ai')
@ApiBearerAuth()
@Controller('ai')
@UseGuards(JwtAuthGuard, AiRateLimitGuard)
export class AIController {
  private readonly logger = new Logger(AIController.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly aiProvider: AIProvider,
    private readonly targetedRetrieval: ParticipantTargetedRetrievalService,
    @Optional() private readonly auditService?: AuditService,
    @Optional() private readonly aiInteractionPersistence?: AIInteractionPersistenceService,
    @Optional() private readonly aiAccess?: AiAccessService,
  ) {}

  private async checkRepositoryAccess(
    projectId: string,
    userId: string,
  ): Promise<boolean> {
    const grant = await this.prisma.repositoryAccessGrant.findFirst({
      where: { projectId, status: 'GRANTED', revokedAt: null },
    } as any);
    if (!grant) return false;
    if (grant.status === 'REVOKED' || grant.revokedAt) return false;
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
    } as any);
    if (!project) return false;
    const membership = await this.prisma.teamMember.findFirst({
      where: { userId, teamId: project.teamId },
    } as any);
    return !!membership;
  }

  private async persistInteraction(params: {
    userId: string;
    teamId?: string | null;
    projectId?: string | null;
    question: string;
    retrieval: { relevantFiles: Array<{ path: string; content: string; retrievalReason: string }>; readmeContext: string | null; retrievalReason?: string; budgetUsed?: { filesRetrieved: number; rounds: number; totalChars: number } };
    analysisScope: string;
    provider?: string | null;
    model?: string | null;
    resultMetadata?: Record<string, unknown> | null;
    latencyMs: number;
    success: boolean;
    errorCode?: string | null;
    hadRepositoryAccess: boolean;
  }): Promise<void> {
    if (!this.aiInteractionPersistence) return;
    try {
      const relevantFilesMeta = params.retrieval.relevantFiles.map((f) => ({
        path: f.path,
        retrievalReason: f.retrievalReason,
        sizeChars: f.content.length,
      }));
      await this.aiInteractionPersistence.persist({
        userId: params.userId,
        teamId: params.teamId ?? null,
        projectId: params.projectId ?? null,
        question: params.question,
        retrievalMeta: {
          readmeContextPreview: params.retrieval.readmeContext?.slice(0, 500) ?? null,
          relevantFilesMeta,
          retrievalReason: params.retrieval.retrievalReason ?? 'TARGETED',
          budgetUsed: params.retrieval.budgetUsed ?? {
            filesRetrieved: params.retrieval.relevantFiles.length,
            rounds: 1,
            totalChars: params.retrieval.relevantFiles.reduce((s, f) => s + f.content.length, 0),
          },
          hadRepositoryAccess: params.hadRepositoryAccess,
        },
        analysisScope: params.analysisScope,
        model: params.model ?? null,
        provider: params.provider ?? null,
        resultMetadata: params.resultMetadata ?? null,
        latencyMs: params.latencyMs,
        success: params.success,
        errorCode: params.errorCode ?? null,
      });
    } catch (e) {
      this.logger.warn(`Failed to persist AI interaction: ${(e as Error).message}`);
    }
  }

  private async buildAIContext(userId: string, projectId?: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    } as any);
    const membership = await this.prisma.teamMember.findFirst({
      where: { userId },
      include: { team: { include: { hackathon: true, project: true } } } as any,
    });
    const team = membership?.team || null;
    let project: any = null;
    let hackathon: any = null;
    let authorizedProjectMeta: any = null;
    let authorizedRepoAnalysis: any = null;

    if (team?.hackathon && team.hackathon.isPublished) hackathon = team.hackathon;
    if (projectId) {
      project = await this.prisma.project.findUnique({
        where: { id: projectId },
      } as any);
    } else if (team?.project) {
      project = team.project;
    }
    if (project) {
      const isMember = !!membership && membership.teamId === project.teamId;
      if (project.visibility === 'TEAM_PRIVATE' && !isMember) {
        project = null;
      } else {
        const hasGrant = await this.checkRepositoryAccess(project.id, userId);
        if (hasGrant) {
          authorizedProjectMeta = {
            id: project.id,
            title: project.title,
            description: project.description,
            techStack: project.techStack,
            repoUrl: project.repoUrl,
          };
          const latestScan = await this.prisma.repositoryScan.findFirst({
            where: { projectId: project.id, status: 'COMPLETED' },
            orderBy: { createdAt: 'desc' },
            include: { findings: true },
          } as any);
          if (latestScan) authorizedRepoAnalysis = latestScan;
        } else {
          authorizedProjectMeta = {
            id: project.id,
            title: project.title,
            description: project.description,
            techStack: project.techStack,
            repoUrl: null,
            note: 'Repository access not granted - AI cannot view repoUrl or findings',
          };
          authorizedRepoAnalysis = null;
        }
      }
    }

    return {
      hackathonContext: hackathon
        ? {
            id: hackathon.id,
            title: hackathon.title,
            problemStatement: hackathon.problemStatement,
            phases: hackathon.phases,
            judgingCriteria: hackathon.judgingCriteria,
          }
        : null,
      participantContext: user
        ? { id: user.id, fullName: user.fullName, email: user.email }
        : null,
      teamContext: team
        ? {
            id: team.id,
            name: team.name,
            visibility: team.visibility,
            members: team.members || [],
          }
        : null,
      authorizedProjectMetadata: authorizedProjectMeta,
      authorizedRepositoryAnalysis: authorizedRepoAnalysis,
    };
  }

  @Get('access-status')
  async accessStatus(@Req() req: any) {
    if (!this.aiAccess) return { allowed: false, code: 'NO_SERVICE' };
    // Query ?projectId= supported via req.query when present.
    const projectId = (req.query?.projectId as string) || undefined;
    return this.aiAccess.checkAccess(req.user.id, projectId);
  }

  @Post('chat')
  async chatWithTeammate(@Req() req: any, @Body() dto: AIChatDto) {
    const started = Date.now();
    const projectId = dto.projectId || null;
    // Backend live-window enforcement (never frontend-only).
    if (this.aiAccess) {
      const access = await this.aiAccess.checkAccess(req.user.id, projectId || undefined);
      if (!access.allowed) {
        throw new ForbiddenException({
          code: access.code,
          message: access.message,
          derivedStatus: access.derivedStatus,
          hackathonId: access.hackathonId,
          eventStart: access.eventStart,
          eventEnd: access.eventEnd,
        } as any);
      }
    }
    let aiContext: any = null;

    if (projectId) {
      const project = await this.prisma.project.findUnique({
        where: { id: projectId },
      } as any);
      if (!project) throw new NotFoundException('Project not found');
      const membership = await this.prisma.teamMember.findFirst({
        where: { userId: req.user.id },
      } as any);
      if (!membership || membership.teamId !== project.teamId)
        throw new ForbiddenException(
          'Not member of project team (IDOR prevented)',
        );
    }

    aiContext = await this.buildAIContext(req.user.id, projectId || undefined);

    let targeted: { relevantFiles: Array<{ path: string; content: string; retrievalReason: string }>; readmeContext: string | null } = {
      relevantFiles: [],
      readmeContext: null,
    };
    if (aiContext.authorizedRepositoryAnalysis) {
      const retrieval = await this.targetedRetrieval.retrieveForQuestion(dto.message, projectId || undefined, req.user.id);
      targeted = { relevantFiles: retrieval.relevantFiles, readmeContext: retrieval.readmeContext,
        retrievalReason: (retrieval as any).retrievalReason, budgetUsed: (retrieval as any).budgetUsed } as any;
    } else {
      const retrieval = await this.targetedRetrieval.retrieveForQuestion(dto.message, undefined, req.user.id);
      targeted = {
        relevantFiles: retrieval.relevantFiles.filter((f) => f.path === 'README.md'),
        readmeContext: retrieval.readmeContext,
      } as any;
      (targeted as any).retrievalReason = (retrieval as any).retrievalReason;
      (targeted as any).budgetUsed = (retrieval as any).budgetUsed;
    }

    // Data minimization: AI receives only question, projectContext, readmeContext, relevantFiles, retrievalReason, analysisScope
    const advice = await this.aiProvider.generateTeammateAdvice({
      userPrompt: dto.message,
      question: dto.message,
      problemStatement: aiContext.hackathonContext?.problemStatement,
      projectTechStack: aiContext.authorizedProjectMetadata?.techStack || [],
      findingsSummary: (
        aiContext.authorizedRepositoryAnalysis?.findings || []
      ).map((f: any) => ({
        title: f.title,
        severity: f.severity,
        category: f.category,
      })),
      relevantFiles: targeted.relevantFiles,
      readmeContext: targeted.readmeContext,
      analysisScope: 'TARGETED',
    });

    // Persist AI interaction (durable, sanitized)
    const hadAccess = !!aiContext.authorizedRepositoryAnalysis;
    await this.persistInteraction({
      userId: req.user.id,
      teamId: aiContext.teamContext?.id ?? null,
      projectId: aiContext.authorizedProjectMetadata?.id ?? projectId,
      question: dto.message,
      retrieval: targeted as any,
      analysisScope: 'TARGETED',
      provider: (advice as any).provider ?? null,
      model: null,
      resultMetadata: { recommendationsCount: advice.recommendations.length, hadRepositoryAccess: hadAccess },
      latencyMs: Date.now() - started,
      success: true,
      hadRepositoryAccess: hadAccess,
    });

    // audit for analysis (requested) — if projectId present
    if (projectId) {
      if (hadAccess) {
        if (this.auditService) await this.auditService.logAnalysisRequested(req.user.id, projectId).catch(() => {});
      } else {
        // not an error, but for chat without grant we don't deny — AI still answers with limited context
      }
    }

    if (dto.conversationId) {
      const conv = await this.prisma.aiConversation.findUnique({
        where: { id: dto.conversationId },
      } as any);
      if (!conv) throw new NotFoundException('Conversation not found');
      if (conv.userId !== req.user.id)
        throw new ForbiddenException('Not your conversation (IDOR prevented)');
      await this.prisma.aiMessage.create({
        data: {
          conversationId: dto.conversationId,
          role: 'USER',
          content: dto.message,
        },
      } as any);
      await this.prisma.aiMessage.create({
        data: {
          conversationId: dto.conversationId,
          role: 'ASSISTANT',
          content: advice.answer,
        },
      } as any);
      for (const rec of advice.recommendations) {
        await this.prisma.aiRecommendation.create({
          data: {
            jobId: null,
            projectId: aiContext.authorizedProjectMetadata?.id || null,
            title: rec.title,
            action: rec.action,
            impact: rec.impact,
            category: rec.category,
          },
        } as any);
      }
    }

    return {
      ...advice,
      aiContextUsed: {
        hackathonId: aiContext.hackathonContext?.id || null,
        projectId: aiContext.authorizedProjectMetadata?.id || null,
        hadRepositoryAccess: hadAccess,
        teamId: aiContext.teamContext?.id || null,
      },
      privacyEnforced:
        !aiContext.authorizedRepositoryAnalysis &&
        !!aiContext.authorizedProjectMetadata,
    };
  }

  @Get('recommendations')
  async getWinningRecommendations(@Req() req: any) {
    const advice = await this.aiProvider.generateTeammateAdvice({
      userPrompt:
        'Give me prioritized strategy recommendations to win this hackathon.',
    });

    return {
      recommendations: advice.recommendations,
      hackathonStrategyTip: advice.hackathonStrategyTip,
    };
  }

  // ---------- AI Conversation Contract ----------
  @Post('conversations')
  async createConversation(
    @Req() req: any,
    @Body() dto: CreateConversationDto,
  ) {
    if (this.aiAccess) {
      const access = await this.aiAccess.checkAccess(req.user.id, dto.projectId);
      if (!access.allowed) {
        throw new ForbiddenException({
          code: access.code,
          message: access.message,
          derivedStatus: access.derivedStatus,
          hackathonId: access.hackathonId,
        } as any);
      }
    }
    const started = Date.now();
    const projectId = dto.projectId;
    if (projectId) {
      const proj = await this.prisma.project.findUnique({
        where: { id: projectId },
      } as any);
      if (!proj) throw new NotFoundException('Project not found');
      const mem = await this.prisma.teamMember.findFirst({
        where: { userId: req.user.id },
      } as any);
      if (!mem || mem.teamId !== proj.teamId)
        throw new ForbiddenException('Not member');
    }
    const conv = await this.prisma.aiConversation.create({
      data: {
        userId: req.user.id,
        projectId: projectId || null,
        title: dto.title || 'AI Teammate Chat',
      },
    } as any);
    await this.prisma.aiMessage.create({
      data: {
        conversationId: conv.id,
        role: 'USER',
        content: dto.initialMessage,
      },
    } as any);
    const aiContext = await this.buildAIContext(req.user.id, projectId);
    let targeted2: { relevantFiles: Array<{ path: string; content: string; retrievalReason: string }>; readmeContext: string | null } = {
      relevantFiles: [],
      readmeContext: null,
    };
    if (aiContext.authorizedRepositoryAnalysis) {
      const retrieval = await this.targetedRetrieval.retrieveForQuestion(dto.initialMessage, projectId, req.user.id);
      targeted2 = { relevantFiles: retrieval.relevantFiles, readmeContext: retrieval.readmeContext, retrievalReason: (retrieval as any).retrievalReason, budgetUsed: (retrieval as any).budgetUsed } as any;
    } else {
      const retrieval = await this.targetedRetrieval.retrieveForQuestion(dto.initialMessage, undefined, req.user.id);
      targeted2 = {
        relevantFiles: retrieval.relevantFiles.filter((f) => f.path === 'README.md'),
        readmeContext: retrieval.readmeContext,
      } as any;
      (targeted2 as any).retrievalReason = (retrieval as any).retrievalReason;
      (targeted2 as any).budgetUsed = (retrieval as any).budgetUsed;
    }
    const advice = await this.aiProvider.generateTeammateAdvice({
      userPrompt: dto.initialMessage,
      question: dto.initialMessage,
      problemStatement: aiContext.hackathonContext?.problemStatement,
      projectTechStack: aiContext.authorizedProjectMetadata?.techStack || [],
      findingsSummary: (
        aiContext.authorizedRepositoryAnalysis?.findings || []
      ).map((f: any) => ({
        title: f.title,
        severity: f.severity,
        category: f.category,
      })),
      relevantFiles: targeted2.relevantFiles,
      readmeContext: targeted2.readmeContext,
      analysisScope: 'TARGETED',
    });
    await this.prisma.aiMessage.create({
      data: {
        conversationId: conv.id,
        role: 'ASSISTANT',
        content: advice.answer,
      },
    } as any);
    // Persist interaction
    await this.persistInteraction({
      userId: req.user.id,
      teamId: aiContext.teamContext?.id ?? null,
      projectId: projectId ?? aiContext.authorizedProjectMetadata?.id ?? null,
      question: dto.initialMessage,
      retrieval: targeted2 as any,
      analysisScope: 'TARGETED',
      resultMetadata: { hadRepositoryAccess: !!aiContext.authorizedRepositoryAnalysis },
      latencyMs: Date.now() - started,
      success: true,
      hadRepositoryAccess: !!aiContext.authorizedRepositoryAnalysis,
    });
    const messages = await this.prisma.aiMessage.findMany({
      where: { conversationId: conv.id },
      orderBy: { createdAt: 'asc' },
    } as any);
    return {
      conversation: conv,
      messages,
      recommendations: advice.recommendations,
      aiContext: {
        hadRepositoryAccess: !!aiContext.authorizedRepositoryAnalysis,
      },
    };
  }

  @Get('conversations')
  async listConversations(@Req() req: any) {
    const convs = await this.prisma.aiConversation.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: 'desc' },
    } as any);
    return convs;
  }

  @Get('conversations/:id')
  async getConversation(@Req() req: any, @Param('id') id: string) {
    const conv = await this.prisma.aiConversation.findUnique({
      where: { id },
    } as any);
    if (!conv) throw new NotFoundException('Conversation not found');
    if (conv.userId !== req.user.id && req.user.role !== 'ADMIN')
      throw new ForbiddenException('Not your conversation (IDOR prevented)');
    const messages = await this.prisma.aiMessage.findMany({
      where: { conversationId: id },
      orderBy: { createdAt: 'asc' },
    } as any);
    return { conversation: conv, messages };
  }

  @Post('conversations/:id/messages')
  async postMessage(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: AIChatDto,
  ) {
    if (this.aiAccess) {
      const access = await this.aiAccess.checkAccess(req.user.id, dto.projectId);
      if (!access.allowed) {
        throw new ForbiddenException({
          code: access.code,
          message: access.message,
          derivedStatus: access.derivedStatus,
          hackathonId: access.hackathonId,
        } as any);
      }
    }
    const started = Date.now();
    const conv = await this.prisma.aiConversation.findUnique({
      where: { id },
    } as any);
    if (!conv) throw new NotFoundException('Conversation not found');
    if (conv.userId !== req.user.id)
      throw new ForbiddenException('IDOR prevented');
    await this.prisma.aiMessage.create({
      data: { conversationId: id, role: 'USER', content: dto.message },
    } as any);
    const aiContext = await this.buildAIContext(req.user.id, conv.projectId);
    let targeted3: { relevantFiles: Array<{ path: string; content: string; retrievalReason: string }>; readmeContext: string | null } = {
      relevantFiles: [],
      readmeContext: null,
    };
    if (aiContext.authorizedRepositoryAnalysis) {
      const retrieval = await this.targetedRetrieval.retrieveForQuestion(dto.message, conv.projectId, req.user.id);
      targeted3 = { relevantFiles: retrieval.relevantFiles, readmeContext: retrieval.readmeContext, retrievalReason: (retrieval as any).retrievalReason, budgetUsed: (retrieval as any).budgetUsed } as any;
    } else {
      const retrieval = await this.targetedRetrieval.retrieveForQuestion(dto.message, undefined, req.user.id);
      targeted3 = {
        relevantFiles: retrieval.relevantFiles.filter((f) => f.path === 'README.md'),
        readmeContext: retrieval.readmeContext,
      } as any;
      (targeted3 as any).retrievalReason = (retrieval as any).retrievalReason;
      (targeted3 as any).budgetUsed = (retrieval as any).budgetUsed;
    }
    const advice = await this.aiProvider.generateTeammateAdvice({
      userPrompt: dto.message,
      question: dto.message,
      problemStatement: aiContext.hackathonContext?.problemStatement,
      projectTechStack: aiContext.authorizedProjectMetadata?.techStack || [],
      findingsSummary: (
        aiContext.authorizedRepositoryAnalysis?.findings || []
      ).map((f: any) => ({
        title: f.title,
        severity: f.severity,
        category: f.category,
      })),
      relevantFiles: targeted3.relevantFiles,
      readmeContext: targeted3.readmeContext,
      analysisScope: 'TARGETED',
    });
    await this.prisma.aiMessage.create({
      data: { conversationId: id, role: 'ASSISTANT', content: advice.answer },
    } as any);
    await this.persistInteraction({
      userId: req.user.id,
      teamId: aiContext.teamContext?.id ?? null,
      projectId: conv.projectId ?? aiContext.authorizedProjectMetadata?.id ?? null,
      question: dto.message,
      retrieval: targeted3 as any,
      analysisScope: 'TARGETED',
      resultMetadata: { hadRepositoryAccess: !!aiContext.authorizedRepositoryAnalysis },
      latencyMs: Date.now() - started,
      success: true,
      hadRepositoryAccess: !!aiContext.authorizedRepositoryAnalysis,
    });
    return {
      answer: advice.answer,
      recommendations: advice.recommendations,
      hadRepositoryAccess: !!aiContext.authorizedRepositoryAnalysis,
    };
  }

  // ---------- AI Analysis Job Contract ----------
  @Post('analysis-jobs')
  async createAnalysisJob(@Req() req: any, @Body() dto: CreateAnalysisJobDto) {
    if (this.aiAccess) {
      const access = await this.aiAccess.checkAccess(req.user.id, dto.projectId);
      if (!access.allowed) {
        throw new ForbiddenException({
          code: access.code,
          message: access.message,
          derivedStatus: access.derivedStatus,
          hackathonId: access.hackathonId,
        } as any);
      }
    }
    const project = await this.prisma.project.findUnique({
      where: { id: dto.projectId },
    } as any);
    if (!project) throw new NotFoundException('Project not found');
    const membership = await this.prisma.teamMember.findFirst({
      where: { userId: req.user.id },
    } as any);
    if (!membership || membership.teamId !== project.teamId)
      throw new ForbiddenException('IDOR prevented');
    const hasGrant = await this.checkRepositoryAccess(
      dto.projectId,
      req.user.id,
    );
    if (!hasGrant) {
      if (this.auditService) await this.auditService.logAnalysisDenied(req.user.id, dto.projectId, 'No active grant').catch(() => {});
      else
        await this.prisma.auditLog
          .create({
            data: { userId: req.user.id, action: 'AI_REPOSITORY_ANALYSIS_DENIED', resource: `project:${dto.projectId}`, details: { projectId: dto.projectId, reason: 'No active grant' } },
          } as any)
          .catch(() => {});
      throw new ForbiddenException(
        'AI repository analysis requires team leader grant (NO GRANT → NO AI ACCESS)',
      );
    }
    if (this.auditService) await this.auditService.logAnalysisRequested(req.user.id, dto.projectId).catch(() => {});
    else
      await this.prisma.auditLog
        .create({
          data: { userId: req.user.id, action: 'AI_REPOSITORY_ANALYSIS_REQUESTED', resource: `project:${dto.projectId}`, details: { projectId: dto.projectId } },
        } as any)
        .catch(() => {});
    const job = await this.prisma.aiAnalysisJob.create({
      data: {
        projectId: dto.projectId,
        status: 'SCANNING',
        type: dto.type || 'REPOSITORY_ANALYSIS',
      },
    } as any);
    // persist interaction for analysis request (durable)
    if (this.aiInteractionPersistence) {
      await this.persistInteraction({
        userId: req.user.id,
        teamId: project.teamId,
        projectId: dto.projectId,
        question: `AI analysis job: ${dto.type || 'REPOSITORY_ANALYSIS'}`,
        retrieval: { relevantFiles: [], readmeContext: null, retrievalReason: 'ANALYSIS_JOB', budgetUsed: { filesRetrieved: 0, rounds: 0, totalChars: 0 } } as any,
        analysisScope: 'TARGETED',
        latencyMs: 0,
        success: true,
        hadRepositoryAccess: true,
        resultMetadata: { jobId: job.id, type: dto.type || 'REPOSITORY_ANALYSIS' },
      });
    }
    setTimeout(async () => {
      try {
        const scan = await this.prisma.repositoryScan.findFirst({
          where: { projectId: dto.projectId, status: 'COMPLETED' },
          orderBy: { createdAt: 'desc' },
          include: { findings: true },
        } as any);
        const findings = scan?.findings || [];
        for (const f of findings.slice(0, 3)) {
          await this.prisma.aiFinding.create({
            data: {
              jobId: job.id,
              severity: f.severity,
              category: f.category,
              title: f.title,
              description: f.description,
            },
          } as any);
        }
        const advice = await this.aiProvider.generateTeammateAdvice({
          userPrompt: 'Analyze repository and provide recommendations',
          problemStatement: 'AI teammate analysis',
          projectTechStack: project.techStack,
          findingsSummary: findings.map((f: any) => ({
            title: f.title,
            severity: f.severity,
            category: f.category,
          })),
        });
        for (const rec of advice.recommendations) {
          await this.prisma.aiRecommendation.create({
            data: {
              jobId: job.id,
              projectId: dto.projectId,
              title: rec.title,
              action: rec.action,
              impact: rec.impact,
              category: rec.category,
            },
          } as any);
        }
        await this.prisma.aiAnalysisJob.update({
          where: { id: job.id },
          data: {
            status: 'COMPLETED',
            result: {
              findingsCount: findings.length,
              recommendations: advice.recommendations,
            },
          },
        } as any);
      } catch (e) {
        await this.prisma.aiAnalysisJob.update({
          where: { id: job.id },
          data: { status: 'FAILED' },
        } as any);
      }
    }, 500);
    return job;
  }

  @Get('analysis-jobs/:id')
  async getAnalysisJob(@Req() req: any, @Param('id') id: string) {
    const job = await this.prisma.aiAnalysisJob.findUnique({
      where: { id },
    } as any);
    if (!job) throw new NotFoundException('Job not found');
    const project = await this.prisma.project.findUnique({
      where: { id: job.projectId },
    } as any);
    if (!project) throw new NotFoundException('Project not found');
    const membership = await this.prisma.teamMember.findFirst({
      where: { userId: req.user.id },
    } as any);
    if (!membership || membership.teamId !== project.teamId)
      throw new ForbiddenException('IDOR prevented');
    const hasGrant = await this.checkRepositoryAccess(job.projectId, req.user.id);
    if (!hasGrant) throw new ForbiddenException('AI findings require grant');
    const findings = await this.prisma.aiFinding.findMany({
      where: { jobId: id },
    } as any);
    const recommendations = await this.prisma.aiRecommendation.findMany({
      where: { jobId: id },
    } as any);
    return { job, findings, recommendations };
  }

  @Get('analysis-jobs')
  async listAnalysisJobs(@Req() req: any) {
    const membership = await this.prisma.teamMember.findFirst({
      where: { userId: req.user.id },
      include: { team: { include: { project: true } } },
    } as any);
    if (!membership?.team?.project) return { jobs: [] };
    // Post-revocation: do not enumerate jobs generated pre-revoke without an active grant.
    const hasGrant = await this.checkRepositoryAccess(membership.team.project.id, req.user.id);
    if (!hasGrant) return { jobs: [] };
    const jobs = await this.prisma.aiAnalysisJob.findMany({
      where: { projectId: membership.team.project.id },
      orderBy: { createdAt: 'desc' },
    } as any);
    return { jobs };
  }

  @Get('findings/:jobId')
  async getFindings(@Req() req: any, @Param('jobId') jobId: string) {
    const job = await this.prisma.aiAnalysisJob.findUnique({
      where: { id: jobId },
    } as any);
    if (!job) throw new NotFoundException('Job not found');
    const project = await this.prisma.project.findUnique({
      where: { id: job.projectId },
    } as any);
    if (!project) throw new NotFoundException('Project not found');
    const membership = await this.prisma.teamMember.findFirst({
      where: { userId: req.user.id },
    } as any);
    if (!membership || membership.teamId !== project.teamId)
      throw new ForbiddenException('IDOR prevented');
    const hasGrant = await this.checkRepositoryAccess(
      job.projectId,
      req.user.id,
    );
    if (!hasGrant) {
      if (this.auditService) await this.auditService.logAnalysisDenied(req.user.id, job.projectId, 'No grant for findings').catch(() => {});
      throw new ForbiddenException('AI findings require grant');
    }
    const findings = await this.prisma.aiFinding.findMany({
      where: { jobId },
    } as any);
    return findings;
  }

  @Get('recommendations/list')
  async listRecommendations(@Req() req: any) {
    const membership = await this.prisma.teamMember.findFirst({
      where: { userId: req.user.id },
      include: { team: { include: { project: true } } },
    } as any);
    if (!membership?.team?.project) return { recommendations: [] };
    const hasGrant = await this.checkRepositoryAccess(membership.team.project.id, req.user.id);
    if (!hasGrant) return { recommendations: [] };
    const recs = await this.prisma.aiRecommendation.findMany({
      where: { projectId: membership.team.project.id },
    } as any);
    return { recommendations: recs };
  }
}
