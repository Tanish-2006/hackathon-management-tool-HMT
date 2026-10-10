function readEnv(key: string): string | undefined {
  return (import.meta.env as Record<string, string | undefined>)[key]?.trim() || undefined;
}

function apiBase(key: string, fallback: string): string {
  return (readEnv(key) ?? fallback).replace(/\/+$/, '');
}

export const PARTICIPANT_API_BASE = apiBase('VITE_API_URL', 'http://localhost:3000/api/v1');

export const ORGANIZER_API_BASE = apiBase('VITE_ORGANIZER_API_URL', 'http://localhost:3002/api/v1');

export const DEMO_MODE = readEnv('VITE_DEMO_MODE') === 'true';

export const API_TIMEOUT_MS = Number(readEnv('VITE_API_TIMEOUT_MS')) || 15000;
