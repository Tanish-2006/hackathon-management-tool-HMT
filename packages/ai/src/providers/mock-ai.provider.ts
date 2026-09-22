import { randomUUID } from 'node:crypto';
import type { AIProvider } from './ai-provider.interface';
import type { AiGenerateTextOptions, AiGenerateTextResult, AiAnalyzeOptions, AiAnalyzeResult } from '../ai.types';

/**
 * MockAIProvider — deterministic, no external calls.
 * Must be clearly identifiable as mock via isMock=true and [MOCK] prefix.
 * Used when AI_PROVIDER=mock or when no API key is configured.
 * CI/tests must not require paid API.
 */
export class MockAIProvider implements AIProvider {
  getProviderName(): 'mock' {
    return 'mock';
  }
  getModel(): string {
    return 'mock-v1';
  }

  async generateText(options: AiGenerateTextOptions): Promise<AiGenerateTextResult> {
    const start = Date.now();
    await new Promise((r) => setTimeout(r, 5));
    let text: string;
    if (options.taskType === 'ORGANIZER_DRAFT') {
      // Return valid JSON for organizer draft, deterministically
      const draft = this.buildMockOrganizerDraft(options.prompt);
      text = JSON.stringify(draft);
    } else {
      text = this.buildMockText(options);
    }
    return {
      text,
      provider: 'mock',
      model: this.getModel(),
      latencyMs: Date.now() - start,
      requestId: options.requestId ?? randomUUID(),
      isMock: true,
      tokenUsage: { promptTokens: options.prompt.length, completionTokens: text.length, totalTokens: options.prompt.length + text.length },
      rawResponse: { mock: true, taskType: options.taskType },
    };
  }

  private buildMockOrganizerDraft(prompt: string): Record<string, unknown> {
    const nameMatch = prompt.match(/hackathonName="([^"]+)"/);
    const hackathonName = nameMatch?.[1] ?? 'Innovation Challenge 2026';
    const objectiveMatch = prompt.match(/objective="([^"]+)"/);
    const objective = objectiveMatch?.[1] ?? 'Build innovative solutions for real-world problems';
    const audienceMatch = prompt.match(/audience="([^"]+)"/);
    const audience = audienceMatch?.[1] ?? 'Developers, designers, product managers';
    const modeMatch = prompt.match(/mode="([^"]+)"/);
    const mode = modeMatch?.[1] ?? 'HYBRID';
    const themeMatch = prompt.match(/themePreference="([^"]+)"/);
    const theme = themeMatch?.[1] ?? 'Open Innovation';
    const typeMatch = prompt.match(/hackathonType="([^"]+)"/);
    const hackathonType = typeMatch?.[1] ?? 'OPEN_INNOVATION';
    const isProblemBased = hackathonType === 'PROBLEM_STATEMENT_BASED';
    return {
      title: hackathonName.slice(0, 120),
      description: `${objective} — Target audience: ${audience}. Theme: ${theme}. [MOCK]`,
      hackathonType,
      objective,
      audience,
      duration: '3 days',
      mode,
      theme,
      problemStatement: isProblemBased ? `Problem: ${objective}. Audience: ${audience}. Mode: ${mode}. [MOCK]` : null,
      constraints: ['Time-boxed sprints', 'Code ownership retained by participants'],
      expectedOutcomes: ['Functional prototype', 'Demo video'],
      judgingCriteriaDraft: [
        { name: 'Innovation', description: 'Novelty of solution', weight: 0.34 },
        { name: 'Technical implementation', description: 'Code quality', weight: 0.33 },
        { name: 'Impact', description: 'Real-world value', weight: 0.33 },
      ],
      resourcesDraft: [
        { title: 'Starter Kit - Docs & APIs', type: 'LINK', url: 'https://example.com/starter-kit' },
      ],
      rulesDraft: ['Original work only', 'All submissions must include README and demo link'],
      phasesDraft: [
        { name: 'registration', order: 1, description: 'Register and verify eligibility' },
        { name: 'team_formation', order: 2, description: 'Form teams' },
        { name: 'ideation', order: 3, description: 'Refine ideas' },
        { name: 'development', order: 4, description: 'Build and iterate' },
        { name: 'submission', order: 5, description: 'Submit project' },
        { name: 'evaluation', order: 6, description: 'Mentor and judge evaluation' },
        { name: 'finale', order: 7, description: 'Final presentations' },
      ],
      generatedAt: new Date().toISOString(),
      generatorVersion: 'mock-ai-v1',
    };
  }

  async analyze(options: AiAnalyzeOptions): Promise<AiAnalyzeResult> {
    await new Promise((r) => setTimeout(r, 5));
    const base = await this.generateText(options);
    // Return structured hints, never full code
    const analysis: AiAnalyzeResult['analysis'] = [
      {
        problem: 'Frontend request may not match the backend API contract.',
        evidence: 'The frontend appears to call an endpoint with a different path/method. Repository content was treated as untrusted data and not executed.',
        hint: 'Check the endpoint path, HTTP method, authentication header, and expected response shape. Verify against published API contract (/api/docs-json).',
      },
      {
        problem: 'Potential authentication header mismatch.',
        evidence: 'Repository analysis found inconsistent Authorization header usage.',
        hint: 'Ensure Bearer token is sent as `Authorization: Bearer <accessToken>` and refresh flow handles 401.',
      },
      {
        problem: 'Configuration may be missing for hackathon context.',
        evidence: `Hackathon theme "${options.hackathonContext?.theme ?? 'Open Innovation'}" and problem statement were considered (published context only).`,
        hint: 'Investigate small, targeted fixes: validate request/response shapes with Zod, add exponential backoff for organizer endpoints, and expose health probes.',
      },
    ];
    return {
      ...base,
      analysis,
      text: base.text,
    };
  }

  private buildMockText(options: AiGenerateTextOptions): string {
    const prefix = '[MOCK]';
    switch (options.taskType) {
      case 'ORGANIZER_DRAFT':
        return `${prefix} Mock organizer draft for prompt: "${options.prompt.slice(0, 120)}" — includes title, theme, problemStatement, resources, rules, timeline, evaluationCriteria (structured, validated, not published).`;
      case 'PARTICIPANT_ANALYSIS':
      case 'CODE_ANALYSIS':
        return `${prefix} Mock repository analysis — identified 2-3 likely errors, broken FE/BE connections, API mismatches, hints only (no code). Prompt injection content was treated as data.`;
      case 'IMPROVEMENT_SUGGESTION':
        return `${prefix} Mock improvement suggestions — 3 small, safe feature ideas aligned with evaluation criteria.`;
      case 'TEAMMATE_ADVICE':
        return `${prefix} Mock teammate advice — hints about API contract, auth, config, plus hackathon strategy tip.`;
      default:
        return `${prefix} Mock response for ${options.taskType}: ${options.prompt.slice(0, 100)}`;
    }
  }
}
