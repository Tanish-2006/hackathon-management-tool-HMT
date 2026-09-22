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

// Secret redaction for audit metadata - reuse logic from observability but explicit here too
const SENSITIVE_KEYS = new Set([
  'password',
  'accessToken',
  'refreshToken',
  'secret',
  'DATABASE_URL',
  'NEO4J_PASSWORD',
  'REDIS_URL',
  'JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET',
]);

export function redactAuditMetadata(
  metadata: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!metadata) return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(metadata)) {
    out[k] = SENSITIVE_KEYS.has(k) ? '[REDACTED]' : v;
  }
  return out;
}

export function buildAuditEvent(params: Omit<AuditEvent, 'eventId' | 'timestamp'> & Partial<Pick<AuditEvent, 'eventId' | 'timestamp'>>): AuditEvent {
  return {
    eventId: params.eventId ?? `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
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
