import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { redactAuditMetadata } from '@hmt/security';

/**
 * AuditService — persistent audit logging with secret redaction.
 * All audit metadata is sanitized before persistence.
 * No secrets (tokens, passwords, keys) are ever stored.
 *
 * Required events (Phase 2.6B):
 * GITHUB_AUTH_STARTED
 * GITHUB_AUTH_COMPLETED
 * GITHUB_AUTH_FAILED
 * GITHUB_REPOSITORY_CONNECTED
 * GITHUB_REPOSITORY_DISCONNECTED
 * AI_REPOSITORY_GRANT_CREATED
 * AI_REPOSITORY_GRANT_REVOKED
 * AI_REPOSITORY_ANALYSIS_REQUESTED
 * AI_REPOSITORY_ANALYSIS_DENIED
 */

const SENSITIVE_KEYS = new Set([
  'password',
  'accessToken',
  'access_token',
  'refreshToken',
  'refresh_token',
  'secret',
  'token',
  'DATABASE_URL',
  'NEO4J_PASSWORD',
  'REDIS_URL',
  'JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET',
  'GITHUB_CLIENT_SECRET',
  'GITHUB_TOKEN_ENCRYPTION_KEY',
  'ENCRYPTION_KEY',
  'AI_API_KEY',
  'privateKey',
  'Authorization',
  'authorization',
  'jwt',
  'githubToken',
]);

function sanitizeDetails(details: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!details) return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(details)) {
    if (SENSITIVE_KEYS.has(k) || /token|secret|password|Authorization|privateKey|jwt/i.test(k)) {
      out[k] = '[REDACTED]';
    } else if (typeof v === 'string' && (v.startsWith('mock_github_token_') || v.startsWith('ghp_') || v.startsWith('gho_') || v.startsWith('sk-'))) {
      out[k] = '[REDACTED]';
    } else if (typeof v === 'object' && v !== null) {
      // shallow redact nested
      out[k] = sanitizeDetails(v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  // Also via shared redact
  return redactAuditMetadata(out) ?? out;
}

export interface AuditEntry {
  action: string;
  userId?: string | null;
  resource?: string;
  resourceType?: string;
  resourceId?: string | null;
  outcome?: 'success' | 'failure';
  ipAddress?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
  details?: Record<string, unknown> | null;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async log(entry: AuditEntry): Promise<void> {
    const sanitized = sanitizeDetails(entry.details ?? null);
    try {
      await this.prisma.auditLog.create({
        data: {
          userId: entry.userId ?? null,
          action: entry.action,
          resource: entry.resource ?? entry.resourceType ?? 'unknown',
          details: sanitized,
          ipAddress: entry.ipAddress ?? null,
          createdAt: new Date(),
        },
      } as any);
      this.logger.log(`AUDIT ${entry.action} user=${entry.userId ?? 'system'} resource=${entry.resource} outcome=${entry.outcome ?? 'success'}`);
    } catch (e) {
      this.logger.error(`Failed to persist audit log ${entry.action}: ${(e as Error).message}`);
    }
  }

  // Convenience for GitHub/AI events
  async logGitHubAuthStarted(userId: string, details: Record<string, unknown> = {}): Promise<void> {
    await this.log({
      action: 'GITHUB_AUTH_STARTED',
      userId,
      resource: `user:${userId}`,
      outcome: 'success',
      details: sanitizeDetails(details),
    });
  }
  async logGitHubAuthCompleted(userId: string, githubLogin: string): Promise<void> {
    await this.log({
      action: 'GITHUB_AUTH_COMPLETED',
      userId,
      resource: `user:${userId}`,
      outcome: 'success',
      details: { githubLogin, userId },
    });
  }
  async logGitHubAuthFailed(userId: string, reason: string): Promise<void> {
    await this.log({
      action: 'GITHUB_AUTH_FAILED',
      userId,
      resource: `user:${userId}`,
      outcome: 'failure',
      details: { reason: sanitizeDetails({ reason } as Record<string, unknown>)?.reason as string, userId },
    });
  }
  async logRepositoryConnected(userId: string, projectId: string, repoFullName: string, teamId: string): Promise<void> {
    await this.log({
      action: 'GITHUB_REPOSITORY_CONNECTED',
      userId,
      resource: `project:${projectId}`,
      outcome: 'success',
      details: { repoFullName, projectId, teamId, userId },
    });
  }
  async logRepositoryDisconnected(userId: string): Promise<void> {
    await this.log({
      action: 'GITHUB_REPOSITORY_DISCONNECTED',
      userId,
      resource: `user:${userId}`,
      outcome: 'success',
      details: { userId },
    });
  }
  async logGrantCreated(userId: string, projectId: string, teamId: string, grantId: string): Promise<void> {
    await this.log({
      action: 'AI_REPOSITORY_GRANT_CREATED',
      userId,
      resource: `project:${projectId}`,
      outcome: 'success',
      details: { grantId, projectId, teamId, grantedById: userId },
    });
  }
  async logGrantRevoked(userId: string, projectId: string, teamId: string, grantId: string): Promise<void> {
    await this.log({
      action: 'AI_REPOSITORY_GRANT_REVOKED',
      userId,
      resource: `project:${projectId}`,
      outcome: 'success',
      details: { grantId, projectId, teamId, revokedById: userId },
    });
  }
  async logAnalysisRequested(userId: string, projectId: string): Promise<void> {
    await this.log({
      action: 'AI_REPOSITORY_ANALYSIS_REQUESTED',
      userId,
      resource: `project:${projectId}`,
      outcome: 'success',
      details: { projectId, userId },
    });
  }
  async logAnalysisDenied(userId: string, projectId: string, reason: string): Promise<void> {
    await this.log({
      action: 'AI_REPOSITORY_ANALYSIS_DENIED',
      userId,
      resource: `project:${projectId}`,
      outcome: 'failure',
      details: { projectId, userId, reason },
    });
  }
}
