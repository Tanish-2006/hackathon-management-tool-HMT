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
    // non-member sees only discoverable subset
    if (team.visibility === VisibilityLevel.TEAM_PRIVATE) {
      // hide private fields
      const { inviteCode, ...publicPart } = team;
      return {
        id: publicPart.id,
        name: publicPart.name,
        hackathonId: publicPart.hackathonId,
        visibility: publicPart.visibility,
        requiredSkills: publicPart.requiredSkills,
        isDiscoverable: publicPart.isDiscoverable,
        memberCount: publicPart.members?.length ?? 0,
        // do not expose private project details, repoUrl, discussions
      };
    }
    return team;
  }

  filterProjectForParticipant(
    project: any,
    requesterTeamId: string | null,
    isMember: boolean,
  ) {
    if (!project) return null;
    if (project.visibility === VisibilityLevel.PUBLIC_PROFILE) return project;
    if (project.visibility === VisibilityLevel.TEAM_DISCOVERABLE && isMember)
      return project;
    if (project.visibility === VisibilityLevel.TEAM_PRIVATE && isMember)
      return project;
    if (isMember) return project;
    // not member -> hide private repoUrl and private discussions
    if (project.visibility === VisibilityLevel.TEAM_PRIVATE) {
      return {
        id: project.id,
        title: project.title,
        techStack: project.techStack,
        status: project.status,
        visibility: project.visibility,
        // repoUrl hidden
        // description truncated
        description:
          project.visibility === VisibilityLevel.PUBLIC_PROFILE
            ? project.description
            : 'Private project - join team to view details',
      };
    }
    return project;
  }
}
