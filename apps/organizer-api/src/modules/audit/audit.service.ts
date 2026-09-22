import { randomUUID } from 'crypto';
import type { AuditLogEntry } from '../../domain/types';
import { memoryStore } from '../../store/memory.store';
import { buildAuditEvent } from '@hmt/security';

// Append-only audit service. No update/delete allowed.
// All important actions must be logged.

export class AuditService {
  async log(params: {
    actorId: string | null;
    actorRole?: string | null;
    action: string;
    resourceType: string;
    resourceId?: string | null;
    outcome: 'success' | 'failure';
    ip?: string | null;
    userAgent?: string | null;
    requestId?: string | null;
    metadata?: Record<string, unknown> | null;
  }): Promise<AuditLogEntry> {
    const event = buildAuditEvent({
      actorId: params.actorId ?? null,
      actorRole: params.actorRole ?? null,
      action: params.action,
      resourceType: params.resourceType,
      resourceId: params.resourceId ?? null,
      outcome: params.outcome,
      ip: params.ip ?? null,
      userAgent: params.userAgent ?? null,
      requestId: params.requestId ?? null,
      metadata: params.metadata ?? null,
    });

    const entry: AuditLogEntry = {
      id: event.eventId,
      timestamp: event.timestamp,
      actorId: event.actorId ?? null,
      actorRole: event.actorRole ?? null,
      action: event.action,
      resourceType: event.resourceType,
      resourceId: event.resourceId ?? null,
      outcome: event.outcome,
      ip: event.ip ?? null,
      userAgent: event.userAgent ?? null,
      requestId: event.requestId ?? null,
      metadata: event.metadata ?? null,
      createdAt: event.timestamp,
    };

    // Append-only: if id already exists, generate new id (should not happen)
    if (memoryStore.auditLogs.has(entry.id)) {
      entry.id = randomUUID();
    }
    memoryStore.addAudit(entry);
    return entry;
  }

  async findMany(filters?: { actorId?: string; action?: string; resourceType?: string; limit?: number }): Promise<AuditLogEntry[]> {
    let logs = Array.from(memoryStore.auditLogs.values());
    if (filters?.actorId) logs = logs.filter((l) => l.actorId === filters.actorId);
    if (filters?.action) logs = logs.filter((l) => l.action === filters.action);
    if (filters?.resourceType) logs = logs.filter((l) => l.resourceType === filters.resourceType);
    logs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    if (filters?.limit) logs = logs.slice(0, filters.limit);
    return logs;
  }

  async findById(id: string): Promise<AuditLogEntry | null> {
    return memoryStore.auditLogs.get(id) ?? null;
  }

  // Mutation attempts must be blocked - append-only enforcement
  // These methods intentionally throw if called to satisfy "must be append-only"
  async updateShouldFail(): Promise<never> {
    throw Object.assign(new Error('Audit logs are append-only; updates not allowed'), { statusCode: 403 });
  }

  async deleteShouldFail(): Promise<never> {
    throw Object.assign(new Error('Audit logs are append-only; deletes not allowed'), { statusCode: 403 });
  }
}

export const auditService = new AuditService();
