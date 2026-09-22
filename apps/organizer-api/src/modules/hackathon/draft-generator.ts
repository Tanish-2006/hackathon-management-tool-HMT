import type { HackathonDraft, HackathonDraftInput, HackathonResource } from '../../domain/types';
import { randomUUID } from 'crypto';

/**
 * HackathonDraftGenerator abstraction - provider-agnostic.
 * Should eventually support an AI provider (OpenAI, Anthropic, etc.).
 * Currently implements deterministic Mock generation for testing.
 *
 * CRITICAL: AI-generated draft MUST NOT automatically publish. The caller must
 * explicitly transition through REVIEW → CONFIRMED → PUBLISHED.
 */

export abstract class HackathonDraftGenerator {
  abstract generateDraft(input: HackathonDraftInput): Promise<HackathonDraft>;
  abstract getProviderName(): string;
}

export interface DraftGeneratorOptions {
  provider?: string;
  model?: string;
}

// Mock AI implementation - deterministic, no external calls
export class MockAIDraftGenerator extends HackathonDraftGenerator {
  constructor(private readonly options: DraftGeneratorOptions = {}) {
    super();
  }

  getProviderName(): string {
    return this.options.provider ?? 'mock-ai';
  }

  async generateDraft(input: HackathonDraftInput): Promise<HackathonDraft> {
    // Validate required inputs
    if (!input.hackathonName?.trim()) throw Object.assign(new Error('hackathonName is required'), { statusCode: 400 });
    if (!input.objective?.trim()) throw Object.assign(new Error('objective is required'), { statusCode: 400 });

    // Simulate AI transformation: build structured draft from minimal inputs
    const isProblemBased = input.problemStatementBasedOrOpenInnovation === 'PROBLEM_STATEMENT_BASED';
    const theme = input.themePreference?.trim() || 'Open Innovation';

    const constraints = this.parseList(input.resources, ['Time-boxed sprints', 'Code ownership retained by participants']);
    const outcomes = this.parseList(input.expectedOutcomes, ['Functional prototype', 'Demo video']);
    const judging = this.parseList(input.judgingPreferences, ['Innovation', 'Technical implementation', 'Impact']);

    const judgingCriteriaDraft = judging.slice(0, 6).map((name, idx) => ({
      name,
      description: `${name} — evaluated by mentors and judges per hackathon guidelines`,
      weight: Number((1 / Math.min(judging.length, 6)).toFixed(2)),
    }));

    // Ensure weights sum to ~1
    const totalWeight = judgingCriteriaDraft.reduce((s, c) => s + c.weight, 0);
    if (judgingCriteriaDraft.length > 0) {
      const diff = 1 - totalWeight;
      judgingCriteriaDraft[0].weight = Number((judgingCriteriaDraft[0].weight + diff).toFixed(2));
    }

    const rulesDraft = this.parseList(input.rules, ['Original work only', 'All submissions must include README and demo link']);

    const problemStatement = isProblemBased
      ? `Problem: ${input.objective}. Audience: ${input.audience}. Mode: ${input.mode}. Participants will build solutions addressing this challenge within ${input.duration}.`
      : null;

    // Phases draft based on objective and duration
    const phasesDraft = [
      { name: 'registration', order: 1, description: 'Register and verify eligibility' },
      { name: 'team_formation', order: 2, description: 'Form teams or join existing teams' },
      { name: 'ideation', order: 3, description: 'Refine ideas and align with mentor feedback' },
      { name: 'development', order: 4, description: 'Build and iterate on solution' },
      { name: 'submission', order: 5, description: 'Submit project and demo' },
      { name: 'evaluation', order: 6, description: 'Mentor and judge evaluation' },
      { name: 'finale', order: 7, description: 'Final presentations and awards' },
    ];

    const resourcesDraft = this.parseList(input.resources, [])
      .slice(0, 5)
      .map((title) => ({
        title,
        type: 'LINK' as HackathonResource['type'],
        url: `https://example.com/resources/${encodeURIComponent(title.toLowerCase().replace(/\s+/g, '-'))}`,
      }));
    if (resourcesDraft.length === 0) {
      resourcesDraft.push({ title: 'Starter Kit - Docs & APIs', type: 'STARTER' as HackathonResource['type'], url: 'https://example.com/starter-kit' });
    }

    const draft: HackathonDraft = {
      title: input.hackathonName.trim(),
      description: `${input.objective} — Target audience: ${input.audience}. Theme: ${theme}.`,
      hackathonType: input.problemStatementBasedOrOpenInnovation,
      objective: input.objective,
      audience: input.audience,
      duration: input.duration,
      mode: input.mode,
      theme: theme,
      problemStatement,
      constraints,
      expectedOutcomes: outcomes,
      judgingCriteriaDraft,
      resourcesDraft,
      rulesDraft,
      phasesDraft,
      generatedAt: new Date().toISOString(),
      generatorVersion: 'mock-ai-v1',
    };

    return draft;
  }

  private parseList(input: string, fallback: string[]): string[] {
    if (!input?.trim()) return fallback;
    // Support comma-separated or newline or semicolon
    const parts = input
      .split(/[,;\n]+/g)
      .map((s) => s.trim())
      .filter(Boolean);
    return parts.length ? parts : fallback;
  }
}

// Provider-agnostic factory
export class DraftGeneratorFactory {
  static create(provider: string = 'mock'): HackathonDraftGenerator {
    switch (provider.toLowerCase()) {
      case 'mock':
      case 'mock-ai':
        return new MockAIDraftGenerator({ provider: 'mock-ai' });
      // Future: add OpenAI, Anthropic, etc.
      // case 'openai': return new OpenAIAdapter(...)
      default:
        return new MockAIDraftGenerator({ provider });
    }
  }
}
