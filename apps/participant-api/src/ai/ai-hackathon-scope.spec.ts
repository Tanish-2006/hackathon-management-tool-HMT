import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../database/prisma.service';
import { AiAccessService } from './ai-access.service';
import { AIController } from './ai.controller';

/**
 * AI Teammate hackathon scoping (move-inside-hackathon regression).
 * Covers:
 * - unregistered participant cannot access another hackathon's AI context
 * - per-hackathon team membership gates access (never global first team)
 * - project/hackathon mismatch is rejected
 * - conversations are isolated per project/hackathon
 * - cross-project message injection is rejected
 * - non-member cannot read another team's conversation
 * - unauthorized repository analysis denied; active grant permits; revoke blocks
 */
describe('AI hackathon scoping', () => {
  let prisma: PrismaService;
  let access: AiAccessService;
  let controller: AIController;

  const mockProvider: any = {
    generateTeammateAdvice: async () => ({
      answer: 'Consider reviewing your README structure first (hint only).',
      recommendations: [],
      hackathonStrategyTip: 'Ship early.',
    }),
  };
  const mockRetrieval: any = {
    retrieveForQuestion: async () => ({
      question: 'q',
      readmeContext: null,
      relevantFiles: [],
      retrievalReason: 'TARGETED',
      analysisScope: 'TARGETED',
      budgetUsed: { filesRetrieved: 0, rounds: 1, totalChars: 0 },
    }),
  };

  function liveWindow() {
    const now = Date.now();
    return {
      eventStart: new Date(now - 2 * 3600 * 1000),
      eventEnd: new Date(now + 2 * 3600 * 1000),
      startDate: new Date(now - 2 * 3600 * 1000),
      endDate: new Date(now + 2 * 3600 * 1000),
    };
  }

  async function makeHackathon(title: string) {
    return (prisma as any).hackathon.create({
      data: {
        title,
        description: `${title} desc`,
        problemStatement: `${title} problem`,
        status: 'PUBLISHED',
        isPublished: true,
        ...liveWindow(),
      },
    });
  }

  async function makeUser(email: string) {
    return (prisma as any).user.create({
      data: { email, passwordHash: 'h', fullName: email },
    });
  }

  async function joinTeam(userId: string, hackathonId: string, role = 'MEMBER') {
    const team = await (prisma as any).team.create({
      data: { name: `team-${userId.slice(0, 6)}-${hackathonId.slice(0, 6)}`, hackathonId },
    });
    await (prisma as any).teamMember.create({
      data: { teamId: team.id, userId, role },
    });
    return team;
  }

  async function makeProject(teamId: string, hackathonId: string, repoUrl?: string) {
    return (prisma as any).project.create({
      data: {
        teamId,
        hackathonId,
        title: `proj-${teamId.slice(0, 6)}`,
        description: 'd',
        ...(repoUrl ? { repoUrl } : {}),
      },
    });
  }

  function reqFor(userId: string, query: any = {}) {
    return { user: { id: userId, role: 'PARTICIPANT' }, query };
  }

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PrismaService, AiAccessService],
    }).compile();
    prisma = module.get<PrismaService>(PrismaService);
    access = module.get<AiAccessService>(AiAccessService);
    controller = new AIController(
      prisma,
      mockProvider,
      mockRetrieval,
      undefined,
      undefined,
      access,
    );

    for (const k of [
      'users',
      'teams',
      'members',
      'projects',
      'projectsById',
      'repositoryGrants',
      'aiConversations',
      'aiMessages',
      'aiInteractions',
      'aiAnalysisJobs',
      'hackathons',
      'auditLogs',
    ]) {
      (prisma as any)[k]?.clear?.();
    }
  });

  it('unregistered participant cannot access a hackathon AI context', async () => {
    const hackA = await makeHackathon('A');
    const hackB = await makeHackathon('B');
    const user = await makeUser('solo@test.com');
    await joinTeam(user.id, hackA.id);
    const res = await access.checkAccess(user.id, undefined, hackB.id);
    expect(res.allowed).toBe(false);
    expect(res.code).toBe('NO_MEMBERSHIP');
  });

  it('team membership is validated against the selected hackathon', async () => {
    const hackA = await makeHackathon('A');
    const hackB = await makeHackathon('B');
    const user = await makeUser('multi@test.com');
    await joinTeam(user.id, hackA.id);
    const teamB = await joinTeam(user.id, hackB.id);
    const projB = await makeProject(teamB.id, hackB.id);

    const okB = await access.checkAccess(user.id, projB.id, hackB.id);
    expect(okB.allowed).toBe(true);
    expect(okB.hackathonId).toBe(hackB.id);

    const wrongScope = await access.checkAccess(user.id, projB.id, hackA.id);
    expect(wrongScope.allowed).toBe(false);
    expect(wrongScope.code).toBe('NO_MEMBERSHIP');
  });

  it('project scope selects the right membership without a hackathon param', async () => {
    const hackA = await makeHackathon('A');
    const hackB = await makeHackathon('B');
    const user = await makeUser('dual@test.com');
    await joinTeam(user.id, hackA.id);
    const teamB = await joinTeam(user.id, hackB.id);
    const projB = await makeProject(teamB.id, hackB.id);

    const res = await access.checkAccess(user.id, projB.id);
    expect(res.allowed).toBe(true);
    expect(res.hackathonId).toBe(hackB.id);
  });

  it('hackathon A member cannot use hackathon B project context', async () => {
    const hackA = await makeHackathon('A');
    const hackB = await makeHackathon('B');
    const userA = await makeUser('a@test.com');
    const userB = await makeUser('b@test.com');
    await joinTeam(userA.id, hackA.id);
    const teamB = await joinTeam(userB.id, hackB.id);
    const projB = await makeProject(teamB.id, hackB.id);

    const res = await access.checkAccess(userA.id, projB.id, hackB.id);
    expect(res.allowed).toBe(false);
    expect(res.code).toBe('NO_MEMBERSHIP');
  });

  it('conversations are isolated per project/hackathon', async () => {
    const hackA = await makeHackathon('A');
    const hackB = await makeHackathon('B');
    const me = await makeUser('iso@test.com');
    const teamA = await joinTeam(me.id, hackA.id, 'LEADER');
    const teamB = await joinTeam(me.id, hackB.id);
    const projA = await makeProject(teamA.id, hackA.id);
    const projB = await makeProject(teamB.id, hackB.id);

    const created: any = await controller.createConversation(reqFor(me.id), {
      title: 'A chat',
      initialMessage: 'How to prioritize?',
      projectId: projA.id,
      hackathonId: hackA.id,
    } as any);
    expect(created.conversation.projectId).toBe(projA.id);

    const listA: any = await controller.listConversations(reqFor(me.id), projA.id, hackA.id);
    expect((Array.isArray(listA) ? listA : []).length).toBe(1);
    const listB: any = await controller.listConversations(reqFor(me.id), projB.id, hackB.id);
    expect((Array.isArray(listB) ? listB : []).length).toBe(0);
    const listBHack: any = await controller.listConversations(reqFor(me.id), undefined, hackB.id);
    expect((Array.isArray(listBHack) ? listBHack : []).length).toBe(0);

    // cross-project message injection rejected
    await expect(
      controller.postMessage(reqFor(me.id), created.conversation.id, {
        message: 'hijack?',
        projectId: projB.id,
      } as any),
    ).rejects.toThrow();

    // same-project follow-up works and stays scoped
    const follow: any = await controller.postMessage(reqFor(me.id), created.conversation.id, {
      message: 'And testing?',
      projectId: projA.id,
      hackathonId: hackA.id,
    } as any);
    expect(follow.answer).toContain('hint only');
  });

  it('non-member cannot read another team conversation', async () => {
    const hackA = await makeHackathon('A');
    const owner = await makeUser('owner@test.com');
    const outsider = await makeUser('out@test.com');
    const team = await joinTeam(owner.id, hackA.id, 'LEADER');
    const proj = await makeProject(team.id, hackA.id);
    const created: any = await controller.createConversation(reqFor(owner.id), {
      title: 'private',
      initialMessage: 'secret plan?',
      projectId: proj.id,
      hackathonId: hackA.id,
    } as any);
    await expect(
      controller.getConversation(reqFor(outsider.id), created.conversation.id),
    ).rejects.toThrow();
  });

  it('unauthorized analysis denied; grant permits; revoke blocks', async () => {
    const hackA = await makeHackathon('A');
    const lead = await makeUser('lead@test.com');
    const team = await joinTeam(lead.id, hackA.id, 'LEADER');
    const proj = await makeProject(
      team.id,
      hackA.id,
      'https://github.com/mockuser/awesome-project',
    );

    await expect(
      controller.createAnalysisJob(reqFor(lead.id), { projectId: proj.id } as any),
    ).rejects.toThrow(/grant/i);

    const grant = await (prisma as any).repositoryAccessGrant.create({
      data: { projectId: proj.id, teamId: team.id, grantedById: lead.id, status: 'GRANTED' },
    });
    const job: any = await controller.createAnalysisJob(reqFor(lead.id), {
      projectId: proj.id,
      hackathonId: hackA.id,
    } as any);
    expect(job.projectId).toBe(proj.id);

    const fetched: any = await controller.getAnalysisJob(reqFor(lead.id), job.id);
    expect(fetched.job.id).toBe(job.id);

    await (prisma as any).repositoryAccessGrant.update({
      where: { id: grant.id },
      data: { status: 'REVOKED', revokedAt: new Date(), revokedById: lead.id },
    });
    await expect(controller.getAnalysisJob(reqFor(lead.id), job.id)).rejects.toThrow(/grant/i);
    await expect(
      controller.createAnalysisJob(reqFor(lead.id), {
        projectId: proj.id,
        hackathonId: hackA.id,
      } as any),
    ).rejects.toThrow(/grant/i);
  });

  it('chat stays hint-only and reports the scoped context', async () => {
    const hackA = await makeHackathon('A');
    const me = await makeUser('chat@test.com');
    const team = await joinTeam(me.id, hackA.id);
    const proj = await makeProject(team.id, hackA.id);
    const res: any = await controller.chatWithTeammate(reqFor(me.id), {
      message: 'How should we prioritize?',
      projectId: proj.id,
      hackathonId: hackA.id,
    } as any);
    expect(res.answer).toContain('hint only');
    expect(res.aiContextUsed.projectId).toBe(proj.id);
    expect(res.aiContextUsed.hackathonId).toBe(hackA.id);
    expect(res.aiContextUsed.hadRepositoryAccess).toBe(false);
  });
});
