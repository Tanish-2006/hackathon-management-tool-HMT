import { memoryStore } from '../../store/memory.store';

export class ParticipantsService {
  // Organizer can view participants, teams, projects, participation status
  // Respect privacy boundaries: do NOT expose private team repository contents (repoUrl)

  async listParticipants(hackathonId: string, _organizerId: string): Promise<any[]> {
    const hackathon = memoryStore.hackathons.get(hackathonId);
    if (!hackathon) throw Object.assign(new Error('Hackathon not found'), { statusCode: 404 });
    // Participants are stored per hackathon
    const participants = Array.from(memoryStore.participants.values()).filter((p) => p.hackathonId === hackathonId);
    // Return sanitized: no private email? But organizer can see displayName, status, teamId
    return participants.map((p) => ({
      id: p.id,
      userId: p.userId,
      displayName: p.displayName ?? p.userId,
      hackathonId: p.hackathonId,
      teamId: p.teamId ?? null,
      participationStatus: p.participationStatus ?? 'ACTIVE',
      joinedAt: p.joinedAt ?? p.createdAt,
      // Do not expose private repository or private team conversations
    }));
  }

  async listTeams(hackathonId: string, _organizerId: string): Promise<any[]> {
    const hackathon = memoryStore.hackathons.get(hackathonId);
    if (!hackathon) throw Object.assign(new Error('Hackathon not found'), { statusCode: 404 });
    const teams = Array.from(memoryStore.teams.values()).filter((t) => t.hackathonId === hackathonId);
    return teams.map((team) => {
      const members = Array.from(memoryStore.teamMembers.values())
        .filter((m) => m.teamId === team.id)
        .map((m) => {
          const user = memoryStore.users.get(m.userId);
          return { userId: m.userId, displayName: user?.displayName ?? user?.fullName ?? m.userId, role: m.role ?? 'MEMBER' };
        });
      const project = team.projectId ? memoryStore.projects.get(team.projectId) : null;
      // Respect privacy: do NOT expose private repo contents, only title/description
      const safeProject = project
        ? {
            id: project.id,
            title: project.title,
            description: project.description,
            // repoUrl is PRIVATE - do not expose
            // Instead expose flag whether repo exists without URL
            hasRepository: !!project.repoUrl,
          }
        : null;
      return {
        id: team.id,
        hackathonId: team.hackathonId,
        name: team.name,
        memberCount: members.length,
        members,
        project: safeProject,
        createdAt: team.createdAt,
        inviteCode: undefined, // do not expose inviteCode to organizer unless necessary? Hide for privacy
      };
    });
  }

  async listProjects(hackathonId: string, _organizerId: string): Promise<any[]> {
    const hackathon = memoryStore.hackathons.get(hackathonId);
    if (!hackathon) throw Object.assign(new Error('Hackathon not found'), { statusCode: 404 });
    const projects = Array.from(memoryStore.projects.values()).filter((p) => p.hackathonId === hackathonId);
    return projects.map((project) => ({
      id: project.id,
      teamId: project.teamId,
      title: project.title,
      description: project.description,
      // Never expose private repoUrl or private file contents
      hasRepository: !!project.repoUrl,
      techStack: project.techStack ?? [],
      participationStatus: project.status ?? 'ACTIVE',
      createdAt: project.createdAt,
    }));
  }

  // For testing privacy: ensure organizer cannot automatically gain access to arbitrary private repos
  async tryAccessPrivateRepo(teamId: string, organizerId: string): Promise<{ allowed: boolean; reason: string }> {
    const team = memoryStore.teams.get(teamId);
    if (!team) return { allowed: false, reason: 'Team not found' };
    // Organizer has no default access to private repos; needs explicit grant via repository access system
    // Check if any active grant exists for organizer
    // For now, default deny
    return { allowed: false, reason: 'Organizer does not have automatic access to private team repositories. Explicit grant required.' };
  }

  // Helper to seed demo data for analytics/testing
  async seedDemoData(hackathonId: string, opts?: { participantCount?: number; teamCount?: number }) {
    const participantCount = opts?.participantCount ?? 12;
    const teamCount = opts?.teamCount ?? 4;

    for (let i = 0; i < participantCount; i++) {
      const pid = `demo_part_${hackathonId}_${i}`;
      if (!memoryStore.participants.has(pid)) {
        memoryStore.participants.set(pid, {
          id: pid,
          userId: `user_demo_${i}`,
          hackathonId,
          teamId: null,
          displayName: `Participant ${i + 1}`,
          participationStatus: i % 10 === 0 ? 'INACTIVE' : 'ACTIVE',
          joinedAt: new Date(Date.now() - Math.random() * 86400000 * 7).toISOString(),
          createdAt: new Date().toISOString(),
        });
      }
    }

    for (let i = 0; i < teamCount; i++) {
      const tid = `demo_team_${hackathonId}_${i}`;
      if (!memoryStore.teams.has(tid)) {
        memoryStore.teams.set(tid, {
          id: tid,
          hackathonId,
          name: `Team Alpha ${i + 1}`,
          memberIds: [],
          projectId: `proj_${tid}`,
          createdAt: new Date().toISOString(),
        });
        // Assign some participants to team
        const participantsInTeam = Array.from(memoryStore.participants.values()).filter((p) => p.hackathonId === hackathonId).slice(i * 3, i * 3 + 3);
        for (const p of participantsInTeam) {
          p.teamId = tid;
          const memberId = `tm_${tid}_${p.userId}`;
          memoryStore.teamMembers.set(memberId, { id: memberId, teamId: tid, userId: p.userId, role: 'MEMBER', joinedAt: new Date().toISOString() });
        }
        memoryStore.projects.set(`proj_${tid}`, {
          id: `proj_${tid}`,
          teamId: tid,
          hackathonId,
          title: `Project ${i + 1}`,
          description: `Demo project for team ${i + 1}`,
          repoUrl: `https://github.com/private-org/repo-${i}`, // private, should not be exposed
          techStack: ['TypeScript', 'Node'],
          status: i === 0 ? 'SUBMITTED' : 'IN_PROGRESS',
          createdAt: new Date().toISOString(),
        });
      }
    }
  }
}

export const participantsService = new ParticipantsService();
