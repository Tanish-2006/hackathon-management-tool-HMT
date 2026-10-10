import { randomUUID } from 'crypto';
import type { Hackathon, HackathonDraft, HackathonDraftInput, HackathonStatus, HackathonPublishedEvent, HackathonPhase, RegenerableSection, SectionProvenance, WizardInput } from '../../domain/types';
import { memoryStore } from '../../store/memory.store';
import { MockAIDraftGenerator, DraftGeneratorFactory } from './draft-generator';
import { buildWizardSections, deriveWorkingTitle, eligibilityToAudience, rebuildSection, splitDurationPlus, toBaseDraft } from './wizard-generator';
import { wizardDraftSchema } from './hackathon.schemas';
import { auditService } from '../audit/audit.service';
import { normalizeTimeline, verifyTimelineInWindow } from '../timeline/timeline-normalizer';
import { AIService } from '@hmt/ai';
import { AIGateway } from '@hmt/ai';
import { loadBaseEnv, resolveSyncSecret } from '@hmt/config';
import { defaultIdeationConfig, type IdeationConfig } from '@hmt/contracts';

// Hackathon scalar fields mapped to review-section provenance keys.
const PROVENANCE_FIELD_MAP: Record<string, string> = {
  title: 'title',
  description: 'description',
  rules: 'rules',
  problemStatement: 'problemStatements',
  objective: 'description',
  constraints: 'rules',
  judgingPreferences: 'evaluationCriteria',
  expectedOutcomes: 'description',
};

// Extended wizard sections editable via PATCH (stored in metadata.draft, never as top-level columns).
const EXTENDED_DRAFT_KEYS = [
  'tagline',
  'guidelines',
  'codeOfConduct',
  'faqs',
  'prizes',
  'announcement',
  'eligibility',
  'teamSize',
  'participationInstructions',
  'openInnovation',
  'problemStatements',
  'theme',
  'participation',
] as const;

// Server-side cross-field validation for Step 8 participation config.
// Shape-level checks live in updateSchema (zod); this enforces the rules
// zod cannot express across fields. Returns an error message or null.
export const REPO_REQUIREMENT_VALUES = ['REQUIRED', 'OPTIONAL', 'DISABLED'] as const;
export type RepoRequirement = (typeof REPO_REQUIREMENT_VALUES)[number];

/** Normalize organizer input / event data to a safe requirement (default OPTIONAL). */
export function normalizeRepoRequirement(value: unknown): RepoRequirement {
  return value === 'REQUIRED' || value === 'DISABLED' ? value : 'OPTIONAL';
}
function validateParticipationConfig(cfg: Record<string, unknown>): string | null {
  const mode = cfg.mode as string | undefined;
  if (mode !== undefined && !['INDIVIDUAL', 'TEAMS', 'BOTH'].includes(mode)) {
    return 'Invalid participation mode';
  }
  const teamSize = cfg.teamSize as { min?: unknown; max?: unknown } | null | undefined;
  if (mode === 'INDIVIDUAL') {
    if (teamSize !== undefined && teamSize !== null) return 'Team size must not be set for individual-only participation';
  } else if (mode !== undefined) {
    if (teamSize === undefined || teamSize === null) return 'Team size is required when teams are enabled';
    const min = (teamSize as any)?.min;
    const max = (teamSize as any)?.max;
    if (!Number.isInteger(min) || min < 1) return 'Minimum team size must be >= 1';
    if (!Number.isInteger(max) || (max as number) < (min as number)) {
      return 'Maximum team size must be >= minimum team size';
    }
  } else if (teamSize !== undefined && teamSize !== null) {
    const min = (teamSize as any)?.min;
    const max = (teamSize as any)?.max;
    if (!Number.isInteger(min) || (min as number) < 1) return 'Minimum team size must be >= 1';
    if (!Number.isInteger(max) || (max as number) < (min as number)) {
      return 'Maximum team size must be >= minimum team size';
    }
  }
  return null;
}

export class HackathonService {
  private draftGenerator = DraftGeneratorFactory.create('mock');
  private customGeneratorSet = false;
  // Allow injecting custom generator for provider-agnostic testing
  setDraftGenerator(generator: any) {
    this.draftGenerator = generator;
    this.customGeneratorSet = true;
  }

  // Create draft from organizer workflow input via AI Gateway (provider-independent)
  async generateDraft(input: HackathonDraftInput, organizerId: string, opts?: { ip?: string; requestId?: string }): Promise<{ hackathon: Hackathon; draft: HackathonDraft }> {
    let draft: HackathonDraft;
    // If test injected a custom generator, use it directly to preserve existing tests
    if (this.customGeneratorSet) {
      draft = await this.draftGenerator.generateDraft(input);
    } else {
      // Use AI Gateway when available — respects AI_PROVIDER=mock|external, never publishes
      try {
        const env = this.safeLoadEnvForAI();
        const aiService = new AIService({
          provider: (env?.AI_API_KEY ? env.AI_PROVIDER : 'mock') as 'mock' | 'external',
          apiKey: env?.AI_API_KEY ?? '',
          model: env?.AI_MODEL ?? '',
          baseUrl: env?.AI_BASE_URL ?? '',
          timeoutMs: env?.AI_TIMEOUT_MS ?? 15000,
          maxRetries: env?.AI_MAX_RETRIES ?? 1,
        });
        const gateway = new AIGateway(aiService);
        const result = await gateway.generateOrganizerDraft(
          {
            hackathonName: input.hackathonName,
            objective: input.objective,
            audience: input.audience,
            duration: input.duration,
            mode: input.mode,
            themePreference: input.themePreference,
            problemStatementBasedOrOpenInnovation: input.problemStatementBasedOrOpenInnovation,
            expectedOutcomes: input.expectedOutcomes,
            judgingPreferences: input.judgingPreferences,
            resources: input.resources,
            rules: input.rules,
          },
          { requestId: opts?.requestId, userId: organizerId },
        );
        draft = result.draftJson as HackathonDraft;
        if (!draft.title) throw new Error('AI draft missing title');
      } catch (e) {
        // Fallback to local mock for tests or if gateway fails in mock mode
        if (process.env.AI_PROVIDER === 'external' && process.env.NODE_ENV === 'production') throw e;
        draft = await this.draftGenerator.generateDraft(input);
      }
    }

    const id = randomUUID();
    const slug = memoryStore.generateSlug(draft.title);
    const now = new Date().toISOString();

    const hackathon: Hackathon = {
      id,
      slug,
      title: draft.title,
      description: draft.description,
      hackathonType: draft.hackathonType,
      objective: draft.objective,
      audience: draft.audience,
      duration: draft.duration,
      mode: draft.mode,
      themeIds: [], // themes linked separately after creation
      problemStatement: draft.problemStatement,
      constraints: draft.constraints,
      resources: draft.resourcesDraft.map((r) => r.title),
      expectedOutcomes: draft.expectedOutcomes,
      judgingPreferences: draft.judgingCriteriaDraft.map((c) => c.name),
      rules: draft.rulesDraft,
      status: 'DRAFT',
      organizerId,
      version: 1,
      createdAt: now,
      updatedAt: now,
      publishedAt: null,
      archivedAt: null,
      metadata: {
        draftGeneratedAt: draft.generatedAt,
        draftGenerator: (this.draftGenerator as any).getProviderName?.() ?? 'mock-ai',
        draft: draft,
      },
    };

    memoryStore.hackathons.set(id, hackathon);
    memoryStore.hackathonBySlug.set(slug, id);

    // Auto-create evaluation criteria from draft
    for (const crit of draft.judgingCriteriaDraft) {
      const cid = randomUUID();
      memoryStore.evaluationCriteria.set(cid, {
        id: cid,
        hackathonId: id,
        name: crit.name,
        description: crit.description,
        weight: crit.weight,
        maxScore: 10,
        createdAt: now,
        updatedAt: now,
      });
    }

    // AI suggests phase names/order/descriptions only (phasesDraft is dateless
    // by contract). Dated phases are NEVER invented here: they materialize
    // later via materializeTimeline() once the organizer sets an explicit
    // event window. See timeline-normalizer.ts (single authority for dates).

    // Auto-create theme if not exists
    if (draft.theme) {
      const existingTheme = Array.from(memoryStore.themes.values()).find((t) => t.name.toLowerCase() === draft.theme.toLowerCase());
      let themeId: string;
      if (existingTheme) {
        themeId = existingTheme.id;
      } else {
        themeId = randomUUID();
        memoryStore.themes.set(themeId, {
          id: themeId,
          name: draft.theme,
          description: `Theme: ${draft.theme}`,
          createdById: organizerId,
          createdAt: now,
        });
      }
      hackathon.themeIds = [themeId];
      memoryStore.hackathons.set(id, hackathon);
    }

    // Also create resources
    for (const r of draft.resourcesDraft) {
      const rid = randomUUID();
      memoryStore.resources.set(rid, {
        id: rid,
        hackathonId: id,
        title: r.title,
        type: r.type,
        url: r.url ?? null,
        content: null,
        visibility: 'PUBLIC',
        createdAt: now,
        updatedAt: now,
      });
    }

    await auditService.log({
      actorId: organizerId,
      actorRole: 'ORGANIZER',
      action: 'hackathon.draft_generated',
      resourceType: 'hackathon',
      resourceId: id,
      outcome: 'success',
      ip: opts?.ip ?? null,
      requestId: opts?.requestId ?? null,
      metadata: { title: draft.title, hackathonType: draft.hackathonType, generator: draft.generatorVersion },
    });

    return { hackathon, draft };
  }

  // ---- Quick-create wizard: 5 organizer answers -> complete AI draft (DRAFT only) ----
  // AI output is DATA: validated against wizardDraftSchema before anything is stored.
  // Malformed AI output is never stored. AI can never publish (DRAFT only; transitions stay organizer-authenticated).
  async generateWizardDraft(wizard: WizardInput, organizerId: string, opts?: { ip?: string; requestId?: string }): Promise<{ hackathon: Hackathon; draft: HackathonDraft }> {
    const about = wizard.about.trim();
    const { duration, requirements } = splitDurationPlus(wizard.durationPlus);
    const audience = eligibilityToAudience(wizard.eligibility, wizard.customEligibility);
    const workingTitle = deriveWorkingTitle(about);

    let base: HackathonDraft;
    let provider = 'wizard-v1';
    if (this.customGeneratorSet) {
      base = await this.draftGenerator.generateDraft({
        hackathonName: workingTitle,
        objective: about,
        audience,
        duration,
        mode: wizard.mode,
        themePreference: about.split(' ').slice(0, 3).join(' ') || 'Open Innovation',
        problemStatementBasedOrOpenInnovation: wizard.hackathonType,
        expectedOutcomes: 'Functional prototype, Demo video',
        judgingPreferences: 'Innovation, Technical implementation, Impact',
        resources: 'Starter Kit',
        rules: requirements || 'Original work only',
      });
      provider = (this.draftGenerator as any).getProviderName?.() ?? 'mock-ai';
    } else {
      try {
        const env = this.safeLoadEnvForAI();
        const aiService = new AIService({
          provider: (env?.AI_API_KEY ? env.AI_PROVIDER : 'mock') as 'mock' | 'external',
          apiKey: env?.AI_API_KEY ?? '',
          model: env?.AI_MODEL ?? '',
          baseUrl: env?.AI_BASE_URL ?? '',
          timeoutMs: env?.AI_TIMEOUT_MS ?? 15000,
          maxRetries: env?.AI_MAX_RETRIES ?? 1,
        });
        const gateway = new AIGateway(aiService);
        const result = await gateway.generateOrganizerDraft(
          {
            hackathonName: workingTitle,
            objective: about,
            audience,
            duration,
            mode: wizard.mode,
            themePreference: about.split(' ').slice(0, 3).join(' ') || 'Open Innovation',
            problemStatementBasedOrOpenInnovation: wizard.hackathonType,
            expectedOutcomes: 'Functional prototype, Demo video',
            judgingPreferences: 'Innovation, Technical implementation, Impact',
            resources: 'Starter Kit',
            rules: requirements || 'Original work only',
          },
          { requestId: opts?.requestId, userId: organizerId },
        );
        base = result.draftJson as HackathonDraft;
        provider = `${result.provider}:${result.model}`;
        if (!base.title) throw new Error('AI draft missing title');
      } catch (e) {
        if (process.env.AI_PROVIDER === 'external' && process.env.NODE_ENV === 'production') throw e;
        const fallback = new MockAIDraftGenerator({ provider: 'wizard-fallback' });
        base = await fallback.generateDraft({
          hackathonName: workingTitle,
          objective: about,
          audience,
          duration,
          mode: wizard.mode,
          themePreference: about.split(' ').slice(0, 3).join(' ') || 'Open Innovation',
          problemStatementBasedOrOpenInnovation: wizard.hackathonType,
          expectedOutcomes: 'Functional prototype, Demo video',
          judgingPreferences: 'Innovation, Technical implementation, Impact',
          resources: 'Starter Kit',
          rules: requirements || 'Original work only',
        });
        provider = 'wizard-fallback';
      }
    }

    // Extended wizard sections (deterministic, mode-aware, no fabricated facts).
    const sections = buildWizardSections(wizard, 0);
    // Gateway/mock owns title+description when available; otherwise use wizard sections.
    const merged: Record<string, unknown> = {
      ...sections,
      title: base.title || sections.title,
      description: base.description || sections.description,
      theme: (base as HackathonDraft).theme || sections.theme,
      mode: wizard.mode,
      hackathonType: wizard.hackathonType,
    };
    const parsed = wizardDraftSchema.safeParse(merged);
    if (!parsed.success) {
      throw Object.assign(new Error('AI returned invalid structured draft'), { statusCode: 502 });
    }

    const draft: HackathonDraft = {
      ...toBaseDraft(sections, wizard),
      title: parsed.data.title,
      description: parsed.data.description,
      theme: parsed.data.theme ?? sections.theme,
      tagline: parsed.data.tagline ?? sections.tagline,
      eligibility: parsed.data.eligibility ?? sections.eligibility,
      teamSize: (parsed.data.teamSize as { min: number; max: number; recommended?: number } | null) ?? sections.teamSize,
      problemStatements: parsed.data.problemStatements ?? sections.problemStatements,
      openInnovation: (parsed.data.openInnovation as { guidelines: string[] } | null) ?? sections.openInnovation,
      participationInstructions: parsed.data.participationInstructions ?? sections.participationInstructions,
      guidelines: parsed.data.guidelines ?? sections.guidelines,
      codeOfConduct: parsed.data.codeOfConduct ?? sections.codeOfConduct,
      faqs: (parsed.data.faqs as Array<{ question: string; answer: string }>) ?? sections.faqs,
      prizes: (parsed.data.prizes as Array<{ title: string; description: string }>) ?? sections.prizes,
      announcement: parsed.data.announcement ?? sections.announcement,
      generatorVersion: provider,
    };

    const persisted = await this.persistGeneratedDraft(draft, organizerId, opts, {
      wizardInput: { mode: wizard.mode, about: about.slice(0, 500), hackathonType: wizard.hackathonType, eligibility: wizard.eligibility, duration, requirements: requirements.slice(0, 500) },
      auditAction: 'hackathon.wizard_generated',
    });
    return persisted;
  }

  // Shared persistence for AI-generated drafts (criteria/phases/theme/resources + AI-id tracking).
  private async persistGeneratedDraft(
    draft: HackathonDraft,
    organizerId: string,
    opts: { ip?: string; requestId?: string } | undefined,
    extra: { wizardInput?: Record<string, unknown>; auditAction: string },
  ): Promise<{ hackathon: Hackathon; draft: HackathonDraft }> {
    const id = randomUUID();
    const slug = memoryStore.generateSlug(draft.title);
    const now = new Date().toISOString();
    const hackathon: Hackathon = {
      id,
      slug,
      title: draft.title,
      description: draft.description,
      hackathonType: draft.hackathonType,
      objective: draft.objective,
      audience: draft.audience,
      duration: draft.duration,
      mode: draft.mode,
      themeIds: [],
      problemStatement: draft.problemStatement,
      constraints: draft.constraints,
      resources: draft.resourcesDraft.map((r) => r.title),
      expectedOutcomes: draft.expectedOutcomes,
      judgingPreferences: draft.judgingCriteriaDraft.map((c) => c.name),
      rules: draft.rulesDraft,
      status: 'DRAFT',
      organizerId,
      version: 1,
      createdAt: now,
      updatedAt: now,
      publishedAt: null,
      archivedAt: null,
      metadata: {
        draftGeneratedAt: draft.generatedAt,
        draftGenerator: draft.generatorVersion,
        draft,
      },
    };
    memoryStore.hackathons.set(id, hackathon);
    memoryStore.hackathonBySlug.set(slug, id);

    const aiGeneratedCriteriaIds: string[] = [];
    for (const crit of draft.judgingCriteriaDraft) {
      const cid = randomUUID();
      memoryStore.evaluationCriteria.set(cid, {
        id: cid, hackathonId: id, name: crit.name, description: crit.description,
        weight: crit.weight, maxScore: 10, createdAt: now, updatedAt: now,
      });
      aiGeneratedCriteriaIds.push(cid);
    }
    const aiGeneratedPhaseIds: string[] = [];
    // No dated phases are invented here (see note above generateDraft):
    // materializeTimeline() creates them once the event window is explicit.
    if (draft.theme) {
      const existingTheme = Array.from(memoryStore.themes.values()).find((t) => t.name.toLowerCase() === draft.theme.toLowerCase());
      let themeId: string;
      if (existingTheme) themeId = existingTheme.id;
      else {
        themeId = randomUUID();
        memoryStore.themes.set(themeId, { id: themeId, name: draft.theme, description: `Theme: ${draft.theme}`, createdById: organizerId, createdAt: now });
      }
      hackathon.themeIds = [themeId];
    }
    const aiGeneratedResourceIds: string[] = [];
    for (const r of draft.resourcesDraft) {
      const rid = randomUUID();
      memoryStore.resources.set(rid, {
        id: rid, hackathonId: id, title: r.title, type: r.type, url: r.url ?? null,
        content: null, visibility: 'PUBLIC', createdAt: now, updatedAt: now,
      });
      aiGeneratedResourceIds.push(rid);
    }
    const provenance: Record<string, SectionProvenance> = {};
    for (const s of ['title', 'tagline', 'description', 'theme', 'problemStatements', 'openInnovation', 'rules', 'guidelines', 'codeOfConduct', 'timeline', 'evaluationCriteria', 'resources', 'faqs', 'prizes', 'announcement', 'eligibility', 'teamSize', 'participationInstructions']) {
      provenance[s] = 'AI_GENERATED';
    }
    hackathon.metadata = {
      ...(hackathon.metadata as Record<string, unknown>),
      sectionProvenance: provenance,
      aiGeneratedCriteriaIds,
      aiGeneratedPhaseIds,
      aiGeneratedResourceIds,
      regenCount: {},
      ...(extra.wizardInput ? { wizardInput: extra.wizardInput, wizardRequirements: (extra.wizardInput.requirements as string) ?? '', wizardEligibility: extra.wizardInput.eligibility ?? [] } : {}),
    };
    memoryStore.hackathons.set(id, hackathon);

    await auditService.log({
      actorId: organizerId, actorRole: 'ORGANIZER', action: extra.auditAction,
      resourceType: 'hackathon', resourceId: id, outcome: 'success',
      ip: opts?.ip ?? null, requestId: opts?.requestId ?? null,
      metadata: { title: draft.title, hackathonType: draft.hackathonType, generator: draft.generatorVersion },
    });
    return { hackathon, draft };
  }

  /**
   * Materialize AI-suggested phases into dated records inside an EXPLICIT
   * event window. This is the only path that turns dateless `phasesDraft`
   * suggestions into persisted `HackathonPhase` rows (single authority:
   * timeline-normalizer.ts). Refuses when phases already exist so nothing is
   * silently overwritten — delete or edit individual phases instead.
   */
  async materializeTimeline(
    hackathonId: string,
    organizerId: string,
    window: { eventStart: string; eventEnd: string },
    opts?: { ip?: string; requestId?: string },
  ): Promise<{ hackathon: Hackathon; phases: unknown[] }> {
    const hackathon = memoryStore.hackathons.get(hackathonId);
    if (!hackathon) throw Object.assign(new Error('Hackathon not found'), { statusCode: 404 });
    if (hackathon.organizerId !== organizerId) {
      const user = memoryStore.users.get(organizerId);
      if (user?.role !== 'ADMIN') throw Object.assign(new Error('Not owner'), { statusCode: 403 });
    }
    if (!['DRAFT', 'REVIEW'].includes(hackathon.status)) {
      throw Object.assign(new Error(`Cannot edit timeline in status ${hackathon.status}. Only DRAFT/REVIEW editable.`), { statusCode: 400 });
    }
    const existing = Array.from(memoryStore.phases.values()).filter((p) => p.hackathonId === hackathonId);
    if (existing.length > 0) {
      throw Object.assign(new Error('Timeline already has phases. Edit or delete individual phases instead.'), { statusCode: 409 });
    }
    const meta = (hackathon.metadata ?? {}) as Record<string, unknown>;
    const draft = (meta.draft ?? {}) as Record<string, unknown>;
    const specs = (draft.phasesDraft ?? []) as Array<{ name: string; order: number; description?: string | null }>;
    if (!Array.isArray(specs) || specs.length === 0) {
      throw Object.assign(new Error('No AI phase suggestions to materialize for this hackathon'), { statusCode: 400 });
    }
    let dated;
    try {
      dated = normalizeTimeline(window.eventStart, window.eventEnd, specs);
    } catch (e: any) {
      throw Object.assign(new Error(e.message), { statusCode: 400 });
    }
    const problem = verifyTimelineInWindow(window.eventStart, window.eventEnd, dated);
    if (problem) throw Object.assign(new Error(problem), { statusCode: 400 });

    const now = new Date().toISOString();
    const updated: Hackathon = {
      ...hackathon,
      eventStart: new Date(window.eventStart).toISOString(),
      eventEnd: new Date(window.eventEnd).toISOString(),
      updatedAt: now,
      version: hackathon.version + 1,
    };
    memoryStore.hackathons.set(hackathonId, updated);
    const phases: HackathonPhase[] = [];
    for (const d of dated) {
      const pid = randomUUID();
      const record: HackathonPhase = {
        id: pid,
        hackathonId,
        name: d.name as HackathonPhase['name'],
        order: d.order,
        startsAt: d.startsAt,
        endsAt: d.endsAt,
        description: d.description ?? null,
        status: 'UPCOMING',
        createdAt: now,
        updatedAt: now,
      };
      memoryStore.phases.set(pid, record);
      phases.push(record);
      await auditService.log({
        actorId: organizerId,
        actorRole: 'ORGANIZER',
        action: 'phase.created',
        resourceType: 'phase',
        resourceId: pid,
        outcome: 'success',
        ip: opts?.ip ?? null,
        requestId: opts?.requestId ?? null,
        metadata: { hackathonId, name: d.name, order: d.order },
      });
    }
    await auditService.log({
      actorId: organizerId,
      actorRole: 'ORGANIZER',
      action: 'hackathon.timeline_materialized',
      resourceType: 'hackathon',
      resourceId: hackathonId,
      outcome: 'success',
      ip: opts?.ip ?? null,
      requestId: opts?.requestId ?? null,
      metadata: { phaseCount: phases.length, eventStart: updated.eventStart, eventEnd: updated.eventEnd },
    });
    return { hackathon: updated, phases };
  }
  async regenerateSection(
    id: string, organizerId: string, section: RegenerableSection, instruction: string | null | undefined,
    opts?: { ip?: string; requestId?: string },
  ): Promise<{ hackathon: Hackathon; section: RegenerableSection; provenance: SectionProvenance }> {
    const hackathon = memoryStore.hackathons.get(id);
    if (!hackathon) throw Object.assign(new Error('Hackathon not found'), { statusCode: 404 });
    if (hackathon.organizerId !== organizerId) {
      const user = memoryStore.users.get(organizerId);
      if (user?.role !== 'ADMIN') throw Object.assign(new Error('Not owner'), { statusCode: 403 });
    }
    if (!['DRAFT', 'REVIEW'].includes(hackathon.status)) {
      throw Object.assign(new Error(`Cannot regenerate sections in status ${hackathon.status}. Only DRAFT/REVIEW.`), { statusCode: 400 });
    }
    const meta = (hackathon.metadata ?? {}) as Record<string, unknown>;
    const regenCount = (meta.regenCount ?? {}) as Record<string, number>;
    const variant = (regenCount[section] ?? 0) + 1;
    const requirements = [((meta.wizardRequirements as string) ?? ''), (instruction?.trim() ?? '')].filter(Boolean).join('\n').slice(0, 1500);
    const eligibility = (meta.wizardEligibility as string[] | undefined) ?? [hackathon.audience];
    const rebuilt = rebuildSection(
      section,
      { about: hackathon.objective || hackathon.description, audience: hackathon.audience, mode: hackathon.mode, hackathonType: hackathon.hackathonType, duration: hackathon.duration, requirements, eligibility },
      variant,
    );

    const now = new Date().toISOString();
    const draft = { ...((meta.draft ?? {}) as Record<string, unknown>) };
    const applyScalar = (key: string, value: unknown) => { (draft as Record<string, unknown>)[key] = value; };

    if (section === 'evaluationCriteria') {
      const tracked = (meta.aiGeneratedCriteriaIds as string[] | undefined) ?? [];
      if (!tracked.length) throw Object.assign(new Error('No AI-generated criteria to regenerate. Add criteria manually.'), { statusCode: 400 });
      const items = rebuilt as Array<{ name: string; description: string; weight: number }>;
      const parsed = wizardDraftSchema.shape.evaluationCriteria.safeParse(items);
      if (!parsed.success || !parsed.data || !parsed.data.length) throw Object.assign(new Error('AI returned invalid criteria section'), { statusCode: 502 });
      for (const cid of tracked) memoryStore.evaluationCriteria.delete(cid);
      const nextIds: string[] = [];
      for (const c of parsed.data) {
        const cid = randomUUID();
        memoryStore.evaluationCriteria.set(cid, { id: cid, hackathonId: id, name: c.name, description: c.description, weight: c.weight, maxScore: 10, createdAt: now, updatedAt: now });
        nextIds.push(cid);
      }
      hackathon.judgingPreferences = parsed.data.map((c) => c.name);
      applyScalar('evaluationCriteria', parsed.data);
      meta.aiGeneratedCriteriaIds = nextIds;
    } else if (section === 'timeline') {
      const tracked = (meta.aiGeneratedPhaseIds as string[] | undefined) ?? [];
      if (!tracked.length) throw Object.assign(new Error('No AI-generated phases to regenerate. Add phases manually.'), { statusCode: 400 });
      const items = (rebuilt as Array<{ name: string; order: number; description: string }>);
      tracked.forEach((pid, idx) => {
        const existing = memoryStore.phases.get(pid);
        const src = items[idx % items.length];
        if (existing && src) {
          memoryStore.phases.set(pid, { ...existing, name: src.name, order: src.order, updatedAt: now });
        }
      });
      applyScalar('timeline', items);
    } else if (section === 'resources') {
      const tracked = (meta.aiGeneratedResourceIds as string[] | undefined) ?? [];
      if (!tracked.length) throw Object.assign(new Error('No AI-generated resources to regenerate. Add resources manually.'), { statusCode: 400 });
      const items = rebuilt as Array<{ title: string; type: string; url?: string }>;
      for (const rid of tracked) memoryStore.resources.delete(rid);
      const nextIds: string[] = [];
      for (const r of items) {
        const rid2 = randomUUID();
        memoryStore.resources.set(rid2, { id: rid2, hackathonId: id, title: r.title, type: r.type as never, url: r.url ?? null, content: null, visibility: 'PUBLIC', createdAt: now, updatedAt: now });
        nextIds.push(rid2);
      }
      hackathon.resources = items.map((r) => r.title);
      applyScalar('resources', items);
      meta.aiGeneratedResourceIds = nextIds;
    } else if (section === 'title') {
      const value = String(rebuilt as string).slice(0, 160);
      if (!value.trim()) throw Object.assign(new Error('AI returned invalid title section'), { statusCode: 502 });
      hackathon.title = value;
      applyScalar('title', value);
    } else if (section === 'description') {
      const value = String(rebuilt as string);
      if (!value.trim()) throw Object.assign(new Error('AI returned invalid description section'), { statusCode: 502 });
      hackathon.description = value.slice(0, 8000);
      applyScalar('description', hackathon.description);
    } else if (section === 'theme') {
      const value = String(rebuilt as string).slice(0, 160);
      applyScalar('theme', value);
      if (value.trim()) {
        const found = Array.from(memoryStore.themes.values()).find((t) => t.name.toLowerCase() === value.toLowerCase());
        let themeId: string;
        if (found) themeId = found.id;
        else {
          themeId = randomUUID();
          memoryStore.themes.set(themeId, { id: themeId, name: value, description: `Theme: ${value}`, createdById: organizerId, createdAt: now });
        }
        hackathon.themeIds = [themeId];
      }
    } else if (section === 'rules') {
      const value = rebuilt as string[];
      if (!Array.isArray(value) || !value.length) throw Object.assign(new Error('AI returned invalid rules section'), { statusCode: 502 });
      hackathon.rules = value;
      hackathon.constraints = value.slice(0, 8);
      applyScalar('rules', value);
    } else if (section === 'problemStatements') {
      const value = rebuilt as string[];
      hackathon.problemStatement = value[0] ?? null;
      applyScalar('problemStatements', value);
      applyScalar('problemStatement', hackathon.problemStatement);
    } else {
      // Draft-preview sections (tagline, openInnovation, guidelines, codeOfConduct, faqs,
      // prizes, announcement, eligibility, teamSize, participationInstructions).
      applyScalar(section, rebuilt);
      if (section === 'eligibility' && Array.isArray(rebuilt)) {
        meta.wizardEligibility = rebuilt;
      }
    }

    const provenance = { ...((meta.sectionProvenance ?? {}) as Record<string, SectionProvenance>) };
    provenance[section] = 'AI_REGENERATED';
    hackathon.updatedAt = now;
    hackathon.version += 1;
    hackathon.metadata = { ...meta, draft, sectionProvenance: provenance, regenCount: { ...regenCount, [section]: variant } };
    memoryStore.hackathons.set(id, hackathon);

    await auditService.log({
      actorId: organizerId, actorRole: 'ORGANIZER', action: 'hackathon.section_regenerated',
      resourceType: 'hackathon', resourceId: id, outcome: 'success',
      ip: opts?.ip ?? null, requestId: opts?.requestId ?? null,
      // Never log instruction content or prompts — section name + variant only.
      metadata: { section, variant },
    });
    return { hackathon, section, provenance: 'AI_REGENERATED' };
  }

  // Direct creation without AI (for problem-statement based / open innovation manual)
  async createManual(data: Partial<Hackathon> & { title: string; organizerId: string }, opts?: { ip?: string; requestId?: string }): Promise<Hackathon> {
    const id = randomUUID();
    const slug = memoryStore.generateSlug(data.title);
    const now = new Date().toISOString();
    const hackathon: Hackathon = {
      id,
      slug,
      title: data.title,
      description: data.description ?? '',
      hackathonType: (data.hackathonType as any) ?? 'OPEN_INNOVATION',
      objective: data.objective ?? '',
      audience: data.audience ?? 'General',
      duration: data.duration ?? '3 days',
      mode: (data.mode as any) ?? 'ONLINE',
      themeIds: data.themeIds ?? [],
      problemStatement: data.problemStatement ?? null,
      constraints: data.constraints ?? [],
      resources: data.resources ?? [],
      expectedOutcomes: data.expectedOutcomes ?? [],
      judgingPreferences: data.judgingPreferences ?? [],
      rules: data.rules ?? [],
      status: 'DRAFT',
      organizerId: data.organizerId,
      version: 1,
      createdAt: now,
      updatedAt: now,
      publishedAt: null,
      archivedAt: null,
      // Explicit event/registration windows persist when supplied (PATCH can
      // set them later; timeline enforcement keys off these when present).
      registrationStart: data.registrationStart ?? null,
      registrationEnd: data.registrationEnd ?? null,
      eventStart: data.eventStart ?? null,
      eventEnd: data.eventEnd ?? null,
      metadata: data.metadata ?? null,
    };
    memoryStore.hackathons.set(id, hackathon);
    memoryStore.hackathonBySlug.set(slug, id);
    await auditService.log({
      actorId: data.organizerId,
      actorRole: 'ORGANIZER',
      action: 'hackathon.created',
      resourceType: 'hackathon',
      resourceId: id,
      outcome: 'success',
      ip: opts?.ip ?? null,
      requestId: opts?.requestId ?? null,
      metadata: { title: data.title },
    });
    return hackathon;
  }

  async getById(id: string): Promise<Hackathon | null> {
    return memoryStore.hackathons.get(id) ?? null;
  }

  async listByOrganizer(organizerId: string): Promise<Hackathon[]> {
    return Array.from(memoryStore.hackathons.values()).filter((h) => h.organizerId === organizerId);
  }

  async listAll(): Promise<Hackathon[]> {
    return Array.from(memoryStore.hackathons.values());
  }

  async update(id: string, organizerId: string, updates: Partial<Hackathon>, opts?: { ip?: string; requestId?: string }): Promise<Hackathon> {
    const hackathon = memoryStore.hackathons.get(id);
    if (!hackathon) throw Object.assign(new Error('Hackathon not found'), { statusCode: 404 });
    if (hackathon.organizerId !== organizerId) {
      const user = memoryStore.users.get(organizerId);
      if (user?.role !== 'ADMIN') throw Object.assign(new Error('Not owner'), { statusCode: 403 });
    }
    // Only allow edits in DRAFT / REVIEW
    if (!['DRAFT', 'REVIEW'].includes(hackathon.status)) {
      throw Object.assign(new Error(`Cannot edit hackathon in status ${hackathon.status}. Only DRAFT/REVIEW editable.`), { statusCode: 400 });
    }
    // Validate Step 8 participation config (merged over stored config for partial PATCH).
    if ((updates as any).participation !== undefined && (updates as any).participation !== null) {
      const prevMeta = (hackathon.metadata ?? {}) as Record<string, unknown>;
      const prevDraft = (prevMeta.draft ?? {}) as Record<string, unknown>;
      const merged = { ...((prevDraft.participation ?? {}) as Record<string, unknown>), ...((updates as any).participation as Record<string, unknown>) };
      const problem = validateParticipationConfig(merged);
      if (problem) throw Object.assign(new Error(problem), { statusCode: 400 });
    }

    // Validate timeline if phases being updated externally - not here, handled via timeline service
    // Apply updates (prevent status direct manipulation via update)
    const { status: _s, id: _id, organizerId: _o, slug: _slug, version: _v, createdAt: _c, ...safeUpdates } = updates as any;
    // Extended wizard sections live in metadata.draft (organizer edits override AI content).
    const extendedUpdates: Record<string, unknown> = {};
    for (const key of EXTENDED_DRAFT_KEYS) {
      if (safeUpdates[key] !== undefined) {
        extendedUpdates[key] = safeUpdates[key];
        delete safeUpdates[key];
      }
    }
    const prevMeta = (hackathon.metadata ?? {}) as Record<string, unknown>;
    const prevDraft = (prevMeta.draft ?? {}) as Record<string, unknown>;
    const prevProvenance = (prevMeta.sectionProvenance ?? {}) as Record<string, SectionProvenance>;
    const nextProvenance: Record<string, SectionProvenance> = { ...prevProvenance };
    // Organizer scalar edits override AI content — track per-section provenance.
    for (const field of Object.keys(safeUpdates)) {
      const section = PROVENANCE_FIELD_MAP[field];
      if (section) nextProvenance[section] = 'ORGANIZER_EDITED';
    }
    for (const key of Object.keys(extendedUpdates)) nextProvenance[key] = 'ORGANIZER_EDITED';
    const updated: Hackathon = {
      ...hackathon,
      ...safeUpdates,
      updatedAt: new Date().toISOString(),
      version: hackathon.version + 1,
      metadata: {
        ...prevMeta,
        draft: { ...prevDraft, ...extendedUpdates },
        sectionProvenance: nextProvenance,
      },
    };

    // If title changed, regenerate slug? Keep original slug stable after creation; only update if explicitly allowed
    // We keep slug immutable for published contract stability

    memoryStore.hackathons.set(id, updated);
    await auditService.log({
      actorId: organizerId,
      actorRole: 'ORGANIZER',
      action: 'hackathon.edited',
      resourceType: 'hackathon',
      resourceId: id,
      outcome: 'success',
      ip: opts?.ip ?? null,
      requestId: opts?.requestId ?? null,
      metadata: { updatedFields: Object.keys(safeUpdates) },
    });
    return updated;
  }

  // State machine transitions
  async transition(id: string, organizerId: string, target: HackathonStatus, opts?: { ip?: string; requestId?: string }): Promise<Hackathon> {
    const hackathon = memoryStore.hackathons.get(id);
    if (!hackathon) throw Object.assign(new Error('Hackathon not found'), { statusCode: 404 });

    if (hackathon.organizerId !== organizerId) {
      const user = memoryStore.users.get(organizerId);
      if (user?.role !== 'ADMIN') throw Object.assign(new Error('Not owner'), { statusCode: 403 });
    }

    // Enforce explicit states and prevent direct AI -> PUBLISHED
    if (!memoryStore.canTransition(hackathon.status, target)) {
      throw Object.assign(
        new Error(`Invalid transition ${hackathon.status} -> ${target}. Allowed: ${this.allowedTransitions(hackathon.status).join(', ') || 'none'}`),
        { statusCode: 400 },
      );
    }

    // Validation before CONFIRMED and PUBLISHED
    if (target === 'CONFIRMED') {
      const validation = await this.validateForConfirm(hackathon);
      if (!validation.valid) throw Object.assign(new Error(`Validation failed for CONFIRMED: ${validation.error}`), { statusCode: 400 });
    }
    if (target === 'PUBLISHED') {
      const validation = await this.validateForPublish(hackathon);
      if (!validation.valid) throw Object.assign(new Error(`Validation failed for PUBLISHED: ${validation.error}`), { statusCode: 400 });
    }

    // Prevent direct AI->PUBLISHED: ensure hackathon has gone through REVIEW and CONFIRMED
    // Our state machine already ensures DRAFT->REVIEW->CONFIRMED->PUBLISHED, so AI draft (DRAFT) cannot jump to PUBLISHED

    const updated: Hackathon = {
      ...hackathon,
      status: target,
      updatedAt: new Date().toISOString(),
      version: hackathon.version + 1,
      publishedAt: target === 'PUBLISHED' ? new Date().toISOString() : hackathon.publishedAt,
      archivedAt: target === 'ARCHIVED' ? new Date().toISOString() : hackathon.archivedAt,
    };
    memoryStore.hackathons.set(id, updated);

    const actionMap: Record<HackathonStatus, string> = {
      DRAFT: 'hackathon.draft',
      REVIEW: 'hackathon.review',
      CONFIRMED: 'hackathon.confirmed',
      PUBLISHED: 'hackathon.published',
      ARCHIVED: 'hackathon.archived',
    };
    await auditService.log({
      actorId: organizerId,
      actorRole: 'ORGANIZER',
      action: actionMap[target] ?? `hackathon.${target.toLowerCase()}`,
      resourceType: 'hackathon',
      resourceId: id,
      outcome: 'success',
      ip: opts?.ip ?? null,
      requestId: opts?.requestId ?? null,
      metadata: { from: hackathon.status, to: target, version: updated.version },
    });

    // If PUBLISHED, generate versioned HackathonPublished event/contract
    if (target === 'PUBLISHED') {
      const event = await this.generatePublishedEvent(updated, organizerId);
      updated.metadata = { ...(updated.metadata ?? {}), lastPublishedEventId: event.eventId };
      memoryStore.hackathons.set(id, updated);
      // Best-effort push to the participant read-model; never fails the transition.
      void this.pushToParticipant('/sync/consume', 'POST', event)
        .then((delivered) => (delivered && updated.ideation ? this.pushIdeation(id, updated.ideation) : false))
        .catch(() => undefined);
    }

    // If ARCHIVED, emit + push HackathonArchived so participant discovery
    // drops it from active views (terminal state, same channel as publish).
    if (target === 'ARCHIVED') {
      const event = await this.generateArchivedEvent(updated, organizerId);
      void this.pushToParticipant('/sync/consume', 'POST', event).catch(() => undefined);
    }

    return updated;
  }

  async getIdeation(id: string, userId: string): Promise<IdeationConfig> {
    return this.requireOwnedHackathon(id, userId).ideation ?? defaultIdeationConfig();
  }

  async updateIdeation(id: string, userId: string, ideation: IdeationConfig, opts?: { ip?: string; requestId?: string }): Promise<IdeationConfig> {
    const hackathon = this.requireOwnedHackathon(id, userId);
    if (hackathon.status === 'ARCHIVED') throw Object.assign(new Error('Archived hackathons are read-only'), { statusCode: 400 });
    const previousRound = hackathon.ideation?.currentRound ?? 1;
    memoryStore.hackathons.set(id, { ...hackathon, ideation, updatedAt: new Date().toISOString() });
    await auditService.log({
      actorId: userId,
      actorRole: 'ORGANIZER',
      action: 'hackathon.ideation_updated',
      resourceType: 'hackathon',
      resourceId: id,
      outcome: 'success',
      ip: opts?.ip ?? null,
      requestId: opts?.requestId ?? null,
      metadata: { fromRound: previousRound, toRound: ideation.currentRound },
    });
    if (hackathon.status === 'PUBLISHED' && !(await this.pushIdeation(id, ideation))) {
      throw Object.assign(new Error('Saved, but the participant app did not receive the update. Retry to sync.'), { statusCode: 502 });
    }
    return ideation;
  }

  private pushIdeation(id: string, ideation: IdeationConfig): Promise<boolean> {
    return this.pushToParticipant(`/sync/ideation/${encodeURIComponent(id)}`, 'PUT', ideation);
  }

  private requireOwnedHackathon(id: string, userId: string): Hackathon {
    const hackathon = memoryStore.hackathons.get(id);
    if (!hackathon) throw Object.assign(new Error('Hackathon not found'), { statusCode: 404 });
    if (hackathon.organizerId !== userId && memoryStore.users.get(userId)?.role !== 'ADMIN') {
      throw Object.assign(new Error('Not owner'), { statusCode: 403 });
    }
    return hackathon;
  }

  private async pushToParticipant(path: string, method: 'POST' | 'PUT', body: object): Promise<boolean> {
    let base = '';
    let secret = '';
    try {
      base = (loadBaseEnv().PARTICIPANT_API_URL ?? '').replace(/\/$/, '');
      secret = resolveSyncSecret();
    } catch {
      return false;
    }
    if (!base || !secret) return false;
    const resourceId = 'eventId' in body ? String(body.eventId) : path;
    const type = 'type' in body ? String(body.type) : path;
    try {
      const res = await fetch(`${base}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', 'x-sync-secret': secret },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) return true;
      await auditService.log({
        actorId: null,
        actorRole: null,
        action: 'hackathon.sync_push_failed',
        resourceType: 'sync',
        resourceId,
        outcome: 'failure',
        metadata: { type, status: res.status },
      });
    } catch {
      await auditService.log({
        actorId: null,
        actorRole: null,
        action: 'hackathon.sync_push_failed',
        resourceType: 'sync',
        resourceId,
        outcome: 'failure',
        metadata: { type },
      });
    }
    return false;
  }

  private async generateArchivedEvent(
    hackathon: Hackathon,
    actorId: string,
  ): Promise<{ eventId: string; version: 'v1'; type: 'HackathonArchived'; occurredAt: string; actorId: string | null; payload: { hackathonId: string; archivedAt: string } }> {
    const event = {
      eventId: randomUUID(),
      version: 'v1' as const,
      type: 'HackathonArchived' as const,
      occurredAt: new Date().toISOString(),
      actorId,
      payload: {
        hackathonId: hackathon.id,
        archivedAt: hackathon.archivedAt ?? new Date().toISOString(),
      },
    };
    memoryStore.outbox.push({
      eventId: event.eventId,
      type: event.type,
      hackathonId: hackathon.id,
      occurredAt: event.occurredAt,
      payload: event.payload,
    });
    await auditService.log({
      actorId,
      actorRole: 'ORGANIZER',
      action: 'hackathon.archived_event_generated',
      resourceType: 'hackathon',
      resourceId: hackathon.id,
      outcome: 'success',
      metadata: { eventId: event.eventId, version: event.version, type: event.type },
    });
    return event;
  }

  private allowedTransitions(from: HackathonStatus): HackathonStatus[] {
    // Archive is terminal and reachable ONLY from PUBLISHED. Non-published
    // states can never archive directly (prevents accidental archival).
    const map: Record<HackathonStatus, HackathonStatus[]> = {
      DRAFT: ['REVIEW'],
      REVIEW: ['DRAFT', 'CONFIRMED'],
      CONFIRMED: ['PUBLISHED', 'REVIEW'],
      PUBLISHED: ['ARCHIVED'],
      ARCHIVED: [],
    };
    return map[from] ?? [];
  }

  private async validateForConfirm(hackathon: Hackathon): Promise<{ valid: boolean; error?: string }> {
    if (!hackathon.title?.trim()) return { valid: false, error: 'title is required' };
    if (!hackathon.description?.trim()) return { valid: false, error: 'description is required' };
    if (hackathon.hackathonType === 'PROBLEM_STATEMENT_BASED' && !hackathon.problemStatement?.trim()) {
      return { valid: false, error: 'problemStatement required for PROBLEM_STATEMENT_BASED' };
    }
    // Ensure at least one evaluation criteria
    const criteria = Array.from(memoryStore.evaluationCriteria.values()).filter((c) => c.hackathonId === hackathon.id);
    if (criteria.length === 0) return { valid: false, error: 'At least one evaluation criteria required' };
    // Weights must total exactly 100% before confirmation (epsilon for float math).
    const weightSum = criteria.reduce((s, c) => s + (Number(c.weight) || 0), 0);
    if (Math.abs(weightSum - 1) > 0.001) {
      return { valid: false, error: `Evaluation weights must total 100% (currently ${Math.round(weightSum * 100)}%)` };
    }
    // Ensure timeline valid
    const phases = Array.from(memoryStore.phases.values()).filter((p) => p.hackathonId === hackathon.id);
    if (phases.length === 0) return { valid: false, error: 'At least one phase required' };
    const validation = memoryStore.validateTimeline(phases.map((p) => ({ startsAt: p.startsAt, endsAt: p.endsAt, order: p.order })));
    if (!validation.valid) return { valid: false, error: validation.error };
    // When an explicit event window is configured, every phase must fit inside it.
    if (hackathon.eventStart && hackathon.eventEnd) {
      const problem = verifyTimelineInWindow(hackathon.eventStart, hackathon.eventEnd, phases);
      if (problem) return { valid: false, error: problem };
    }
    return { valid: true };
  }

  private async validateForPublish(hackathon: Hackathon): Promise<{ valid: boolean; error?: string }> {
    // Must be CONFIRMED before publish (enforced by state machine)
    // Re-run confirm validation
    const conf = await this.validateForConfirm(hackathon);
    if (!conf.valid) return conf;
    // Additional publish validation: ensure phases have valid times, resources etc.
    return { valid: true };
  }

  private async generatePublishedEvent(hackathon: Hackathon, actorId: string): Promise<HackathonPublishedEvent> {
    const phases = Array.from(memoryStore.phases.values())
      .filter((p) => p.hackathonId === hackathon.id)
      .sort((a, b) => a.order - b.order)
      .map((p) => ({ phaseId: p.id, name: p.name, startsAt: p.startsAt, endsAt: p.endsAt, order: p.order, status: p.status }));
    const criteria = Array.from(memoryStore.evaluationCriteria.values())
      .filter((c) => c.hackathonId === hackathon.id)
      .map((c) => ({ id: c.id, name: c.name, weight: c.weight, maxScore: c.maxScore }));
    const resources = Array.from(memoryStore.resources.values())
      .filter((r) => r.hackathonId === hackathon.id)
      // Only PUBLIC and PARTICIPANT visible resources go to participant contract? For sync we include all but visibility flag controls consumption
      .map((r) => ({ id: r.id, title: r.title, type: r.type, url: r.url ?? null, visibility: r.visibility }));
    const themeNames = hackathon.themeIds.map((tid) => memoryStore.themes.get(tid)?.name ?? null).filter(Boolean).join(', ');

    // Derive event windows from explicit fields, falling back to phase extremes.
    const sortedByStart = [...phases].sort(
      (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
    );
    const sortedByEnd = [...phases].sort(
      (a, b) => new Date(a.endsAt).getTime() - new Date(b.endsAt).getTime(),
    );
    const meta = (hackathon.metadata ?? {}) as Record<string, unknown>;
    const draft = (meta.draft ?? {}) as Record<string, unknown>;
    const eligibility =
      hackathon.eligibility ??
      (Array.isArray(draft.eligibility) ? (draft.eligibility as string[]) : undefined) ??
      (hackathon.audience ? [hackathon.audience] : undefined);
    const teamSize =
      hackathon.teamSize ??
      ((draft.teamSize as { min: number; max: number; recommended?: number } | undefined) ?? undefined);

    const event: HackathonPublishedEvent = {
      eventId: randomUUID(),
      version: 'v1',
      type: 'HackathonPublished',
      occurredAt: new Date().toISOString(),
      actorId,
      payload: {
        hackathonId: hackathon.id,
        slug: hackathon.slug,
        title: hackathon.title,
        description: hackathon.description,
        hackathonType: hackathon.hackathonType,
        objective: hackathon.objective,
        audience: hackathon.audience,
        mode: hackathon.mode,
        themeIds: hackathon.themeIds,
        problemStatement: hackathon.problemStatement ?? null,
        constraints: hackathon.constraints,
        expectedOutcomes: hackathon.expectedOutcomes,
        rules: hackathon.rules,
        resources,
        phases: phases.map((p) => ({ phaseId: p.phaseId, name: p.name, startsAt: p.startsAt, endsAt: p.endsAt, order: (p as unknown as { order: number }).order ?? 0 })),
        judgingCriteria: criteria,
        theme: themeNames || null,
        announcements: [],
        publishedAt: hackathon.publishedAt ?? new Date().toISOString(),
        hackathonVersion: hackathon.version,
        registrationStart: hackathon.registrationStart ?? sortedByStart[0]?.startsAt ?? null,
        registrationEnd:
          hackathon.registrationEnd ??
          sortedByStart.find((p) => p.name === 'registration')?.endsAt ??
          sortedByStart[0]?.endsAt ??
          null,
        eventStart: hackathon.eventStart ?? sortedByStart[0]?.startsAt ?? null,
        eventEnd: hackathon.eventEnd ?? sortedByEnd[sortedByEnd.length - 1]?.endsAt ?? null,
        eligibility,
        teamSize: teamSize ?? undefined,
        category: hackathon.category ?? (themeNames || undefined),
        tags: hackathon.tags ?? hackathon.themeIds,
        organizerName: hackathon.organizerName ?? undefined,
        // Repository requirement travels with the publish event so the
        // participant read-model enforces the same rule. Absent on old
        // events → participant defaults to OPTIONAL.
        repoRequirement: normalizeRepoRequirement(
          ((draft.participation ?? {}) as Record<string, unknown>).repoRequirement,
        ),
      },
    };
    memoryStore.publishedEvents.set(hackathon.id, event);
    memoryStore.publishedEventsById.set(event.eventId, event);
    // Canonical outbox append — participant consumer drains via /sync/published or /sync/outbox.
    memoryStore.outbox.push({
      eventId: event.eventId,
      type: event.type,
      hackathonId: hackathon.id,
      occurredAt: event.occurredAt,
      payload: event.payload,
    });

    await auditService.log({
      actorId,
      actorRole: 'ORGANIZER',
      action: 'hackathon.publish_event_generated',
      resourceType: 'hackathon',
      resourceId: hackathon.id,
      outcome: 'success',
      metadata: { eventId: event.eventId, version: event.version, type: event.type },
    });

    return event;
  }

  async getPublishedEvent(hackathonId: string): Promise<HackathonPublishedEvent | null> {
    return memoryStore.publishedEvents.get(hackathonId) ?? null;
  }

  async listPublishedEvents(): Promise<HackathonPublishedEvent[]> {
    return Array.from(memoryStore.publishedEvents.values());
  }

  private safeLoadEnvForAI(): { AI_PROVIDER: string; AI_API_KEY: string; AI_MODEL: string; AI_BASE_URL: string; AI_TIMEOUT_MS: number; AI_MAX_RETRIES: number } | null {
    try {
      const env = loadBaseEnv();
      return {
        AI_PROVIDER: env.AI_PROVIDER,
        AI_API_KEY: env.AI_API_KEY ?? '',
        AI_MODEL: env.AI_MODEL ?? '',
        AI_BASE_URL: env.AI_BASE_URL ?? '',
        AI_TIMEOUT_MS: env.AI_TIMEOUT_MS,
        AI_MAX_RETRIES: env.AI_MAX_RETRIES,
      };
    } catch {
      return null;
    }
  }
}

export const hackathonService = new HackathonService();
