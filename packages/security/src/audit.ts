import { randomUUID } from 'node:crypto';

export interface AuditEvent {
  eventId: string;
  timestamp: string; // ISO
  actorId: string | null; // null for system
  actorRole?: string | null;
  action: string; // e.g., 'auth.login', 'hackathon.publish'
  resourceType: string;
  resourceId?: string | null;
  outcome: 'success' | 'failure';
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
  metadata?: Record<string, unknown> | null;
}

// Secret redaction for audit metadata - reuse logic from observability but explicit here too.
// Matching is case-insensitive and covers snake_case variants; nested objects/arrays redacted recursively.
const SENSITIVE_KEY_PATTERNS = [
  /password/i,
  /passwd/i,
  /pwd/i,
  /access_?token/i,
  /refresh_?token/i,
  /(^|_)token(s)?$/i,
  /secret/i,
  /api[_-]?key/i,
  /client[_-]?secret/i,
  /private[_-]?key/i,
  /github[_-]?token/i,
  /authorization/i,
  /database_?url/i,
  /neo4j_?password/i,
  /redis_?url/i,
  /jwt_.*secret/i,
  /sync_.*secret/i,
];

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERNS.some((re) => re.test(key));
}

function redactDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactDeep);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = isSensitiveKey(k) ? '[REDACTED]' : redactDeep(v);
    }
    return out;
  }
  return value;
}

export function redactAuditMetadata(
  metadata: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (metadata == null) return null;
  if (typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  return redactDeep(metadata) as Record<string, unknown>;
}

export function buildAuditEvent(params: Omit<AuditEvent, 'eventId' | 'timestamp'> & Partial<Pick<AuditEvent, 'eventId' | 'timestamp'>>): AuditEvent {
  if (!params || typeof params !== 'object') throw new Error('Invalid audit event: params required');
  if (typeof params.action !== 'string' || params.action.length === 0) {
    throw new Error('Invalid audit event: action must be a non-empty string');
  }
  if (typeof params.resourceType !== 'string' || params.resourceType.length === 0) {
    throw new Error('Invalid audit event: resourceType must be a non-empty string');
  }
  if (params.outcome !== 'success' && params.outcome !== 'failure') {
    throw new Error('Invalid audit event: outcome must be success|failure');
  }
  return {
    eventId: params.eventId ?? `evt_${randomUUID()}`,
    timestamp: params.timestamp ?? new Date().toISOString(),
    actorId: params.actorId ?? null,
    actorRole: params.actorRole ?? null,
    action: params.action,
    resourceType: params.resourceType,
    resourceId: params.resourceId ?? null,
    outcome: params.outcome,
    ip: params.ip ?? null,
    userAgent: params.userAgent ?? null,
    requestId: params.requestId ?? null,
    metadata: redactAuditMetadata(params.metadata ?? null),
  };
}
