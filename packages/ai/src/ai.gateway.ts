import { AIService } from './ai.service';
import type { AiGenerateTextOptions, AiAnalyzeOptions } from './ai.types';
import { ORGANIZER_DRAFT_SYSTEM_PROMPT, buildOrganizerDraftUserPrompt } from './prompts/organizer-draft.prompt';
import { PARTICIPANT_ANALYSIS_SYSTEM_PROMPT, buildParticipantAnalysisUserPrompt } from './prompts/participant-analysis.prompt';
import { aiInteractionService } from './evaluation/ai-interaction.service';
import { randomUUID } from 'node:crypto';
import { sanitizeForLog } from './ai.types';

/**
 * AIGateway — high-level facade for business logic.
 * Ensures structured validation, interaction logging, and that AI output is DATA not AUTHORITY.
 */
export class AIGateway {
  constructor(private readonly aiService: AIService) {}

  getProviderName(): string {
    return this.aiService.getProviderName();
  }

  async generateOrganizerDraft(input: Parameters<typeof buildOrganizerDraftUserPrompt>[0], context: { requestId?: string; userId?: string; hackathonId?: string }): Promise<{ draftJson: unknown; provider: string; model: string; latencyMs: number; requestId: string; isMock: boolean }> {
    const prompt = buildOrganizerDraftUserPrompt(input);
    const requestId = context.requestId ?? randomUUID();
    const start = Date.now();
    let success = true;
    let errorCode: string | undefined;
    let result: Awaited<ReturnType<AIService['generateText']>> | null = null;
    try {
      result = await this.aiService.generateText({
        taskType: 'ORGANIZER_DRAFT',
        prompt,
        systemPrompt: ORGANIZER_DRAFT_SYSTEM_PROMPT,
        requestId,
        userId: context.userId,
        hackathonId: context.hackathonId,
      });
      await aiInteractionService.logInteraction({
        taskType: 'ORGANIZER_DRAFT',
        provider: result.provider as 'mock' | 'external',
        model: result.model,
        userId: context.userId ?? null,
        hackathonId: context.hackathonId ?? null,
        requestId,
        inputPreview: sanitizeForLog(prompt),
        responsePreview: sanitizeForLog(result.text),
        latencyMs: Date.now() - start,
        success: true,
        tokenUsage: result.tokenUsage,
      });
      // Validate JSON
      let parsed: unknown;
      try {
        parsed = JSON.parse(result.text.replace(/^\[MOCK\]\s*/, '').trim());
      } catch {
        // Try to extract JSON block
        const match = result.text.match(/\{[\s\S]*\}/);
        if (match) parsed = JSON.parse(match[0]);
        else throw Object.assign(new Error('AI returned invalid JSON for draft'), { code: 'AI_INVALID_RESPONSE', statusCode: 502 });
      }
      this.validateOrganizerDraft(parsed);
      return { draftJson: parsed, provider: result.provider, model: result.model, latencyMs: result.latencyMs, requestId, isMock: result.isMock };
    } catch (e) {
      success = false;
      errorCode = (e as { code?: string }).code ?? 'AI_ERROR';
      await aiInteractionService.logInteraction({
        taskType: 'ORGANIZER_DRAFT',
        provider: this.aiService.getProviderName() as 'mock' | 'external',
        model: this.aiService.getModel(),
        userId: context.userId ?? null,
        hackathonId: context.hackathonId ?? null,
        requestId,
        inputPreview: sanitizeForLog(prompt),
        responsePreview: sanitizeForLog((e as Error).message),
        latencyMs: Date.now() - start,
        success: false,
        errorCode,
      });
      throw e;
    }
  }

  async analyzeRepositoryParticipant(
    input: Parameters<typeof buildParticipantAnalysisUserPrompt>[0],
    context: { requestId?: string; userId?: string; teamId?: string; hackathonId?: string; projectId?: string },
  ): Promise<{ analysis: Awaited<ReturnType<AIService['analyze']>>['analysis']; provider: string; model: string; latencyMs: number; requestId: string; isMock: boolean }> {
    const prompt = buildParticipantAnalysisUserPrompt(input);
    const requestId = context.requestId ?? randomUUID();
    const start = Date.now();
    try {
      const result = await this.aiService.analyze({
        taskType: 'PARTICIPANT_ANALYSIS',
        prompt,
        systemPrompt: PARTICIPANT_ANALYSIS_SYSTEM_PROMPT,
        requestId,
        userId: context.userId,
        teamId: context.teamId,
        hackathonId: context.hackathonId,
        repositoryContext: { repoUrl: input.repoContext?.repoUrl ?? null, findingsSummary: input.findingsSummary as never },
        hackathonContext: { problemStatement: input.problemStatement ?? null, theme: input.hackathonTheme ?? null },
        relevantFiles: input.relevantFiles as never,
        readmeContext: input.readmeContext ?? null,
        analysisScope: 'TARGETED' as const,
      });
      // Validate analysis structure
      if (!Array.isArray(result.analysis) || result.analysis.length === 0) {
        throw Object.assign(new Error('AI returned invalid analysis structure'), { code: 'AI_INVALID_RESPONSE', statusCode: 502 });
      }
      for (const item of result.analysis) {
        if (!item.problem || !item.evidence || !item.hint) throw Object.assign(new Error('AI analysis missing required fields'), { code: 'AI_INVALID_RESPONSE', statusCode: 502 });
        // Enforce no large code blocks
        if (item.hint.length > 2000 || /```[\s\S]{500,}/.test(item.hint) || /<code>[\s\S]{500,}/i.test(item.hint)) {
          throw Object.assign(new Error('AI hint contains disallowed large code block'), { code: 'AI_POLICY_VIOLATION', statusCode: 502 });
        }
      }
      await aiInteractionService.logInteraction({
        taskType: 'PARTICIPANT_ANALYSIS',
        provider: result.provider as 'mock' | 'external',
        model: result.model,
        userId: context.userId ?? null,
        teamId: context.teamId ?? null,
        hackathonId: context.hackathonId ?? null,
        projectId: context.projectId ?? null,
        requestId,
        inputPreview: sanitizeForLog(prompt),
        responsePreview: sanitizeForLog(result.text),
        latencyMs: Date.now() - start,
        success: true,
        tokenUsage: result.tokenUsage,
      });
      return { analysis: result.analysis, provider: result.provider, model: result.model, latencyMs: result.latencyMs, requestId, isMock: result.isMock };
    } catch (e) {
      await aiInteractionService.logInteraction({
        taskType: 'PARTICIPANT_ANALYSIS',
        provider: this.aiService.getProviderName() as 'mock' | 'external',
        model: this.aiService.getModel(),
        userId: context.userId ?? null,
        teamId: context.teamId ?? null,
        hackathonId: context.hackathonId ?? null,
        projectId: context.projectId ?? null,
        requestId,
        inputPreview: sanitizeForLog(prompt),
        responsePreview: sanitizeForLog((e as Error).message),
        latencyMs: Date.now() - start,
        success: false,
        errorCode: (e as { code?: string }).code ?? 'AI_ERROR',
      });
      throw e;
    }
  }

  private validateOrganizerDraft(json: unknown): void {
    const obj = json as Record<string, unknown>;
    const required = ['title', 'description', 'hackathonType', 'objective', 'audience', 'duration', 'mode', 'theme', 'constraints', 'expectedOutcomes', 'judgingCriteriaDraft', 'resourcesDraft', 'rulesDraft', 'phasesDraft'];
    for (const key of required) {
      if (obj[key] === undefined || obj[key] === null) throw Object.assign(new Error(`AI draft missing required field: ${key}`), { code: 'AI_INVALID_RESPONSE', statusCode: 502 });
    }
    // Do not allow AI to set status or publish
    if ((obj as { status?: unknown }).status !== undefined) throw Object.assign(new Error('AI must not set status'), { code: 'AI_POLICY_VIOLATION', statusCode: 502 });
    if (Array.isArray(obj.judgingCriteriaDraft)) {
      for (const c of obj.judgingCriteriaDraft as Array<Record<string, unknown>>) {
        if (typeof c.name !== 'string' || typeof c.weight !== 'number') throw Object.assign(new Error('Invalid judgingCriteriaDraft'), { code: 'AI_INVALID_RESPONSE', statusCode: 502 });
      }
    }
  }
}
