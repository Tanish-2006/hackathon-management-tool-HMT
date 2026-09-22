import { describe, it, expect } from 'vitest';
import { AesGcmEncryptionProvider, sanitizeExceptionMessage, encryptToken, decryptToken } from './encryption';

describe('security - credential encryption', () => {
  const key = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='; // 32 zero bytes base64

  it('encrypts and decrypts token at rest', () => {
    const provider = new AesGcmEncryptionProvider(key);
    const token = 'mock_github_token_abc1234567890';
    const enc = provider.encrypt(token);
    expect(enc).not.toBe(token);
    expect(provider.isEncrypted(enc)).toBe(true);
    expect(provider.decrypt(enc)).toBe(token);
  });

  it('never returns token in plaintext column', () => {
    const provider = new AesGcmEncryptionProvider(key);
    const token = 'ghp_123456789012345678901234567890123456';
    const enc = provider.encrypt(token);
    // enc should not contain original ghp
    expect(enc).not.toContain('ghp_');
    expect(enc.length).toBeGreaterThan(40);
  });

  it('sanitizes exceptions — never leaks token', () => {
    const msg = 'error with token mock_github_token_secret123 and Authorization: Bearer xyz';
    const sanitized = sanitizeExceptionMessage(msg);
    expect(sanitized).not.toContain('mock_github_token_secret123');
    expect(sanitized).toContain('[REDACTED]');
  });

  it('handles missing key fallback (dev)', () => {
    // In test env, default provider uses fallback
    const enc = encryptToken('mock_github_token_test');
    expect(enc).not.toBe('mock_github_token_test');
    expect(decryptToken(enc)).toBe('mock_github_token_test');
  });

  it('isEncrypted detects tokens vs ciphertext', () => {
    const provider = new AesGcmEncryptionProvider(key);
    const token = 'mock_github_token_abc';
    const enc = provider.encrypt('hello');
    expect(provider.isEncrypted(token)).toBe(false);
    expect(provider.isEncrypted('ghp_1234567890123456789012345678901234')).toBe(false);
    expect(provider.isEncrypted(enc)).toBe(true);
  });
});
