import { z } from 'zod';

export const AiTaskTypeValues = [
  'ORGANIZER_DRAFT',
  'PARTICIPANT_ANALYSIS',
  'CODE_ANALYSIS',
  'IMPROVEMENT_SUGGESTION',
  'TEAMMATE_ADVICE',
  'POST_HACKATHON_ROADMAP',
] as const;
export type AiTaskType = (typeof AiTaskTypeValues)[number];

export const AiProviderNameValues = ['mock', 'external'] as const;
export type AiProviderName = (typeof AiProviderNameValues)[number];

export interface AiGenerateTextOptions {
  taskType: AiTaskType;
  prompt: string;
  systemPrompt?: string | undefined;
  maxTokens?: number | undefined;
  temperature?: number | undefined;
  requestId?: string | undefined;
  userId?: string | undefined;
  teamId?: string | undefined;
  hackathonId?: string | undefined;
}

export interface AiGenerateTextResult {
  text: string;
  provider: AiProviderName;
  model: string;
  latencyMs: number;
  requestId: string;
  tokenUsage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
  isMock: boolean;
  rawResponse?: unknown;
}

export interface AiAnalyzeOptions extends AiGenerateTextOptions {
  // for repository analysis, sanitized context
  repositoryContext?: {
    repoUrl?: string | null | undefined;
    findingsSummary?: Array<{ title: string; severity: string; category: string }> | undefined;
  } | undefined;
  hackathonContext?: {
    problemStatement?: string | null | undefined;
    theme?: string | null | undefined;
    rules?: string[] | undefined;
    evaluationCriteria?: Array<{ name: string; weight: number }> | undefined;
  } | undefined;
  // Targeted retrieval — never entire repo
  relevantFiles?: Array<{ path: string; content: string; retrievalReason: string }> | undefined;
  readmeContext?: string | null | undefined;
  analysisScope?: 'TARGETED' | undefined;
}

export interface AiAnalyzeResult extends AiGenerateTextResult {
  // structured hints, never full code
  analysis: {
    problem: string;
    evidence: string;
    hint: string;
    suggestions?: string[];
  }[];
}

export const aiConfigSchema = z.object({
  provider: z.enum(AiProviderNameValues).default('mock'),
  apiKey: z.string().optional().default(''),
  model: z.string().optional().default(''),
  baseUrl: z.string().url().optional().or(z.literal('')).default(''),
  timeoutMs: z.coerce.number().int().min(1000).max(120000).default(15000),
  maxRetries: z.coerce.number().int().min(0).max(3).default(1),
});

export type AiConfig = z.infer<typeof aiConfigSchema>;

export function sanitizeForLog(input: string): string {
  if (!input) return '';
  const redacted = input
    .replace(/AKIA[0-9A-Z]{16}/g, '[REDACTED_AWS_KEY]')
    .replace(/-----BEGIN (?:RSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA )?PRIVATE KEY-----/g, '[REDACTED_PRIVATE_KEY]')
    .replace(/postgres:\/\/[^:]+:[^@]+@/gi, 'postgres://[REDACTED]@')
    .replace(/sk-[a-zA-Z0-9_\-]{10,}/g, '[REDACTED_API_KEY]')
    .replace(/ghp_[a-zA-Z0-9]{30,}/g, '[REDACTED_GH_TOKEN]')
    .replace(/gho_[a-zA-Z0-9_-]{30,}/g, '[REDACTED_GH_TOKEN]')
    .replace(/mock_github_token_[a-zA-Z0-9_-]+/g, '[REDACTED_GH_TOKEN]')
    .replace(/github_pat_[a-zA-Z0-9_]{80,}/g, '[REDACTED_GH_TOKEN]')
    .replace(/Bearer\s+[a-zA-Z0-9._-]{20,}/g, 'Bearer [REDACTED]')
    .replace(/(api[_-]?key|secret|token)\s*[:=]\s*['"][^'"]+['"]/gi, '$1=[REDACTED]');
  return redacted.slice(0, 2000);
}

export interface AiInteractionLog {
  interactionId: string;
  timestamp: string;
  taskType: AiTaskType;
  provider: AiProviderName;
  model: string;
  userId?: string | null;
  teamId?: string | null;
  hackathonId?: string | null;
  requestId: string;
  sanitizedInputMetadata: {
    promptLength: number;
    promptPreview: string; // truncated, redacted
    systemPromptPreview?: string;
  };
  responseMetadata: {
    responseLength: number;
    responsePreview: string; // truncated, redacted
    latencyMs: number;
    success: boolean;
    errorCode?: string;
    tokenUsage?: AiGenerateTextResult['tokenUsage'];
  };
  userFeedback?: string | null;
}
