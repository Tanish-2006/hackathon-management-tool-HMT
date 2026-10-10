import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PrismaService } from '../database/prisma.service';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  deriveLifecycleStatus,
  bucketForMyHackathons,
} from '@hmt/common';

// Sub-resource endpoints must not leak DRAFT/REVIEW/CONFIRMED records when an
// ID is guessed — same visibility rule as the detail endpoint itself.
// Exported for regression tests (published-only discovery contract).
export function assertPublishedForParticipants(h: any): void {
  const st = h.status ?? (h.isPublished ? 'PUBLISHED' : 'DRAFT');
  if (!['PUBLISHED', 'ARCHIVED'].includes(st)) {
    throw new NotFoundException('Hackathon not found');
  }
}

export function isRegistrationClosed(h: any, now = Date.now()): boolean {
  const end = h?.registrationEnd ? new Date(h.registrationEnd).getTime() : NaN;
  return !Number.isNaN(end) && now > end;
}

function toDiscoverRow(h: any) {
  const derived = deriveLifecycleStatus({
    status: h.status ?? (h.isPublished ? 'PUBLISHED' : 'DRAFT'),
    registrationStart: h.registrationStart ?? null,
    registrationEnd: h.registrationEnd ?? null,
    eventStart: h.eventStart ?? h.startDate ?? null,
    eventEnd: h.eventEnd ?? h.endDate ?? null,
    phases: h.phases ?? [],
  });
  return {
    id: h.id,
    slug: h.slug ?? h.id,
    title: h.title,
    organizer: h.organizer ?? h.organizerName ?? null,
    status: h.status ?? 'PUBLISHED',
    derivedStatus: derived,
    mode: h.mode ?? 'ONLINE',
    hackathonType: h.hackathonType ?? 'OPEN_INNOVATION',
    category: h.category ?? h.theme ?? null,
    tags: h.tags ?? [],
    eligibility: h.eligibility ?? [],
    teamSize: h.teamSize ?? null,
    registrationStart: h.registrationStart ?? null,
    registrationEnd: h.registrationEnd ?? null,
    eventStart: h.eventStart ?? h.startDate ?? null,
    eventEnd: h.eventEnd ?? h.endDate ?? null,
    description: typeof h.description === 'string' ? h.description.slice(0, 220) : '',
  };
}

function matchesSearch(h: any, search: string) {
  const q = search.toLowerCase();
  return (
    String(h.title ?? '').toLowerCase().includes(q) ||
    String(h.organizer ?? h.organizerName ?? '').toLowerCase().includes(q) ||
    String(h.description ?? '').toLowerCase().includes(q) ||
    String(h.category ?? h.theme ?? '').toLowerCase().includes(q) ||
    (Array.isArray(h.tags) && h.tags.some((t: string) => String(t).toLowerCase().includes(q))) ||
    (Array.isArray(h.eligibility) && h.eligibility.some((t: string) => String(t).toLowerCase().includes(q)))
  );
}

@ApiTags('hackathons')
@ApiBearerAuth()
@Controller('hackathons')
@UseGuards(JwtAuthGuard)
export class HackathonController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Discover — dedicated list (Unstop/Hack2Skill pattern: compact rows + backend search/filters).
   * GET /hackathons?search=&status=&mode=&category=&eligibility=&registration=&page=&pageSize=
   * Only published lifecycle states are visible; drafts never leak.
   */
  @Get()
  async listHackathons(
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('mode') mode?: string,
    @Query('category') category?: string,
    @Query('eligibility') eligibility?: string,
    @Query('registration') registration?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const p = Math.max(1, parseInt(page || '1', 10) || 1);
    const ps = Math.min(50, Math.max(1, parseInt(pageSize || '20', 10) || 20));
    let all = await this.prisma.hackathon.findMany({
      orderBy: { createdAt: 'desc' },
    } as any);
    // Only public lifecycle states (never DRAFT/REVIEW/CONFIRMED).
    // Default discovery is PUBLISHED-only; ARCHIVED is history, reachable
    // explicitly via ?status=ARCHIVED (detail/history still resolve below).
    const onlyPublished = !status || status === 'PUBLISHED';
    all = all.filter((h: any) => {
      const st = h.status ?? (h.isPublished ? 'PUBLISHED' : 'DRAFT');
      if (onlyPublished) return st === 'PUBLISHED';
      return ['PUBLISHED', 'ARCHIVED'].includes(st);
    });
    if (search?.trim()) all = all.filter((h: any) => matchesSearch(h, search.trim()));
    if (mode) all = all.filter((h: any) => (h.mode ?? 'ONLINE') === mode);
    if (category)
      all = all.filter((h: any) =>
        String(h.category ?? h.theme ?? '').toLowerCase().includes(category.toLowerCase()),
      );
    if (eligibility)
      all = all.filter((h: any) =>
        (h.eligibility ?? []).some((e: string) =>
          String(e).toLowerCase().includes(eligibility.toLowerCase()),
        ),
      );
    // Enrich with derived status for status + registration filters.
    let rows = all.map(toDiscoverRow);
    if (status) rows = rows.filter((r) => r.derivedStatus === status || r.status === status);
    if (registration === 'open') rows = rows.filter((r) => r.derivedStatus === 'REGISTRATION_OPEN');
    if (registration === 'closed')
      rows = rows.filter((r) =>
        ['REGISTRATION_CLOSED', 'LIVE', 'SUBMISSION', 'EVALUATION', 'COMPLETED'].includes(r.derivedStatus),
      );
    const total = rows.length;
    const data = rows.slice((p - 1) * ps, p * ps);
    return { data, pagination: { page: p, pageSize: ps, total, totalPages: Math.ceil(total / ps) } };
  }

  @Get('current')
  async getCurrentHackathon() {
    // The "current" hackathon is an active PUBLISHED one — never ARCHIVED.
    const stored = await this.prisma.hackathon.findFirst({
      where: { isPublished: true },
      orderBy: { createdAt: 'desc' },
      include: { announcements: true },
    } as any);

    if (!stored || (stored.status ?? 'PUBLISHED') === 'ARCHIVED') {
      // Honest empty — never auto-seed hardcoded mocks (real API is authoritative).
      return null;
    }

    const hackathon = { ...stored };
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
    const derived = deriveLifecycleStatus({
      status: hackathon.status ?? 'PUBLISHED',
      registrationStart: hackathon.registrationStart,
      registrationEnd: hackathon.registrationEnd,
      eventStart: hackathon.eventStart ?? hackathon.startDate,
      eventEnd: hackathon.eventEnd ?? hackathon.endDate,
      phases: hackathon.phases,
    });
    // Only return participant-visible fields; isPublished internal should not leak organizer drafts
    return {
      id: hackathon.id,
      slug: hackathon.slug ?? hackathon.id,
      title: hackathon.title,
      description: hackathon.description,
      mode: hackathon.mode ?? 'ONLINE',
      status: hackathon.status ?? 'PUBLISHED',
      derivedStatus: derived,
      problemStatement: hackathon.problemStatement,
      rules: hackathon.rules,
      resources: hackathon.resources,
      judgingCriteria: hackathon.judgingCriteria,
      phases: hackathon.phases,
      startDate: hackathon.startDate ?? hackathon.eventStart,
      endDate: hackathon.endDate ?? hackathon.eventEnd,
      registrationStart: hackathon.registrationStart ?? null,
      registrationEnd: hackathon.registrationEnd ?? null,
      eventStart: hackathon.eventStart ?? hackathon.startDate ?? null,
      eventEnd: hackathon.eventEnd ?? hackathon.endDate ?? null,
      eligibility: hackathon.eligibility ?? [],
      teamSize: hackathon.teamSize ?? null,
      announcements: hackathon.announcements,
    };
  }

  /** My Hackathons — Registered / Upcoming / Live / Completed buckets. */
  @Get('my')
  async myHackathons(@Req() req: any, @Query('bucket') bucket?: string) {
    const regs = await (this.prisma as any).registration.findMany({
      where: { userId: req.user.id },
    });
    const ids = regs.map((r: any) => r.hackathonId);
    let hacks: any[] = [];
    for (const id of ids) {
      const h = await this.prisma.hackathon.findUnique({ where: { id } } as any);
      if (h) hacks.push(h);
    }
    let rows = hacks.map((h: any) => {
      const reg = regs.find((r: any) => r.hackathonId === h.id);
      const input = {
        status: h.status ?? 'PUBLISHED',
        registrationStart: h.registrationStart,
        registrationEnd: h.registrationEnd,
        eventStart: h.eventStart ?? h.startDate,
        eventEnd: h.eventEnd ?? h.endDate,
        phases: h.phases,
      };
      return {
        ...toDiscoverRow(h),
        derivedStatus: deriveLifecycleStatus(input),
        bucket: bucketForMyHackathons(input),
        registrationStatus: reg?.status ?? 'REGISTERED',
        registeredAt: reg?.createdAt ?? null,
        teamId: reg?.teamId ?? null,
      };
    });
    if (bucket && ['upcoming', 'live', 'completed', 'registered'].includes(bucket)) {
      rows = rows.filter((r) => r.bucket === bucket);
    }
    return { data: rows };
  }

  @Get('registrations/me')
  async myRegistrations(@Req() req: any) {
    return (this.prisma as any).registration.findMany({ where: { userId: req.user.id } });
  }

  /**
   * Registration — connected to skill profile (no repeated data entry).
   * POST /hackathons/:id/register { teamChoice, teamId? }
   */
  @Post(':id/register')
  async register(@Req() req: any, @Param('id') id: string, @Body() body: { teamChoice?: string; teamId?: string; eligibilityAccepted?: boolean }) {
    const h = await this.prisma.hackathon.findUnique({ where: { id } } as any);
    if (!h) throw new NotFoundException('Hackathon not found');

    // Phase 1 phone identity gate: one verified phone = one participant identity.
    // Backend-enforced (frontend guards are UX-only).
    const me: any = await this.prisma.user.findUnique({ where: { id: req.user.id } } as any).catch(() => null);
    if (!me?.isPhoneVerified) {
      throw new ForbiddenException('PHONE_VERIFICATION_REQUIRED');
    }
    const st = h.status ?? (h.isPublished ? 'PUBLISHED' : 'DRAFT');
    if (!['PUBLISHED', 'ARCHIVED'].includes(st)) throw new NotFoundException('Hackathon not published');

    const existing = await (this.prisma as any).registration.findFirst({
      where: { userId: req.user.id, hackathonId: id },
    });
    if (existing) return existing;

    // Registration window enforcement (backend, not frontend-only).
    const derived = deriveLifecycleStatus({
      status: st,
      registrationStart: h.registrationStart,
      registrationEnd: h.registrationEnd,
      eventStart: h.eventStart ?? h.startDate,
      eventEnd: h.eventEnd ?? h.endDate,
      phases: h.phases,
    });
    if (derived === 'COMPLETED' || derived === 'ARCHIVED') {
      throw new BadRequestException('Registration closed — hackathon has ended');
    }
    if (isRegistrationClosed(h)) {
      throw new BadRequestException('Registration is closed for this hackathon');
    }

    // Skill-profile gate: reuse existing profile, never re-ask.
    const skill = await (this.prisma as any).skillProfile?.findUnique?.({ where: { userId: req.user.id } }).catch(() => null);
    const langs = skill?.programmingLanguages ?? [];
    const frameworks = skill?.frameworks ?? [];
    const hasSkills = (langs.length + frameworks.length) > 0 || !!skill?.experienceLevel;
    if (!skill || !hasSkills) {
      throw new BadRequestException(
        'Complete your skill profile before registering — we reuse it for eligibility and team matching',
      );
    }

    const teamChoice = body?.teamChoice ?? 'later';
    if (!['create', 'join', 'later'].includes(teamChoice)) {
      throw new BadRequestException('Invalid teamChoice (create|join|later)');
    }

    // Eligibility confirmation when the organizer configured requirements.
    if (Array.isArray(h.eligibility) && h.eligibility.length > 0 && body?.eligibilityAccepted !== true) {
      throw new BadRequestException('Please confirm the eligibility requirements to register');
    }

    // Client-supplied teamId is never trusted: it must exist, belong to this
    // hackathon, and include the caller as a member.
    let teamId: string | null = null;
    if (body?.teamId) {
      const team: any = await this.prisma.team.findUnique({ where: { id: body.teamId } } as any).catch(() => null);
      const memberOf = team
        ? await this.prisma.teamMember.findFirst({
            where: { teamId: team.id, userId: req.user.id },
          } as any).catch(() => null)
        : null;
      if (!team || team.hackathonId !== id || !memberOf) {
        throw new BadRequestException('Invalid team choice for this hackathon');
      }
      teamId = team.id;
    }

    return (this.prisma as any).registration.create({
      data: {
        hackathonId: id,
        userId: req.user.id,
        status: 'REGISTERED',
        teamChoice,
        teamId,
        eligibilityAccepted: body?.eligibilityAccepted === true,
        skillSnapshot: {
          programmingLanguages: skill.programmingLanguages ?? [],
          frameworks: skill.frameworks ?? [],
          experienceLevel: skill.experienceLevel ?? null,
        },
      },
    }).catch(async (e: any) => {
      if (e?.code !== 'P2002') throw e;
      return (this.prisma as any).registration.findFirst({ where: { userId: req.user.id, hackathonId: id } });
    });
  }

  @Get(':id')
  async getHackathonById(@Param('id') id: string) {
    let h: any = await this.prisma.hackathon.findUnique({
      where: { id },
      include: { announcements: true },
    } as any);
    if (!h) {
      // slug alias (same canonical ID across organizer/participant)
      h = await this.prisma.hackathon.findUnique({
        where: { slug: id },
        include: { announcements: true },
      } as any);
    }
    if (!h) throw new NotFoundException('Hackathon not found');
    const st = h.status ?? (h.isPublished ? 'PUBLISHED' : 'DRAFT');
    if (!['PUBLISHED', 'ARCHIVED'].includes(st)) throw new NotFoundException('Hackathon not published');
    const filteredAnns = (h.announcements || []).filter(
      (a: any) =>
        a.isPublished &&
        !['ORGANIZER_ONLY', 'MENTOR_ONLY'].includes(a.visibility),
    );
    const derived = deriveLifecycleStatus({
      status: st,
      registrationStart: h.registrationStart,
      registrationEnd: h.registrationEnd,
      eventStart: h.eventStart ?? h.startDate,
      eventEnd: h.eventEnd ?? h.endDate,
      phases: h.phases,
    });
    return { ...h, announcements: filteredAnns, derivedStatus: derived };
  }

  @Get(':id/problem-statement')
  async getProblemStatement(@Param('id') id: string) {
    const h = await this.prisma.hackathon.findUnique({ where: { id } } as any);
    if (!h || !(h.isPublished ?? h.status === 'PUBLISHED'))
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
    if (!h || !(h.isPublished ?? h.status === 'PUBLISHED'))
      throw new NotFoundException('Hackathon not found');
    return { resources: h.resources || [] };
  }

  @Get(':id/announcements')
  async getAnnouncements(@Param('id') id: string) {
    const h = await this.prisma.hackathon.findUnique({ where: { id } } as any);
    if (!h || !(h.isPublished ?? h.status === 'PUBLISHED'))
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
    assertPublishedForParticipants(h);
    return { phases: h.phases || [] };
  }

  @Get(':id/judging-criteria')
  async getJudgingCriteria(@Param('id') id: string) {
    const h = await this.prisma.hackathon.findUnique({ where: { id } } as any);
    if (!h) throw new NotFoundException('Hackathon not found');
    assertPublishedForParticipants(h);
    return { judgingCriteria: h.judgingCriteria || [] };
  }
}
