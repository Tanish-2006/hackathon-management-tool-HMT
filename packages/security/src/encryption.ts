import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Credential Encryption Abstraction
 * - AES-256-GCM, 12-byte IV, 16-byte authTag
 * - Key from environment: GITHUB_TOKEN_ENCRYPTION_KEY or ENCRYPTION_KEY
 * - For production, key should come from vault/KMS. This module abstracts
 *   encryption so a VaultKmsEncryptionProvider can be swapped in without changing callers.
 *
 * Format: base64( iv(12) + authTag(16) + ciphertext )
 *
 * Security properties:
 * - Tokens encrypted at rest (DB column stores ciphertext only)
 * - Never log plaintext token — callers must not console.log(decrypted)
 * - Never return decrypted token in DTO
 * - Encryption key never stored alongside ciphertext
 *
 * Development: if env key missing, uses deterministic fallback with warning.
 * Production: requires explicit 32-byte key (base64 or hex or raw utf8 32 chars). Throws if invalid.
 *
 * Deployment requirement (see docs/security/README):
 * - Production must set GITHUB_TOKEN_ENCRYPTION_KEY to 32 random bytes, base64-encoded
 *   e.g. `openssl rand -base64 32`
 * - For KMS/Vault integration, implement TokenEncryptionProvider interface
 *   and provide via DI. This file is the local env-based implementation.
 */

export interface TokenEncryptionProvider {
  encrypt(plaintext: string): string;
  decrypt(ciphertext: string): string;
  isEncrypted(value: string): boolean;
}

const FALLBACK_KEY_BASE64 = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='; // 32 zero bytes, dev only
const KEY_ENV_VARS = ['GITHUB_TOKEN_ENCRYPTION_KEY', 'ENCRYPTION_KEY', 'CREDENTIAL_ENCRYPTION_KEY'];

function resolveKey(): Buffer {
  for (const envName of KEY_ENV_VARS) {
    const raw = process.env[envName];
    if (raw && raw.trim().length > 0) {
      const buf = decodeKey(raw.trim());
      if (buf.length === 32) return buf;
      throw new Error(
        `Invalid encryption key in ${envName}: decoded length ${buf.length} != 32 bytes. Expected 32 bytes (base64 44 chars or hex 64 chars or 32 utf8 chars).`,
      );
    }
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      `Missing encryption key in production. Set one of ${KEY_ENV_VARS.join(', ')} to 32 random bytes (base64). Example: openssl rand -base64 32`,
    );
  }
  // Dev fallback — log once
  if (!(global as unknown as Record<string, unknown>).__hmt_encryption_fallback_warned) {
    // eslint-disable-next-line no-console
    console.warn(
      '[security] Using fallback encryption key (dev only). Set GITHUB_TOKEN_ENCRYPTION_KEY in .env for persistent encryption. Do NOT use fallback in production.',
    );
    (global as unknown as Record<string, unknown>).__hmt_encryption_fallback_warned = true;
  }
  return Buffer.from(FALLBACK_KEY_BASE64, 'base64');
}

function decodeKey(raw: string): Buffer {
  // Try base64 (44 chars with padding for 32 bytes)
  if (/^[A-Za-z0-9+/=]{20,}$/.test(raw)) {
    try {
      const b64 = Buffer.from(raw, 'base64');
      if (b64.length === 32) return b64;
    } catch {}
  }
  // Try hex (64 hex chars = 32 bytes)
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, 'hex');
  }
  // Raw utf8 - must be exactly 32 bytes
  const utf8 = Buffer.from(raw, 'utf8');
  if (utf8.length === 32) return utf8;
  // If raw is shorter but we want to support passphrase-like: hash to 32 bytes? NO - fail explicitly for security
  // Throw so operator fixes config
  throw new Error(
    `Encryption key must be 32 bytes. Got ${utf8.length} bytes utf8. Use base64 (openssl rand -base64 32) or hex (openssl rand -hex 32).`,
  );
}

export class AesGcmEncryptionProvider implements TokenEncryptionProvider {
  private readonly key: Buffer;
  private readonly keySource: string;

  constructor(key?: Buffer | string) {
    if (key !== undefined && key !== null && !(typeof key === 'string' && key.length === 0)) {
      this.key = typeof key === 'string' ? decodeKey(key) : key;
      this.keySource = 'explicit';
    } else if (typeof key === 'string' && key.length === 0) {
      throw new Error('Invalid encryption key: explicit empty string is not allowed (use undefined for env resolution)');
    } else {
      this.key = resolveKey();
      this.keySource = process.env.GITHUB_TOKEN_ENCRYPTION_KEY
        ? 'GITHUB_TOKEN_ENCRYPTION_KEY'
        : process.env.ENCRYPTION_KEY
          ? 'ENCRYPTION_KEY'
          : process.env.CREDENTIAL_ENCRYPTION_KEY
            ? 'CREDENTIAL_ENCRYPTION_KEY'
            : 'fallback';
    }
    if (this.key.length !== 32) throw new Error('AES-256-GCM requires 32-byte key');
  }

  encrypt(plaintext: string): string {
    if (!plaintext) return plaintext;
    if (this.isEncrypted(plaintext)) return plaintext; // avoid double-encryption
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    const combined = Buffer.concat([iv, tag, enc]);
    return combined.toString('base64');
  }

  decrypt(ciphertext: string): string {
    if (!ciphertext) return ciphertext;
    if (!this.isEncrypted(ciphertext)) return ciphertext; // if not encrypted, return as-is (migration compatibility)
    // Authenticated decryption — fail closed on tampering/wrong key.
    // Legacy plaintext that happens to look like base64 is indistinguishable
    // from ciphertext; callers must track encryption state explicitly rather
    // than relying on this heuristic for new writes.
    const buf = Buffer.from(ciphertext, 'base64');
    if (buf.length < 12 + 16 + 1) {
      throw new Error('Decryption failed: ciphertext too short (possible tampering or wrong key)');
    }
    try {
      const iv = buf.subarray(0, 12);
      const tag = buf.subarray(12, 28);
      const enc = buf.subarray(28);
      const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
      decipher.setAuthTag(tag);
      const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
      return dec.toString('utf8');
    } catch {
      throw new Error('Decryption failed: authentication failed (wrong key or tampered ciphertext)');
    }
  }

  isEncrypted(value: string): boolean {
    if (!value || typeof value !== 'string') return false;
    // Heuristic: encrypted values are base64, length > 40, and decode to iv+tag+ciphertext
    // Tokens like mock_github_token_* or ghp_* are NOT base64 of correct structure.
    // Blocklist covers common plaintext prefixes so they are never mistaken for ciphertext.
    const lower = value.toLowerCase();
    if (
      value.startsWith('mock_') ||
      value.startsWith('ghp_') || value.startsWith('gho_') ||
      value.startsWith('ghu_') || value.startsWith('ghs_') || value.startsWith('ghr_') ||
      value.startsWith('github_pat_') ||
      value.startsWith('sk-') || value.startsWith('sk-ant-') ||
      value.startsWith('xoxb-') || value.startsWith('xoxp-') ||
      value.startsWith('AKIA') ||
      lower.startsWith('bearer ') ||
      lower.startsWith('-----begin')
    )
      return false;
    try {
      const buf = Buffer.from(value, 'base64');
      // Must be at least 12+16+1 and base64 round-trip stable
      if (buf.length < 29) return false;
      const reencoded = buf.toString('base64');
      // Normalize padding comparison
      return reencoded.replace(/=+$/, '') === value.replace(/=+$/, '');
    } catch {
      return false;
    }
  }

  getKeySource(): string {
    return this.keySource;
  }
}

// Default singleton for convenience (lazy)
let defaultProvider: TokenEncryptionProvider | null = null;
export function getDefaultEncryptionProvider(): TokenEncryptionProvider {
  if (!defaultProvider) defaultProvider = new AesGcmEncryptionProvider();
  return defaultProvider;
}
export function encryptToken(plaintext: string): string {
  return getDefaultEncryptionProvider().encrypt(plaintext);
}
export function decryptToken(ciphertext: string): string {
  return getDefaultEncryptionProvider().decrypt(ciphertext);
}
export function isTokenEncrypted(value: string): boolean {
  return getDefaultEncryptionProvider().isEncrypted(value);
}

/**
 * Secret sanitization — NEVER log decrypted token.
 * Use sanitizeException to strip tokens from error messages before logging/audit.
 */
const TOKEN_PATTERNS: RegExp[] = [
  /mock_github_token_[a-zA-Z0-9_-]+/g,
  /ghp_[a-zA-Z0-9]{8,}/g,
  /gho_[a-zA-Z0-9_-]{8,}/g,
  /ghu_[a-zA-Z0-9_-]{8,}/g,
  /ghs_[a-zA-Z0-9_-]{8,}/g,
  /ghr_[a-zA-Z0-9_-]{8,}/g,
  /github_pat_[a-zA-Z0-9_]{8,}/g,
  /AKIA[0-9A-Z]{16}/g,
  /ASIA[0-9A-Z]{16}/g,
  /sk-ant-[a-zA-Z0-9_-]{10,}/g,
  /sk-[a-zA-Z0-9_-]{10,}/g,
  /xox[bap]-?[a-zA-Z0-9-]+/g,
  /AIza[0-9A-Za-z_-]{35}/g,
  /Bearer\s+[a-zA-Z0-9._~+/=-]+/gi,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
];

export function sanitizeExceptionMessage(message: string): string {
  if (typeof message !== 'string') return '[REDACTED: non-string error]';
  let out = message;
  for (const pat of TOKEN_PATTERNS) {
    // Reset lastIndex for global regexes reused across calls.
    pat.lastIndex = 0;
    out = out.replace(pat, '[REDACTED]');
  }
  // Also redact if message contains Authorization header value
  out = out.replace(/Authorization:\s*[^\n\r]+/gi, 'Authorization: [REDACTED]');
  // Quoted key=value secrets (accessToken, refreshToken, password, secret, apiKey, …)
  out = out.replace(
    /(access_?token|refresh_?token|password|secret|api[_-]?key|client_?secret|private_?key|github_?token)["']?\s*[:=]\s*["'][^"']+["']/gi,
    '$1=[REDACTED]',
  );
  // Unquoted key=value secrets (api_key=abcdef, password=hunter2)
  out = out.replace(
    /(access_?token|refresh_?token|password|secret|api[_-]?key|client_?secret)(["']?\s*[:=]\s*)([^\s'";,}\]]+)/gi,
    '$1=[REDACTED]',
  );
  // Connection strings with embedded credentials (postgres://user:pass@host, mongodb+srv://…, redis://…)
  out = out.replace(
    /(postgres(ql)?|mysql|mongodb(\+srv)?|redis):\/\/[^\s'"]+/gi,
    '[REDACTED_CONNECTION_STRING]',
  );
  return out;
}

export function neverLogToken(_token: string): void {
  // Intentionally no-op: this function exists to mark places where logging is forbidden
  // If you are tempted to console.log(token), call neverLogToken instead and remove the log.
}
