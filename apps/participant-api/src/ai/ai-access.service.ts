import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { deriveLifecycleStatus, isLiveForAI } from '@hmt/common';

export interface AiAccessResult {
  allowed: boolean;
  code: 'OK' | 'HACKATHON_NOT_LIVE' | 'NO_MEMBERSHIP' | 'NO_HACKATHON' | 'NO_GRANT';
  derivedStatus: string | null;
  hackathonId: string | null;
  eventStart: string | Date | null;
  eventEnd: string | Date | null;
  hadRepositoryAccess: boolean;
  message: string;
}

/**
 * Backend enforcement for AI Teammate availability.
 * Available ONLY during the active hackathon window (LIVE/SUBMISSION/EVALUATION),
 * for members of an authorized team with an active repository grant (for deep analysis).
 * Frontend hiding is never sufficient — every AI entrypoint calls requireLiveAccess().
 */
@Injectable()
export class AiAccessService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Hackathon-scoped membership lookup. A participant may belong to different
   * teams in different hackathons, so global `findFirst({ userId })` must not
   * be used to gate AI access. Iterates the caller's memberships and matches
   * via team records (works on both the in-memory store and Postgres, where
   * nested relational filters differ). Returns null when the caller holds no
   * team in the requested hackathon.
   */
  private async findMembershipInHackathon(userId: string, hackathonId: string): Promise<any | null> {
    const memberships = (await this.prisma.teamMember.findMany({
      where: { userId },
    } as any).catch(() => [])) as any[];
    for (const m of memberships || []) {
      const team = await this.prisma.team.findUnique({
        where: { id: m.teamId },
      } as any).catch(() => null);
      if (team && String((team as any).hackathonId) === String(hackathonId)) {
        return { ...m, team };
      }
    }
    return null;
  }

  private denied(code: AiAccessResult['code'], message: string): AiAccessResult {
    return {
      allowed: false,
      code,
      derivedStatus: null,
      hackathonId: null,
      eventStart: null,
      eventEnd: null,
      hadRepositoryAccess: false,
      message,
    };
  }

  async checkAccess(userId: string, projectId?: string, hackathonId?: string, now = new Date()): Promise<AiAccessResult> {
    // Resolve the authoritative membership. With an explicit hackathon scope,
    // only a team in THAT hackathon authorizes — never a team from another
    // hackathon. With a project scope and no hackathon scope, the project's
    // own team selects the membership (fixes arbitrary-first-team bugs).
    // Without any scope, legacy first-membership behavior is preserved.
    let membership: any = null;
    let project: any = null;
    if (projectId) {
      project = await this.prisma.project.findUnique({ where: { id: projectId } } as any).catch(() => null);
      if (!project) {
        return this.denied('NO_MEMBERSHIP', 'Not member of project team');
      }
    }
    const projectHackathonId: string | null = project?.hackathonId
      ? String(project.hackathonId)
      : null;
    // The effective hackathon scope: explicit param wins; otherwise the
    // project's hackathon; otherwise null (legacy).
    const scopeHackathonId: string | null = hackathonId
      ? String(hackathonId)
      : projectHackathonId;
    if (scopeHackathonId) {
      // Fail closed when the client-supplied project and hackathon disagree.
      if (projectHackathonId && hackathonId && projectHackathonId !== String(hackathonId)) {
        return this.denied('NO_MEMBERSHIP', 'Project does not belong to this hackathon');
      }
      membership = await this.findMembershipInHackathon(userId, scopeHackathonId);
      if (!membership?.team) {
        return this.denied(
          'NO_MEMBERSHIP',
          'Not registered in a team for this hackathon — register and join a team to use AI Teammate',
        );
      }
      // The scoped team must own the project (IDOR prevention per hackathon).
      if (project && membership.teamId !== project.teamId) {
        return this.denied('NO_MEMBERSHIP', 'Not member of project team');
      }
      // Backfill the team relation for downstream context building.
      if (!membership.team?.hackathon) {
        const team = await this.prisma.team.findUnique({
          where: { id: membership.teamId },
        } as any).catch(() => null);
        if (team) membership = { ...membership, team };
      }
    } else {
      membership = await this.prisma.teamMember.findFirst({
        where: { userId },
        include: { team: { include: { hackathon: true, project: true } } },
      } as any);
      if (!membership?.team) {
        return {
          allowed: false,
          code: 'NO_MEMBERSHIP',
          derivedStatus: null,
          hackathonId: null,
          eventStart: null,
          eventEnd: null,
          hadRepositoryAccess: false,
          message: 'Join a team in a hackathon to use AI Teammate',
        };
      }
      if (projectId) {
        if (!project || project.teamId !== membership.teamId) {
          return {
            allowed: false,
            code: 'NO_MEMBERSHIP',
            derivedStatus: null,
            hackathonId: null,
            eventStart: null,
            eventEnd: null,
            hadRepositoryAccess: false,
            message: 'Not member of project team',
          };
        }
      }
    }
    let hackathon: any = membership.team?.hackathon ?? null;
    // Scoped path: the team record carries hackathonId but not the nested
    // hackathon object — load it so lifecycle checks use the RIGHT hackathon.
    if (!hackathon && scopeHackathonId) {
      hackathon = await (this.prisma as any).hackathon?.findUnique?.({ where: { id: scopeHackathonId } }).catch(() => null);
    }
    if (!hackathon && membership.team?.hackathonId) {
      hackathon = await (this.prisma as any).hackathon?.findUnique?.({ where: { id: membership.team.hackathonId } }).catch(() => null);
    }
    // Prefer the project hackathon when present (same canonical ID).
    if (project?.hackathonId) {
      const ph = await (this.prisma as any).hackathon?.findUnique?.({ where: { id: project.hackathonId } }).catch(() => null);
      if (ph) hackathon = ph;
    }
    if (!hackathon) {
      return {
        allowed: false,
        code: 'NO_HACKATHON',
        derivedStatus: null,
        hackathonId: null,
        eventStart: null,
        eventEnd: null,
        hadRepositoryAccess: false,
        message: 'No hackathon context for your team yet',
      };
    }
    const derived = deriveLifecycleStatus({
      status: hackathon.status ?? (hackathon.isPublished ? 'PUBLISHED' : 'DRAFT'),
      registrationStart: hackathon.registrationStart ?? null,
      registrationEnd: hackathon.registrationEnd ?? null,
      eventStart: hackathon.eventStart ?? hackathon.startDate ?? null,
      eventEnd: hackathon.eventEnd ?? hackathon.endDate ?? null,
      phases: hackathon.phases ?? [],
    });
    const live = isLiveForAI({
      status: hackathon.status ?? (hackathon.isPublished ? 'PUBLISHED' : 'DRAFT'),
      registrationStart: hackathon.registrationStart ?? null,
      registrationEnd: hackathon.registrationEnd ?? null,
      eventStart: hackathon.eventStart ?? hackathon.startDate ?? null,
      eventEnd: hackathon.eventEnd ?? hackathon.endDate ?? null,
      phases: hackathon.phases ?? [],
    }, now);

    // Grant check (deep retrieval needs it; chat locked entirely outside window).
    let hadGrant = false;
    const pid = project?.id ?? membership.team?.project?.id ?? projectId ?? null;
    if (pid) {
      const grant: any = await this.prisma.repositoryAccessGrant.findFirst({
        where: { projectId: pid, status: 'GRANTED', revokedAt: null },
      } as any).catch(() => null);
      hadGrant = !!grant && grant.status !== 'REVOKED' && !grant.revokedAt;
    }

    if (!live) {
      return {
        allowed: false,
        code: 'HACKATHON_NOT_LIVE',
        derivedStatus: derived,
        hackathonId: hackathon.id,
        eventStart: hackathon.eventStart ?? hackathon.startDate ?? null,
        eventEnd: hackathon.eventEnd ?? hackathon.endDate ?? null,
        hadRepositoryAccess: hadGrant,
        message: `AI Teammate is locked outside the live window (now: ${derived}). Available 10:00 → 16:00 event window only.`,
      };
    }
    return {
      allowed: true,
      code: 'OK',
      derivedStatus: derived,
      hackathonId: hackathon.id,
      eventStart: hackathon.eventStart ?? hackathon.startDate ?? null,
      eventEnd: hackathon.eventEnd ?? hackathon.endDate ?? null,
      hadRepositoryAccess: hadGrant,
      message: 'AI Teammate available',
    };
  }

  async requireLiveAccess(userId: string, projectId?: string, hackathonId?: string, now = new Date()): Promise<AiAccessResult> {
    const result = await this.checkAccess(userId, projectId, hackathonId, now);
    if (!result.allowed) {
      const err: any = new Error(result.message);
      err.status = 403;
      err.code = result.code;
      err.details = {
        derivedStatus: result.derivedStatus,
        hackathonId: result.hackathonId,
        eventStart: result.eventStart,
        eventEnd: result.eventEnd,
      };
      throw err;
    }
    return result;
  }
}
