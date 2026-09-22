import type { AiTaskType, AiProviderName } from '../ai.types';

export interface AiInteractionRecord {
  interactionId: string;
  timestamp: string;
  taskType: AiTaskType;
  provider: AiProviderName;
  model: string;
  userId?: string | null;
  teamId?: string | null;
  hackathonId?: string | null;
  projectId?: string | null;
  requestId: string;
  sanitizedInputPreview: string; // redacted, truncated
  responsePreview: string; // redacted, truncated
  latencyMs: number;
  success: boolean;
  errorCode?: string | null;
  tokenUsage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number } | null;
  userFeedback?: string | null;
}
