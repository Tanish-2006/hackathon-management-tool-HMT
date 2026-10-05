import { Injectable } from '@nestjs/common';
import { VisibilityLevel } from '../common/enums/visibility.enum';

@Injectable()
export class PrivacyService {
  isVisible(
    requester: { id: string; role: string; teamId?: string | null },
    resourceVisibility: VisibilityLevel,
    ownerTeamId?: string | null,
    ownerUserId?: string | null,
  ): boolean {
    if (requester.role === 'ADMIN' || requester.role === 'ORGANIZER')
      return true;
    // PUBLIC_PROFILE always visible
    if (resourceVisibility === VisibilityLevel.PUBLIC_PROFILE) return true;
    if (resourceVisibility === VisibilityLevel.TEAM_DISCOVERABLE) {
      // any authenticated participant can discover, but not see private details
      return true;
    }
    if (resourceVisibility === VisibilityLevel.TEAM_PRIVATE) {
      // only team members
      return !!requester.teamId && requester.teamId === ownerTeamId;
    }
    if (resourceVisibility === VisibilityLevel.MENTOR_ONLY) {
      return requester.role === 'MENTOR';
    }
    if (resourceVisibility === VisibilityLevel.ORGANIZER_ONLY) return false;
    return false;
  }

  filterTeamForParticipant(team: any, requester: any, isMember: boolean) {
    if (isMember) return team;
    // Privacy-first matching: non-members see ONLY skills/role/availability,
    // never repoUrl, inviteCode, private discussions, or full project internals.
    const { inviteCode: _invite, project: _project, ...rest } = team ?? {};
    if (team?.visibility === VisibilityLevel.TEAM_PRIVATE) {
      return {
        id: rest.id,
        name: rest.name,
        hackathonId: rest.hackathonId,
        visibility: rest.visibility,
        requiredSkills: rest.requiredSkills,
        isDiscoverable: rest.isDiscoverable,
        memberCount: rest.members?.length ?? team?.members?.length ?? 0,
      };
    }
    // TEAM_DISCOVERABLE non-member: same minimal projection (fix prior full leak).
    return {
      id: rest.id,
      name: rest.name,
      hackathonId: rest.hackathonId,
      visibility: rest.visibility,
      requiredSkills: rest.requiredSkills ?? [],
      isDiscoverable: rest.isDiscoverable ?? true,
      memberCount: rest.members?.length ?? team?.members?.length ?? 0,
      skills: rest.skills ?? undefined,
      rolesNeeded: rest.rolesNeeded ?? undefined,
      experienceLevel: rest.experienceLevel ?? undefined,
      availability: rest.availability ?? undefined,
    };
  }

  filterProjectForParticipant(
    project: any,
    requesterTeamId: string | null,
    isMember: boolean,
    hasGrant = false,
  ) {
    if (!project) return null;
    if (isMember && hasGrant) return project;
    if (project.visibility === VisibilityLevel.PUBLIC_PROFILE) {
      if (hasGrant) return project;
      const { repoUrl: _r, ...pub } = project;
      // Public still hides repoUrl without an explicit grant (authorized sharing only).
      return pub;
    }
    if (isMember) {
      // Member without grant: metadata yes, repoUrl hidden until leader grants access.
      const { repoUrl: _r, ...rest } = project;
      return rest;
    }
    // Non-member: minimal card only — never repoUrl, architecture, or discussions.
    return {
      id: project.id,
      title: project.title,
      techStack: project.techStack,
      status: project.status,
      visibility: project.visibility,
      description: 'Private project - join team to view details',
    };
  }
}
