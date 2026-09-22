// Centralized API configuration — single source of truth for frontend.
// Production URLs MUST come from environment variables. Never hard-code prod domains.
// Development defaults: participant :3000, organizer :3002, frontend :5173.
// NOTE: :3001 is legacy and MUST NOT be used (see HMT production readiness).
function readEnv(key: string): string | undefined {
  try {
    const v = (import.meta as any)?.env?.[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  } catch { /* ignore */ }
  return undefined;
}

function normalizeBase(url: string): string {
  return url.replace(/\/+$/, '');
}

export const PARTICIPANT_API_BASE = normalizeBase(
  readEnv('VITE_API_URL') ||
    readEnv('VITE_PARTICIPANT_API_URL') ||
    'http://localhost:3000/api/v1',
);

export const ORGANIZER_API_BASE = normalizeBase(
  readEnv('VITE_ORGANIZER_API_URL') ||
    readEnv('VITE_ORGANIZER_API_BASE') ||
    'http://localhost:3002/api/v1',
);

/** Explicit demo mode only — fake data is NEVER shown in production flow. */
export const DEMO_MODE =
  readEnv('VITE_DEMO_MODE') === 'true' ||
  readEnv('VITE_USE_MOCKS') === 'true';

export const API_TIMEOUT_MS = Number(readEnv('VITE_API_TIMEOUT_MS') || 15000);

if (typeof window !== 'undefined') {
  // Guard against accidental legacy port usage sneaking into env.
  for (const base of [PARTICIPANT_API_BASE, ORGANIZER_API_BASE]) {
    if (base.includes('localhost:3001')) {
      // eslint-disable-next-line no-console
      console.warn('[HMT] Deprecated localhost:3001 API base detected. Use :3000 (participant) or :3002 (organizer).', base);
    }
  }
}
