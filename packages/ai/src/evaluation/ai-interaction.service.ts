import { randomUUID } from 'node:crypto';
import type { AiInteractionRecord } from './ai-interaction.types';
import { sanitizeForLog } from '../ai.types';

/**
 * AI Interaction Logging — foundation, in-memory for now.
 * Important: never store private repo source, secrets, or raw sensitive data.
 * Only sanitized previews. Future consent pipeline can be added.
 */
export class AiInteractionService {
  private readonly store = new Map<string, AiInteractionRecord>();

  async logInteraction(params: {
    taskType: AiInteractionRecord['taskType'];
    provider: AiInteractionRecord['provider'];
    model: string;
    userId?: string | null;
    teamId?: string | null;
    hackathonId?: string | null;
    projectId?: string | null;
    requestId: string;
    inputPreview: string;
    responsePreview: string;
    latencyMs: number;
    success: boolean;
    errorCode?: string | null;
    tokenUsage?: AiInteractionRecord['tokenUsage'];
  }): Promise<AiInteractionRecord> {
    const record: AiInteractionRecord = {
      interactionId: randomUUID(),
      timestamp: new Date().toISOString(),
      taskType: params.taskType,
      provider: params.provider,
      model: params.model,
      userId: params.userId ?? null,
      teamId: params.teamId ?? null,
      hackathonId: params.hackathonId ?? null,
      projectId: params.projectId ?? null,
      requestId: params.requestId,
      sanitizedInputPreview: sanitizeForLog(params.inputPreview).slice(0, 500),
      responsePreview: sanitizeForLog(params.responsePreview).slice(0, 500),
      latencyMs: params.latencyMs,
      success: params.success,
      errorCode: params.errorCode ?? null,
      tokenUsage: params.tokenUsage ?? null,
      userFeedback: null,
    };
    this.store.set(record.interactionId, record);
    return record;
  }

  async addFeedback(interactionId: string, feedback: string): Promise<AiInteractionRecord | null> {
    const rec = this.store.get(interactionId) ?? null;
    if (!rec) return null;
    rec.userFeedback = feedback.slice(0, 1000);
    this.store.set(interactionId, rec);
    return rec;
  }

  async getInteraction(id: string): Promise<AiInteractionRecord | null> {
    return this.store.get(id) ?? null;
  }

  async listInteractions(filters?: { userId?: string; taskType?: string; limit?: number }): Promise<AiInteractionRecord[]> {
    let list = Array.from(this.store.values());
    if (filters?.userId) list = list.filter((r) => r.userId === filters.userId);
    if (filters?.taskType) list = list.filter((r) => r.taskType === filters.taskType);
    list.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    if (filters?.limit) list = list.slice(0, filters.limit);
    return list;
  }

  clear(): void {
    this.store.clear();
  }
}

export const aiInteractionService = new AiInteractionService();
