import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { PrismaService } from '../database/prisma.service';
import { Neo4jService } from '../database/neo4j.service';
import {
  IngestFeedbackDto,
  IngestEliminationDto,
  CreatePhaseProgressDto,
  CreateMistakeDto,
  CreateImprovementAreaDto,
  CreateEvaluationDto,
  CreateParticipantInsightDto,
} from './dto/performance.dto';
import { Role } from '@prisma/client';

@ApiTags('performance')
@ApiBearerAuth()
@Controller('performance')
@UseGuards(JwtAuthGuard)
export class PerformanceController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly neo4j: Neo4jService,
  ) {}

  private async getProjectForUser(userId: string, projectId?: string) {
    // if projectId given, verify ownership via team membership
    const membership = await this.prisma.teamMember.findFirst({
      where: { userId },
      include: { team: { include: { project: true } } },
    } as any);
    const ownedProjectId = membership?.team?.project?.id || null;
    if (projectId) {
      const proj = await this.prisma.project.findUnique({
        where: { id: projectId },
      } as any);
      if (!proj) throw new NotFoundException('Project not found');
      // IDOR check: if participant requesting another team's project, forbid unless organizer/mentor and published? but for history we strictly enforce membership
      if (
        proj.id !== ownedProjectId &&
        !['ORGANIZER', 'ADMIN', 'MENTOR'].includes(
          (await this.prisma.user.findUnique({ where: { id: userId } } as any))
            ?.role,
        )
      ) {
        // for participant history, only allow own project
        throw new ForbiddenException(
          'Not authorized to access this project history (IDOR prevented)',
        );
      }
      return proj;
    }
    if (!membership?.team?.project) return null;
    return membership.team.project;
  }

  // ---------- Timeline (requires ownership) ----------
  @Get('timeline')
  async getPerformanceTimeline(@Req() req: any, @Query('projectId') projectId?: string) {
    // Optional project scoping for multi-hackathon participants (additive:
    // without the parameter, legacy first-membership behavior applies).
    let membership: any = null;
    let scopedProject: any = null;
    if (projectId) {
      scopedProject = await this.prisma.project.findUnique({
        where: { id: projectId },
      } as any);
      if (!scopedProject) throw new NotFoundException('Project not found');
      membership = await this.prisma.teamMember.findFirst({
        where: { userId: req.user.id, teamId: scopedProject.teamId },
      } as any);
      if (req.user.role === 'PARTICIPANT' && !membership)
        throw new ForbiddenException('IDOR prevented');
    } else {
      membership = await this.prisma.teamMember.findFirst({
        where: { userId: req.user.id },
        include: { team: { include: { project: true } } },
      } as any);

      if (!membership?.team?.project) {
        return {
          timeline: [],
          message: 'No project associated with participant team.',
        };
      }
      scopedProject = membership.team.project;
    }

    const projectIdResolved = scopedProject.id;

    const [
      feedbacks,
      scans,
      elimination,
      phaseProgress,
      mistakes,
      evaluations,
    ] = await Promise.all([
      // Only published feedback visible to participant; but timeline aggregates all? spec says only published returned
      this.prisma.mentorFeedback.findMany({
        where: { projectId: projectIdResolved, isPublished: true },
        orderBy: { createdAt: 'desc' },
      } as any),
      this.prisma.repositoryScan.findMany({
        where: { projectId: projectIdResolved },
        orderBy: { createdAt: 'desc' },
        include: { findings: true },
      } as any),
      this.prisma.eliminationRecord.findUnique({ where: { projectId: projectIdResolved } } as any),
      this.prisma.phaseProgress
        .findMany({ where: { projectId: projectIdResolved, isPublished: true } } as any)
        .catch(() => []),
      this.prisma.mistake
        .findMany({ where: { projectId: projectIdResolved, isPublished: true } } as any)
        .catch(() => []),
      this.prisma.evaluation
        .findMany({ where: { projectId: projectIdResolved, isPublished: true } } as any)
        .catch(() => []),
    ]);

    return {
      projectId: projectIdResolved,
      feedbacks,
      scans,
      elimination,
      phaseProgress,
      mistakes,
      evaluations,
    };
  }

  // ---------- Mentor Feedback: immutable create + publish workflow ----------
  @Post('mentor-feedback')
  async ingestMentorFeedback(@Req() req: any, @Body() dto: IngestFeedbackDto) {
    // STRICT: Only MENTOR, ORGANIZER, ADMIN can create mentor feedback (OWASP + feedback integrity)
    if (!['MENTOR', 'ORGANIZER', 'ADMIN'].includes(req.user.role)) {
      throw new ForbiddenException('Only mentors/organizers can submit feedback (immutable workflow)');
    }
    // Validate project exists
    const project = await this.prisma.project.findUnique({
      where: { id: dto.projectId },
    } as any);
    if (!project) throw new NotFoundException('Project not found');
    // If mentor tries to submit feedback for unassigned team, prevent IDOR unless organizer/admin
    if (req.user.role === 'MENTOR') {
      // In participant context we cannot verify mentor assignment like organizer; allow but audit teamId
      // For strictness, ensure mentor is assigned via at least being able to see project? For now allow, but log
    }
    if (req.user.role === 'PARTICIPANT') {
      const membership = await this.prisma.teamMember.findFirst({
        where: { userId: req.user.id },
      } as any);
      if (!membership || membership.teamId !== project.teamId) {
        throw new ForbiddenException(
          'Participants cannot submit feedback for other teams (IDOR prevented)',
        );
      }
    }

    const fb = await this.prisma.mentorFeedback.create({
      data: {
        projectId: dto.projectId,
        author: dto.author,
        authorId: dto.authorId || req.user.id,
        role: dto.role,
        phase: dto.phase,
        feedback: dto.feedback,
        rating: dto.rating,
        isPublished: dto.isPublished ?? false,
        version: 1,
      },
    } as any);

    await this.prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'MENTOR_FEEDBACK_CREATED',
        resource: `feedback:${fb.id}`,
        details: {
          projectId: dto.projectId,
          version: 1,
          isPublished: fb.isPublished,
        },
      },
    } as any);

    this.neo4j
      .write(
        `
      MERGE (pr:Project {id: $projectId})
      CREATE (mf:MentorFeedback {id: $id, author: $author, phase: $phase, text: $feedback, version: $version})
      CREATE (mf)-[:TARGETS]->(pr)
      `,
        {
          projectId: dto.projectId,
          id: fb.id,
          author: dto.author,
          phase: dto.phase,
          feedback: dto.feedback,
          version: 1,
        },
      )
      .catch(() => {});

    return fb;
  }

  @Post('mentor-feedback/:id/publish')
  async publishMentorFeedback(@Req() req: any, @Param('id') id: string) {
    const fb = await this.prisma.mentorFeedback.findUnique({
      where: { id },
    } as any);
    if (!fb) throw new NotFoundException('Feedback not found');
    // Only ORGANIZER/ADMIN can publish; MENTOR cannot publish (transparency workflow)
    if (!['ORGANIZER', 'ADMIN'].includes(req.user.role))
      throw new ForbiddenException('Only organizer can publish feedback');
    // Organizer must NEVER edit original mentor record - we only flip isPublished via allowed update path in PrismaService
    try {
      const updated = await this.prisma.mentorFeedback.update({
        where: { id },
        data: { isPublished: true, publishedAt: new Date() },
      } as any);
      await this.prisma.auditLog.create({
        data: {
          userId: req.user.id,
          action: 'MENTOR_FEEDBACK_PUBLISHED',
          resource: `feedback:${id}`,
          details: { publishedAt: new Date(), publisher: req.user.id },
        },
      } as any);
      return updated;
    } catch (e: any) {
      throw new BadRequestException(e.message);
    }
  }

  @Post('mentor-feedback/:id/unpublish')
  async unpublishMentorFeedback(@Req() req: any, @Param('id') id: string) {
    if (!['ORGANIZER', 'ADMIN'].includes(req.user.role))
      throw new ForbiddenException('Only organizer can withhold feedback');
    const fb = await this.prisma.mentorFeedback.findUnique({
      where: { id },
    } as any);
    if (!fb) throw new NotFoundException('Feedback not found');
    const updated = await this.prisma.mentorFeedback.update({
      where: { id },
      data: { isPublished: false },
    } as any);
    await this.prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'MENTOR_FEEDBACK_WITHHELD',
        resource: `feedback:${id}`,
        details: {},
      },
    } as any);
    return updated;
  }

  @Get('feedback')
  async getPublishedFeedback(
    @Req() req: any,
    @Query('projectId') projectId?: string,
  ) {
    let pid = projectId;
    if (!pid) {
      const membership = await this.prisma.teamMember.findFirst({
        where: { userId: req.user.id },
        include: { team: { include: { project: true } } },
      } as any);
      if (!membership?.team?.project) return { feedbacks: [] };
      pid = membership.team.project.id;
    } else {
      // IDOR check: ensure participant owns project if they request specific projectId
      const proj = await this.prisma.project.findUnique({
        where: { id: pid },
      } as any);
      if (!proj) throw new NotFoundException('Project not found');
      // Explicit team match: with per-hackathon memberships the caller's
      // first membership may belong to another team (false denial).
      const membership = await this.prisma.teamMember.findFirst({
        where: { userId: req.user.id, teamId: proj.teamId },
      } as any);
      if (
        req.user.role === 'PARTICIPANT' &&
        !membership
      ) {
        throw new ForbiddenException(
          'Not authorized to view feedback for this project (IDOR prevented)',
        );
      }
    }
    const feedbacks = await this.prisma.mentorFeedback.findMany({
      where: { projectId: pid, isPublished: true },
      orderBy: { createdAt: 'desc' },
    } as any);
    // Return only published; include author, timestamp, version, audit
    return {
      projectId: pid,
      feedbacks: feedbacks.map((f: any) => ({
        id: f.id,
        projectId: f.projectId,
        author: f.author,
        role: f.role,
        phase: f.phase,
        feedback: f.feedback,
        rating: f.rating,
        version: f.version,
        createdAt: f.createdAt,
        publishedAt: f.publishedAt,
      })),
    };
  }

  @Get('feedback/:id/audit')
  async getFeedbackAudit(@Req() req: any, @Param('id') id: string) {
    const fb = await this.prisma.mentorFeedback.findUnique({
      where: { id },
    } as any);
    if (!fb) throw new NotFoundException('Feedback not found');
    // check visibility: only published feedback visible to participant, audit requires strict check
    const proj = await this.prisma.project.findUnique({
      where: { id: fb.projectId },
    } as any);
    if (!proj) throw new NotFoundException('Project not found');
    // Explicit team match (per-hackathon memberships).
    const membership = await this.prisma.teamMember.findFirst({
      where: { userId: req.user.id, teamId: proj.teamId },
    } as any);
    const isMember = !!membership;
    const isOrganizer = ['ORGANIZER', 'ADMIN', 'MENTOR'].includes(
      req.user.role,
    );
    if (!isMember && !isOrganizer)
      throw new ForbiddenException('Not authorized to view audit');
    // FIX: unpublished feedback audit must NOT be visible to PARTICIPANT even if member (transparency: must be published first)
    if (!fb.isPublished && req.user.role === 'PARTICIPANT')
      throw new ForbiddenException('Feedback not published - audit not visible until organizer publishes');
    // For participant history, only published feedback audit is available; but audit shows author/timestamp/version
    const audits = await this.prisma.auditLog.findMany({
      where: { resource: `feedback:${id}` },
      orderBy: { createdAt: 'desc' },
    } as any);
    return { feedback: fb, audits };
  }

  // ---------- Evaluation (immutable) ----------
  @Post('evaluation')
  async createEvaluation(@Req() req: any, @Body() dto: CreateEvaluationDto) {
    // STRICT: Only MENTOR/ORGANIZER/ADMIN can create evaluations; participant forbidden
    if (!['MENTOR', 'ORGANIZER', 'ADMIN'].includes(req.user.role)) {
      throw new ForbiddenException('Only mentors/organizers can create evaluations (immutable workflow)');
    }
    const project = await this.prisma.project.findUnique({
      where: { id: dto.projectId },
    } as any);
    if (!project) throw new NotFoundException('Project not found');
    const ev = await this.prisma.evaluation.create({
      data: {
        projectId: dto.projectId,
        evaluator: dto.evaluator,
        role: dto.role,
        score: dto.score,
        criteria: dto.criteria,
        comments: dto.comments,
        isPublished: dto.isPublished ?? false,
        version: 1,
      },
    } as any);
    await this.prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'EVALUATION_CREATED',
        resource: `evaluation:${ev.id}`,
        details: { projectId: dto.projectId, version: 1 },
      },
    } as any);
    return ev;
  }

  @Post('evaluation/:id/publish')
  async publishEvaluation(@Req() req: any, @Param('id') id: string) {
    if (!['ORGANIZER', 'ADMIN'].includes(req.user.role))
      throw new ForbiddenException('Only organizer can publish evaluation');
    const ev = await this.prisma.evaluation.findUnique({
      where: { id },
    } as any);
    if (!ev) throw new NotFoundException('Evaluation not found');
    const updated = await this.prisma.evaluation.update({
      where: { id },
      data: { isPublished: true, publishedAt: new Date() },
    } as any);
    await this.prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'EVALUATION_PUBLISHED',
        resource: `evaluation:${id}`,
        details: {},
      },
    } as any);
    return updated;
  }

  @Get('evaluations')
  async getEvaluations(
    @Req() req: any,
    @Query('projectId') projectId?: string,
  ) {
    let pid = projectId;
    if (!pid) {
      const membership = await this.prisma.teamMember.findFirst({
        where: { userId: req.user.id },
        include: { team: { include: { project: true } } },
      } as any);
      if (!membership?.team?.project) return { evaluations: [] };
      pid = membership.team.project.id;
    } else {
      const proj = await this.prisma.project.findUnique({
        where: { id: pid },
      } as any);
      if (!proj) throw new NotFoundException('Project not found');
      // Explicit team match (per-hackathon memberships).
      const membership = await this.prisma.teamMember.findFirst({
        where: { userId: req.user.id, teamId: proj.teamId },
      } as any);
      if (
        req.user.role === 'PARTICIPANT' &&
        !membership
      )
        throw new ForbiddenException('IDOR prevented');
    }
    const evals = await this.prisma.evaluation.findMany({
      where: { projectId: pid, isPublished: true },
    } as any);
    return { projectId: pid, evaluations: evals };
  }

  // ---------- PhaseProgress ----------
  @Post('phase-progress')
  async createPhaseProgress(
    @Req() req: any,
    @Body() dto: CreatePhaseProgressDto,
  ) {
    const project = await this.prisma.project.findUnique({
      where: { id: dto.projectId },
    } as any);
    if (!project) throw new NotFoundException('Project not found');
    // Authorization: own-team members or staff only. An open create would let
    // any participant forge progress/scores for rival projects.
    if (!['MENTOR', 'ORGANIZER', 'ADMIN'].includes(req.user.role)) {
      const membership = await this.prisma.teamMember.findFirst({
        where: { userId: req.user.id, teamId: project.teamId },
      } as any);
      if (!membership)
        throw new ForbiddenException('Only team members can log phase progress (IDOR prevented)');
    }
    // allow mentor/organizer to create; participant read only? but allow for demo
    const pp = await this.prisma.phaseProgress.create({
      data: {
        projectId: dto.projectId,
        phaseName: dto.phaseName,
        status: dto.status,
        score: dto.score,
        isPublished: dto.isPublished ?? false,
      },
    } as any);
    return pp;
  }

  @Get('phase-progress')
  async getPhaseProgress(
    @Req() req: any,
    @Query('projectId') projectId?: string,
  ) {
    let pid = projectId;
    if (!pid) {
      const membership = await this.prisma.teamMember.findFirst({
        where: { userId: req.user.id },
        include: { team: { include: { project: true } } },
      } as any);
      if (!membership?.team?.project) return { phaseProgress: [] };
      pid = membership.team.project.id;
    } else {
      // IDOR check consistent with feedback/evaluations: explicit team match.
      const proj = await this.prisma.project.findUnique({
        where: { id: pid },
      } as any);
      if (!proj) throw new NotFoundException('Project not found');
      const membership = await this.prisma.teamMember.findFirst({
        where: { userId: req.user.id, teamId: proj.teamId },
      } as any);
      if (req.user.role === 'PARTICIPANT' && !membership)
        throw new ForbiddenException('IDOR prevented');
    }
    const pp = await this.prisma.phaseProgress.findMany({
      where: { projectId: pid, isPublished: true },
    } as any);
    return { projectId: pid, phaseProgress: pp };
  }

  // ---------- Mistake ----------
  @Post('mistake')
  async createMistake(@Req() req: any, @Body() dto: CreateMistakeDto) {
    const project = await this.prisma.project.findUnique({
      where: { id: dto.projectId },
    } as any);
    if (!project) throw new NotFoundException('Project not found');
    // Authorization: own-team members or staff only (see phase-progress).
    if (!['MENTOR', 'ORGANIZER', 'ADMIN'].includes(req.user.role)) {
      const membership = await this.prisma.teamMember.findFirst({
        where: { userId: req.user.id, teamId: project.teamId },
      } as any);
      if (!membership)
        throw new ForbiddenException('Only team members can log mistakes (IDOR prevented)');
    }
    const m = await this.prisma.mistake.create({
      data: {
        projectId: dto.projectId,
        title: dto.title,
        description: dto.description,
        category: dto.category,
        severity: dto.severity,
        isPublished: dto.isPublished ?? false,
      },
    } as any);
    return m;
  }

  @Get('mistakes')
  async getMistakes(@Req() req: any, @Query('projectId') projectId?: string) {
    let pid = projectId;
    if (!pid) {
      const membership = await this.prisma.teamMember.findFirst({
        where: { userId: req.user.id },
        include: { team: { include: { project: true } } },
      } as any);
      if (!membership?.team?.project) return { mistakes: [] };
      pid = membership.team.project.id;
    } else {
      const proj = await this.prisma.project.findUnique({
        where: { id: pid },
      } as any);
      if (!proj) throw new NotFoundException('Project not found');
      // Explicit team match (per-hackathon memberships).
      const membership = await this.prisma.teamMember.findFirst({
        where: { userId: req.user.id, teamId: proj.teamId },
      } as any);
      if (
        req.user.role === 'PARTICIPANT' &&
        !membership
      )
        throw new ForbiddenException('IDOR prevented');
    }
    const mistakes = await this.prisma.mistake.findMany({
      where: { projectId: pid, isPublished: true },
    } as any);
    return { projectId: pid, mistakes };
  }

  // ---------- ImprovementArea ----------
  @Post('improvement-area')
  async createImprovementArea(
    @Req() req: any,
    @Body() dto: CreateImprovementAreaDto,
  ) {
    const project = await this.prisma.project.findUnique({
      where: { id: dto.projectId },
    } as any);
    if (!project) throw new NotFoundException('Project not found');
    // Authorization: own-team members or staff only (see phase-progress).
    if (!['MENTOR', 'ORGANIZER', 'ADMIN'].includes(req.user.role)) {
      const membership = await this.prisma.teamMember.findFirst({
        where: { userId: req.user.id, teamId: project.teamId },
      } as any);
      if (!membership)
        throw new ForbiddenException('Only team members can log improvement areas (IDOR prevented)');
    }
    const imp = await this.prisma.improvementArea.create({
      data: {
        projectId: dto.projectId,
        area: dto.area,
        suggestion: dto.suggestion,
        priority: dto.priority ?? 'MEDIUM',
        isPublished: dto.isPublished ?? false,
      },
    } as any);
    return imp;
  }

  @Get('improvement-areas')
  async getImprovementAreas(
    @Req() req: any,
    @Query('projectId') projectId?: string,
  ) {
    let pid = projectId;
    if (!pid) {
      const membership = await this.prisma.teamMember.findFirst({
        where: { userId: req.user.id },
        include: { team: { include: { project: true } } },
      } as any);
      if (!membership?.team?.project) return { improvementAreas: [] };
      pid = membership.team.project.id;
    } else {
      // IDOR check consistent with feedback/evaluations: explicit team match.
      const proj = await this.prisma.project.findUnique({
        where: { id: pid },
      } as any);
      if (!proj) throw new NotFoundException('Project not found');
      const membership = await this.prisma.teamMember.findFirst({
        where: { userId: req.user.id, teamId: proj.teamId },
      } as any);
      if (req.user.role === 'PARTICIPANT' && !membership)
        throw new ForbiddenException('IDOR prevented');
    }
    const areas = await this.prisma.improvementArea.findMany({
      where: { projectId: pid, isPublished: true },
    } as any);
    return { projectId: pid, improvementAreas: areas };
  }

  // ---------- ParticipantInsight / History aggregation ----------
  @Post('insight')
  async createInsight(
    @Req() req: any,
    @Body() dto: CreateParticipantInsightDto,
  ) {
    const project = await this.prisma.project.findUnique({
      where: { id: dto.projectId },
    } as any);
    if (!project) throw new NotFoundException('Project not found');
    // Explicit team match (per-hackathon memberships).
    const membership = await this.prisma.teamMember.findFirst({
      where: { userId: req.user.id, teamId: project.teamId },
    } as any);
    if (!membership)
      throw new ForbiddenException(
        'Only team members can create insights (IDOR prevented)',
      );
    const insight = await this.prisma.participantInsight.create({
      data: {
        projectId: dto.projectId,
        participantId: req.user.id,
        insight: dto.insight,
        lessonsLearned: dto.lessonsLearned,
      },
    } as any);
    return insight;
  }

  @Get('history')
  async getParticipantHistory(@Req() req: any, @Query('projectId') projectId?: string) {
    // Optional project scoping for multi-hackathon participants (additive).
    let resolvedProjectId: string;
    if (projectId) {
      const proj = await this.prisma.project.findUnique({
        where: { id: projectId },
      } as any);
      if (!proj) throw new NotFoundException('Project not found');
      const membership = await this.prisma.teamMember.findFirst({
        where: { userId: req.user.id, teamId: proj.teamId },
      } as any);
      if (req.user.role === 'PARTICIPANT' && !membership)
        throw new ForbiddenException('IDOR prevented');
      resolvedProjectId = projectId;
    } else {
      const membership = await this.prisma.teamMember.findFirst({
        where: { userId: req.user.id },
        include: { team: { include: { project: true } } },
      } as any);
      if (!membership?.team?.project)
        return { history: null, message: 'No project' };
      resolvedProjectId = membership.team.project.id;
    }
    const [
      mistakes,
      feedbacks,
      evaluations,
      phaseProgress,
      improvementAreas,
      elimination,
      insights,
    ] = await Promise.all([
      this.prisma.mistake.findMany({
        where: { projectId: resolvedProjectId, isPublished: true },
      } as any),
      this.prisma.mentorFeedback.findMany({
        where: { projectId: resolvedProjectId, isPublished: true },
      } as any),
      this.prisma.evaluation.findMany({
        where: { projectId: resolvedProjectId, isPublished: true },
      } as any),
      this.prisma.phaseProgress.findMany({
        where: { projectId: resolvedProjectId, isPublished: true },
      } as any),
      this.prisma.improvementArea.findMany({
        where: { projectId: resolvedProjectId, isPublished: true },
      } as any),
      this.prisma.eliminationRecord.findUnique({ where: { projectId: resolvedProjectId } } as any),
      this.prisma.participantInsight.findMany({
        where: { projectId: resolvedProjectId, participantId: req.user.id },
      } as any),
    ]);
    // Compute scores aggregated etc
    const scores = evaluations.map((e: any) => e.score);
    return {
      projectId: resolvedProjectId,
      mistakes,
      mentorFeedbacks: feedbacks,
      scores,
      phasePerformance: phaseProgress,
      improvementAreas,
      eliminationReason: elimination,
      lessonsLearned: insights,
    };
  }

  @Get('history/:projectId')
  async getHistoryByProject(
    @Req() req: any,
    @Param('projectId') projectId: string,
  ) {
    const proj = await this.prisma.project.findUnique({
      where: { id: projectId },
    } as any);
    if (!proj) throw new NotFoundException('Project not found');
    // Explicit team match (per-hackathon memberships).
    const membership = await this.prisma.teamMember.findFirst({
      where: { userId: req.user.id, teamId: proj.teamId },
    } as any);
    if (
      req.user.role === 'PARTICIPANT' &&
      !membership
    )
      throw new ForbiddenException('IDOR prevented');
    const [
      mistakes,
      feedbacks,
      evaluations,
      phaseProgress,
      improvementAreas,
      elimination,
    ] = await Promise.all([
      this.prisma.mistake.findMany({
        where: { projectId, isPublished: true },
      } as any),
      this.prisma.mentorFeedback.findMany({
        where: { projectId, isPublished: true },
      } as any),
      this.prisma.evaluation.findMany({
        where: { projectId, isPublished: true },
      } as any),
      this.prisma.phaseProgress.findMany({
        where: { projectId, isPublished: true },
      } as any),
      this.prisma.improvementArea.findMany({
        where: { projectId, isPublished: true },
      } as any),
      this.prisma.eliminationRecord.findUnique({ where: { projectId } } as any),
    ]);
    return {
      projectId,
      mistakes,
      feedbacks,
      evaluations,
      phaseProgress,
      improvementAreas,
      elimination,
    };
  }

  // ---------- Elimination (legacy) ----------
  @Post('elimination')
  async ingestElimination(@Req() req: any, @Body() dto: IngestEliminationDto) {
    // Elimination ends a team's run: organizer/admin only. An open endpoint
    // would let any participant eliminate rival projects.
    if (!['ORGANIZER', 'ADMIN'].includes(req.user?.role)) {
      throw new ForbiddenException('Only organizers can record eliminations');
    }
    const elim = await this.prisma.eliminationRecord.upsert({
      where: { projectId: dto.projectId },
      update: {
        reason: dto.reason,
        category: dto.category,
        detailedFeedback: dto.detailedFeedback,
      },
      create: {
        projectId: dto.projectId,
        reason: dto.reason,
        category: dto.category,
        detailedFeedback: dto.detailedFeedback,
      },
    } as any);

    await this.neo4j.write(
      `
      MERGE (pr:Project {id: $projectId})
      CREATE (e:EliminationReason {reason: $reason, category: $category})
      CREATE (pr)-[:ELIMINATED_DUE_TO]->(e)
      `,
      { projectId: dto.projectId, reason: dto.reason, category: dto.category },
    );

    return elim;
  }

  @Get('elimination-analysis')
  async getEliminationAnalysis(@Req() req: any, @Query('projectId') projectId?: string) {
    // Optional project scoping for multi-hackathon participants (additive).
    let resolvedProjectId: string;
    if (projectId) {
      const proj = await this.prisma.project.findUnique({
        where: { id: projectId },
      } as any);
      if (!proj) throw new NotFoundException('Project not found');
      const membership = await this.prisma.teamMember.findFirst({
        where: { userId: req.user.id, teamId: proj.teamId },
      } as any);
      if (req.user.role === 'PARTICIPANT' && !membership)
        throw new ForbiddenException('IDOR prevented');
      resolvedProjectId = projectId;
    } else {
      const membership = await this.prisma.teamMember.findFirst({
        where: { userId: req.user.id },
        include: { team: { include: { project: true } } },
      } as any);

      if (!membership?.team?.project) {
        return { status: 'NO_PROJECT' };
      }
      resolvedProjectId = membership.team.project.id;
    }

    const record = await this.prisma.eliminationRecord.findUnique({
      where: { projectId: resolvedProjectId },
    } as any);

    if (!record) {
      return {
        status: 'NOT_ELIMINATED',
        message: 'Team is active in hackathon competition.',
      };
    }

    return {
      status: 'ELIMINATED',
      record,
      aiPostMortem: {
        whatWentWrong: record.reason,
        rootCause:
          'Project lacked explicit health checks and automated test verification before cutoff.',
        correctiveAction:
          'Incorporate continuous automated static scanning and pre-commit verification scripts.',
        keyTakeaway:
          'Always verify API contracts and deployment status early in the competition.',
      },
    };
  }
}
