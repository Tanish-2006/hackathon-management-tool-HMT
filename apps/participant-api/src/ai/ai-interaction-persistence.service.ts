import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { sanitizeForLog } from '@hmt/ai';

export interface PersistedAIInteraction {
  userId: string | null;
  teamId: string | null;
  projectId: string | null;
  question: string;
  sanitizedRetrievalMetadata: Record<string, unknown>;
  analysisScope: string;
  model: string | null;
  provider: string | null;
  resultMetadata: Record<string, unknown> | null;
  latencyMs: number;
  success: boolean;
  errorCode: string | null;
}

/**
 * AIInteractionPersistenceService — PostgreSQL durable storage for AI interactions.
 * - Persists sanitized metadata only (no raw secrets, no tokens, no entire repository)
 * - Fields: user/team/project ref, question, sanitized retrieval metadata, analysisScope, model/provider, result metadata, timestamps
 * - Sanitization: redact secrets before write, drop tokens
 */
@Injectable()
export class AIInteractionPersistenceService {
  private readonly logger = new Logger(AIInteractionPersistenceService.name);

  constructor(private readonly prisma: PrismaService) {}

  private sanitize(value: string): string {
    return sanitizeForLog(value);
  }

  async persist(params: {
    userId?: string | null;
    teamId?: string | null;
    projectId?: string | null;
    question: string;
    retrievalMeta: {
      readmeContextPreview?: string | null;
      relevantFilesMeta: Array<{ path: string; retrievalReason: string; sizeChars: number }>;
      retrievalReason: string;
      budgetUsed: { filesRetrieved: number; rounds: number; totalChars: number };
      hadRepositoryAccess: boolean;
    };
    analysisScope: string;
    model?: string | null;
    provider?: string | null;
    resultMetadata?: Record<string, unknown> | null;
    latencyMs: number;
    success: boolean;
    errorCode?: string | null;
  }): Promise<any> {
    // Build sanitized retrieval metadata — never store raw file contents beyond preview
    const sanitizedRetrievalMetadata: Record<string, unknown> = {
      readmeContextPreview: params.retrievalMeta.readmeContextPreview
        ? this.sanitize(params.retrievalMeta.readmeContextPreview).slice(0, 500)
        : null,
      relevantFilesMeta: params.retrievalMeta.relevantFilesMeta.map((f) => ({
        path: f.path,
        retrievalReason: this.sanitize(f.retrievalReason).slice(0, 200),
        sizeChars: f.sizeChars,
      })),
      retrievalReason: this.sanitize(params.retrievalMeta.retrievalReason).slice(0, 300),
      budgetUsed: params.retrievalMeta.budgetUsed,
      hadRepositoryAccess: params.retrievalMeta.hadRepositoryAccess,
      analysisScope: params.analysisScope,
    };

    // Sanitize result metadata
    let resultMetadata: Record<string, unknown> | null = null;
    if (params.resultMetadata) {
      resultMetadata = {};
      for (const [k, v] of Object.entries(params.resultMetadata)) {
        if (/token|secret|password|Authorization|privateKey|jwt|accessToken/i.test(k)) {
          resultMetadata[k] = '[REDACTED]';
        } else if (typeof v === 'string') {
          resultMetadata[k] = this.sanitize(v).slice(0, 500);
        } else {
          resultMetadata[k] = v;
        }
      }
    }

    const rec = await this.prisma.aiInteraction.create({
      data: {
        userId: params.userId ?? null,
        teamId: params.teamId ?? null,
        projectId: params.projectId ?? null,
        question: this.sanitize(params.question).slice(0, 2000),
        sanitizedRetrievalMetadata,
        analysisScope: params.analysisScope,
        model: params.model ?? null,
        provider: params.provider ?? null,
        resultMetadata,
        latencyMs: params.latencyMs,
        success: params.success,
        errorCode: params.errorCode ?? null,
      },
    } as any);
    this.logger.log(`AI interaction persisted id=${rec.id} user=${params.userId} project=${params.projectId} success=${params.success}`);
    return rec;
  }

  async listForUser(userId: string, limit = 20): Promise<any[]> {
    return this.prisma.aiInteraction.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    } as any);
  }

  async listForProject(projectId: string, requesterUserId: string, teamId: string): Promise<any[]> {
    // Team isolation: only members can view
    const membership = await this.prisma.teamMember.findFirst({ where: { userId: requesterUserId, teamId } } as any);
    if (!membership) throw new Error('Not member of team — IDOR prevented');
    return this.prisma.aiInteraction.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
    } as any);
  }
}
