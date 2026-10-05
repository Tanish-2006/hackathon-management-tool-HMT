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

  async checkAccess(userId: string, projectId?: string, now = new Date()): Promise<AiAccessResult> {
    const membership: any = await this.prisma.teamMember.findFirst({
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
    let hackathon: any = membership.team?.hackathon ?? null;
    let project: any = null;
    if (projectId) {
      project = await this.prisma.project.findUnique({ where: { id: projectId } } as any);
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
      // Prefer the project hackathon when present (same canonical ID).
      if (project.hackathonId) {
        const ph = await (this.prisma as any).hackathon?.findUnique?.({ where: { id: project.hackathonId } }).catch(() => null);
        if (ph) hackathon = ph;
      }
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

  async requireLiveAccess(userId: string, projectId?: string, now = new Date()): Promise<AiAccessResult> {
    const result = await this.checkAccess(userId, projectId, now);
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
