import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

function read(p: string): string {
  return fs.readFileSync(p, 'utf8');
}

/**
 * AI Teammate move-inside-hackathon regression (file-content guards).
 * Backend behavior is covered by apps/participant-api/src/ai/ai-hackathon-scope.spec.ts (jest).
 */
describe('AI Teammate hackathon scope', () => {
  it('global AI Teammate sidebar entry is removed', () => {
    const app = read('apps/participant-api/frontend/src/App.tsx');
    expect(app).not.toContain("{ href: '/participant/ai', label: 'AI Teammate'");
    expect(app).not.toMatch(/href:\s*'\/participant\/ai',\s*label:\s*'AI Teammate'/);
  });

  it('AI Teammate is accessible from the hackathon workspace route', () => {
    const app = read('apps/participant-api/frontend/src/App.tsx');
    expect(app).toContain('/participant/my-hackathons/:id/ai');
    expect(app).toContain('ParticipantHackathonAI');
    expect(
      fs.existsSync('apps/participant-api/frontend/src/pages/participant/hackathon-ai.tsx'),
    ).toBe(true);
  });

  it('old global route is handled safely (redirect, no unscoped workspace)', () => {
    const app = read('apps/participant-api/frontend/src/App.tsx');
    expect(app).toContain('<Route path="/participant/ai"><Redirect to="/participant/ai-helper" /></Route>');
    expect(read('apps/participant-api/frontend/src/pages/participant/ai-helper.tsx')).toContain('useHackathonContext');
  });

  it('My Hackathons links to the AI Helper scoped to that hackathon', () => {
    const mine = read('apps/participant-api/frontend/src/pages/participant/my-hackathons.tsx');
    expect(mine).toContain('/participant/ai-helper?hackathon=${r.id}');
    expect(mine).not.toContain('href="/participant/ai"');
  });

  it('dashboard AI Helper link targets the registered hackathon', () => {
    const dash = read('apps/participant-api/frontend/src/pages/participant/dashboard.tsx');
    expect(dash).toContain('/participant/ai-helper?hackathon=${hackathon.id}');
    expect(dash).not.toContain('href="/participant/ai"');
  });

  it('AI page scopes context/history by hackathon and resets on switch', () => {
    const ai = read('apps/participant-api/frontend/src/pages/participant/ai.tsx');
    expect(ai).toContain('hackathonId');
    expect(ai).toContain('getAIConversations(proj.id, contextId');
    // stale workspace state never carries over
    expect(ai).toContain('setConversations([])');
    expect(ai).toContain('setActiveId(null)');
    // all AI mutations carry the hackathon scope
    expect(ai).toContain('postAIConversationMessage(activeId, trimmed, project?.id, contextId');
    expect(ai).toContain('hackathonId: contextId');
    // scoped mode hides the global selector in favor of fixed workspace context
    expect(ai).toContain('Switch hackathon');
  });

  it('frontend API client sends hackathon scope on AI calls', () => {
    const api = read('apps/participant-api/frontend/src/services/backendApi.ts');
    expect(api).toContain('hackathonId');
    expect(api).toContain('/ai/access-status');
    expect(api).toContain('/ai/conversations');
  });

  it('backend validates hackathon-scoped membership (authoritative)', () => {
    const svc = read('apps/participant-api/src/ai/ai-access.service.ts');
    expect(svc).toContain('findMembershipInHackathon');
    expect(svc).toContain('checkAccess(userId: string, projectId?: string, hackathonId?: string');
    expect(svc).toContain('Project does not belong to this hackathon');
    const dto = read('apps/participant-api/src/ai/dto/ai.dto.ts');
    expect(dto).toContain('hackathonId');
  });

  it('backend isolates conversations per project/hackathon', () => {
    const ctrl = read('apps/participant-api/src/ai/ai.controller.ts');
    expect(ctrl).toContain('findMembershipInHackathon');
    expect(ctrl).toContain('findMembershipForProject');
    expect(ctrl).toContain('Conversation belongs to another project');
    expect(ctrl).toContain("@Query('projectId')");
    expect(ctrl).toContain("@Query('hackathonId')");
    // buildAIContext never trusts client IDs alone
    expect(ctrl).toContain(
      'buildAIContext(userId: string, projectId?: string, hackathonId?: string)',
    );
  });

  it('no new database model for scope (project relation reused)', () => {
    const schema = read('apps/participant-api/prisma/schema.prisma');
    expect(schema).toContain('model AIConversation');
    expect(schema).not.toContain('AIHackathonContext');
    expect(schema).not.toContain('model AIConversationScope');
  });

  it('existing AI capabilities preserved', () => {
    const ctrl = read('apps/participant-api/src/ai/ai.controller.ts');
    expect(ctrl).toContain('AiRateLimitGuard');
    expect(ctrl).toContain('TARGETED');
    const gw = read('packages/ai/src/ai.gateway.ts');
    expect(gw).toContain('AI_POLICY_VIOLATION');
    const gh = read('apps/participant-api/src/github/github-provider.interface.ts');
    expect(gh).not.toContain('createCommit');
    const retrieval = read('packages/ai/src/retrieval/targeted-retrieval.service.ts');
    expect(retrieval).toContain('redactSecrets');
    expect(fs.existsSync('apps/participant-api/src/ai/ai-hackathon-scope.spec.ts')).toBe(true);
  });
});
