import { memoryStore } from '../../store/memory.store';
import type { Hackathon, OrganizerOverview } from '../../domain/types';

// Organizer Home command center aggregation. Read-only over existing records.
// Ownership: callers pass the authenticated userId + role; ORGANIZER sees only
// hackathons with organizerId === userId, ADMIN sees all (same rule as GET /hackathons).

function toTime(value: unknown): number | null {
  if (!value) return null;
  const t = new Date(value as string).getTime();
  return Number.isNaN(t) ? null : t;
}

function isSubmitted(p: any): boolean {
  return p?.status === 'SUBMITTED' || Boolean(p?.demoUrl || p?.repoUrl);
}

function teamMemberCount(team: any): number {
  let count = 0;
  for (const m of memoryStore.teamMembers.values()) {
    if (m.teamId === team.id) count += 1;
  }
  if (count === 0 && Array.isArray(team.memberIds)) count = team.memberIds.length;
  return count;
}

export class OverviewService {
  async getOverview(userId: string, role: string): Promise<OrganizerOverview> {
    const all = Array.from(memoryStore.hackathons.values());
    const owned =
      role === 'ADMIN' ? all : all.filter((h) => h.organizerId === userId);
    const ownedIds = new Set(owned.map((h) => h.id));

    const participants = Array.from(memoryStore.participants.values()).filter((p) =>
      ownedIds.has(p.hackathonId),
    );
    const teams = Array.from(memoryStore.teams.values()).filter((t) => ownedIds.has(t.hackathonId));
    const projects = Array.from(memoryStore.projects.values()).filter((p) =>
      ownedIds.has(p.hackathonId),
    );
    const feedbacks = Array.from(memoryStore.mentorFeedbacks.values()).filter((f) =>
      ownedIds.has(f.hackathonId),
    );
    const assignments = Array.from(memoryStore.mentorAssignments.values()).filter((a) =>
      ownedIds.has(a.hackathonId),
    );

    const submittedProjects = projects.filter(isSubmitted);
    const pendingEvaluations = feedbacks.filter((f) => f.publicationStatus === 'MENTOR_SUBMITTED').length;
    const activeOwned = owned.filter((h) => h.status !== 'ARCHIVED');

    const summary = {
      totalHackathons: owned.length,
      activeHackathons: activeOwned.length,
      totalParticipants: participants.length,
      totalTeams: teams.length,
      projectsSubmitted: submittedProjects.length,
      pendingEvaluations,
    };

    const active = this.pickActive(activeOwned);

    let activeHackathon: OrganizerOverview['activeHackathon'] = null;
    let registration: OrganizerOverview['registration'] = null;
    let teamStats: OrganizerOverview['teams'] = null;
    let submissions: OrganizerOverview['submissions'] = null;
    // Evaluation + feedback mirror the Home scope: active hackathon when one exists.
    let evalScope = feedbacks;
    let assignScope = assignments;

    if (active) {
      const hp = participants.filter((p) => p.hackathonId === active.id);
      const ht = teams.filter((t) => t.hackathonId === active.id);
      const hpr = projects.filter((p) => p.hackathonId === active.id);
      const hfb = feedbacks.filter((f) => f.hackathonId === active.id);
      const hasg = assignments.filter((a) => a.hackathonId === active.id);
      const phases = Array.from(memoryStore.phases.values())
        .filter((p) => p.hackathonId === active.id)
        .sort((a, b) => a.order - b.order);

      const currentPhase = this.currentPhaseName(phases);
      const phaseEnd = (name: string): string | null => {
        const ph = phases.find((p) => p.name === name);
        return ph?.endsAt ?? null;
      };
      const mentorCount = new Set(hasg.map((a) => a.mentorId)).size;
      const submitted = hpr.filter(isSubmitted).length;

      activeHackathon = {
        id: active.id,
        title: active.title,
        description: active.description,
        status: active.status,
        currentPhase,
        phases: phases.map((p) => ({ name: p.name, status: p.status })),
        participantCount: hp.length,
        teamCount: ht.length,
        projectCount: hpr.length,
        mentorCount,
        registrationDeadline: active.registrationEnd ?? null,
        teamFormationDeadline: phaseEnd('team_formation'),
        submissionDeadline: phaseEnd('submission'),
        evaluationDeadline: phaseEnd('evaluation'),
      };

      const now = Date.now();
      const dayStart = new Date();
      dayStart.setUTCHours(0, 0, 0, 0);
      const weekStart = dayStart.getTime() - 6 * 86400000;
      let today = 0;
      let thisWeek = 0;
      for (const p of hp) {
        const t = toTime(p.joinedAt ?? p.createdAt);
        if (t === null) continue;
        if (t >= dayStart.getTime() && t <= now) today += 1;
        if (t >= weekStart && t <= now) thisWeek += 1;
      }
      // No participant-capacity field exists on Hackathon — never invent one.
      registration = {
        total: hp.length,
        today,
        thisWeek,
        capacity: null,
        remainingCapacity: null,
        deadline: active.registrationEnd ?? null,
        progress: null,
      };

      const minSize = active.teamSize?.min ?? null;
      let complete: number | null = null;
      let incomplete: number | null = null;
      if (minSize !== null) {
        complete = 0;
        for (const t of ht) {
          if (teamMemberCount(t) >= (minSize as number)) complete += 1;
        }
        incomplete = ht.length - (complete as number);
      }
      const withoutTeam = hp.filter((p) => !p.teamId).length;
      const submittedTeamIds = new Set(hpr.filter(isSubmitted).map((p) => p.teamId));
      const withoutSubmission = ht.filter((t) => !submittedTeamIds.has(t.id)).length;
      teamStats = {
        total: ht.length,
        complete,
        incomplete,
        participantsWithoutTeam: withoutTeam,
        teamsWithoutSubmission: withoutSubmission,
      };

      submissions = {
        submitted,
        notSubmitted: Math.max(ht.length - submitted, 0),
        deadline: phaseEnd('submission'),
        rate: ht.length === 0 ? 0 : Number((submitted / ht.length).toFixed(2)),
      };

      evalScope = hfb;
      assignScope = hasg;
    }

    const evaluation = {
      total: evalScope.length,
      published: evalScope.filter((f) => f.publicationStatus === 'PUBLISHED').length,
      pendingReview: evalScope.filter((f) => f.publicationStatus === 'MENTOR_SUBMITTED').length,
    };
    const completedFb = evalScope.filter((f) => f.score !== null && f.remarks).length;
    const feedback = {
      completed: completedFb,
      totalAssignments: assignScope.length,
      rate:
        assignScope.length === 0
          ? 0
          : Number(Math.min(evalScope.length / assignScope.length, 1).toFixed(2)),
    };

    const attention = this.buildAttention(owned, active);
    const deadlines = this.buildDeadlines(active);
    const recentActivity = this.buildActivity(active);
    const trend = this.buildTrend(teams, projects);

    return {
      summary,
      activeHackathon,
      registration,
      teams: teamStats,
      submissions,
      evaluation,
      feedback,
      attention,
      deadlines,
      recentActivity,
      trend,
      hackathons: owned.map((h) => ({
        id: h.id,
        title: h.title,
        description: h.description,
        status: h.status,
        hackathonType: h.hackathonType,
        themeCount: Array.isArray(h.themeIds) ? h.themeIds.length : 0,
      })),
      generatedAt: new Date().toISOString(),
    };
  }

  // Most relevant active hackathon: PUBLISHED first, then CONFIRMED/REVIEW/DRAFT;
  // newest published/created wins. ARCHIVED never qualifies (filtered by caller).
  private pickActive(hackathons: Hackathon[]): Hackathon | null {
    if (hackathons.length === 0) return null;
    const rank: Record<string, number> = { PUBLISHED: 0, CONFIRMED: 1, REVIEW: 2, DRAFT: 3 };
    const stamp = (h: Hackathon) => toTime(h.publishedAt ?? h.createdAt) ?? 0;
    return [...hackathons].sort((a, b) => {
      const r = (rank[a.status] ?? 9) - (rank[b.status] ?? 9);
      if (r !== 0) return r;
      return stamp(b) - stamp(a);
    })[0];
  }

  private currentPhaseName(phases: Array<{ name: string; status: string; order: number }>): string | null {
    if (phases.length === 0) return null;
    const sorted = [...phases].sort((a, b) => a.order - b.order);
    return (
      sorted.find((p) => p.status === 'ACTIVE')?.name ??
      sorted.find((p) => p.status === 'UPCOMING')?.name ??
      sorted[sorted.length - 1]?.name ??
      null
    );
  }

  private buildAttention(
    owned: Hackathon[],
    active: Hackathon | null,
  ): OrganizerOverview['attention'] {
    const items: OrganizerOverview['attention'] = [];
    const now = Date.now();
    const soon = (iso: string | null | undefined): boolean => {
      const t = toTime(iso);
      return t !== null && t >= now && t - now <= 7 * 86400000;
    };

    const unpublished = owned.filter((h) => h.status !== 'PUBLISHED' && h.status !== 'ARCHIVED');
    if (unpublished.length > 0) {
      items.push({
        kind: 'unpublished',
        message: `${unpublished.length} unpublished hackathon${unpublished.length === 1 ? '' : 's'} need${unpublished.length === 1 ? 's' : ''} review or publishing`,
        count: unpublished.length,
        href: '/organizer/hackathons',
      });
    }

    if (active) {
      const hp = Array.from(memoryStore.participants.values()).filter((p) => p.hackathonId === active.id);
      const ht = Array.from(memoryStore.teams.values()).filter((t) => t.hackathonId === active.id);
      const hpr = Array.from(memoryStore.projects.values()).filter((p) => p.hackathonId === active.id);
      const hfb = Array.from(memoryStore.mentorFeedbacks.values()).filter((f) => f.hackathonId === active.id);

      const withoutTeam = hp.filter((p) => !p.teamId).length;
      if (withoutTeam > 0) {
        items.push({
          kind: 'no-team',
          message: `${withoutTeam} participant${withoutTeam === 1 ? '' : 's'} ${withoutTeam === 1 ? 'is' : 'are'} not in a team`,
          count: withoutTeam,
          href: '/organizer/participants',
        });
      }

      const submittedTeamIds = new Set(hpr.filter(isSubmitted).map((p) => p.teamId));
      const withoutSubmission = ht.filter((t) => !submittedTeamIds.has(t.id)).length;
      if (withoutSubmission > 0 && ht.length > 0) {
        items.push({
          kind: 'no-submission',
          message: `${withoutSubmission} team${withoutSubmission === 1 ? '' : 's'} ${withoutSubmission === 1 ? 'has' : 'have'} not submitted`,
          count: withoutSubmission,
          href: '/organizer/teams',
        });
      }

      const pending = hfb.filter((f) => f.publicationStatus === 'MENTOR_SUBMITTED').length;
      if (pending > 0) {
        items.push({
          kind: 'pending-evaluations',
          message: `${pending} evaluation${pending === 1 ? '' : 's'} pending review`,
          count: pending,
          href: '/organizer/evaluations',
        });
      }

      if (soon(active.registrationEnd)) {
        items.push({
          kind: 'registration-closing',
          message: 'Registration closes within 7 days',
          count: 1,
          href: '/organizer/participants',
        });
      }
      const phases = Array.from(memoryStore.phases.values()).filter((p) => p.hackathonId === active.id);
      const sub = phases.find((p) => p.name === 'submission');
      if (soon(sub?.endsAt)) {
        items.push({
          kind: 'submission-closing',
          message: 'Submission deadline within 7 days',
          count: 1,
          href: `/organizer/hackathons/${active.id}`,
        });
      }
    }
    return items;
  }

  private buildDeadlines(active: Hackathon | null): OrganizerOverview['deadlines'] {
    if (!active) return [];
    const now = Date.now();
    const out: OrganizerOverview['deadlines'] = [];
    const push = (label: string, iso: string | null | undefined, href: string) => {
      const t = toTime(iso);
      if (t === null || t < now) return;
      out.push({
        label,
        date: new Date(t).toISOString(),
        daysRemaining: Math.ceil((t - now) / 86400000),
        href,
      });
    };
    push('Registration closes', active.registrationEnd, '/organizer/participants');
    const phases = Array.from(memoryStore.phases.values()).filter((p) => p.hackathonId === active.id);
    const endOf = (name: string) => phases.find((p) => p.name === name)?.endsAt;
    push('Team formation closes', endOf('team_formation'), '/organizer/teams');
    push('Submission deadline', endOf('submission'), `/organizer/hackathons/${active.id}`);
    push('Evaluation deadline', endOf('evaluation'), '/organizer/evaluations');
    const results = phases.find((p) => p.name === 'results' || p.name === 'finale')?.endsAt;
    push('Results publication', results, `/organizer/hackathons/${active.id}`);
    return out.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }

  // Derived from existing records only — no activity table is introduced.
  private buildActivity(active: Hackathon | null): OrganizerOverview['recentActivity'] {    if (!active) return [];
    const events: Array<{ kind: string; message: string; at: string; href: string; t: number }> = [];
    const push = (kind: string, message: string, at: unknown, href: string) => {
      const t = toTime(at);
      if (t === null) return;
      events.push({ kind, message, at: new Date(t).toISOString(), href, t });
    };
    for (const p of memoryStore.participants.values()) {
      if (p.hackathonId !== active.id) continue;
      push('registered', `${p.displayName ?? 'A participant'} registered`, p.joinedAt ?? p.createdAt, '/organizer/participants');
    }
    for (const t of memoryStore.teams.values()) {
      if (t.hackathonId !== active.id) continue;
      push('team-created', `Team ${t.name ?? ''} created`.trim(), t.createdAt, '/organizer/teams');
    }
    for (const p of memoryStore.projects.values()) {
      if (p.hackathonId !== active.id || !isSubmitted(p)) continue;
      push('project-submitted', `${p.title ?? 'A project'} submitted`, p.createdAt, '/organizer/teams');
    }
    for (const f of memoryStore.mentorFeedbacks.values()) {
      if (f.hackathonId !== active.id) continue;
      push('feedback-submitted', 'Mentor feedback submitted', f.createdAt, '/organizer/evaluations');
    }
    return events
      .sort((a, b) => b.t - a.t)
      .slice(0, 10)
      .map(({ kind, message, at, href }) => ({ kind, message, at, href }));
  }

  // Teams created + projects submitted per day over the last 7 days (owned scope).
  private buildTrend(teams: any[], projects: any[]): OrganizerOverview['trend'] {
    const days: OrganizerOverview['trend'] = [];
    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);
    const startMs = start.getTime() - 6 * 86400000;
    for (let i = 0; i < 7; i += 1) {
      const dayStart = startMs + i * 86400000;
      const dayEnd = dayStart + 86400000;
      const inDay = (at: unknown) => {
        const t = toTime(at);
        return t !== null && t >= dayStart && t < dayEnd;
      };
      days.push({
        day: new Date(dayStart).toISOString(),
        teams: teams.filter((t) => inDay(t.createdAt)).length,
        subs: projects.filter((p) => inDay(p.createdAt) && isSubmitted(p)).length,
      });
    }
    return days;
  }
}

export const overviewService = new OverviewService();
