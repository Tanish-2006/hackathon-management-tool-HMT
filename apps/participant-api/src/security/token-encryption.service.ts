import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AesGcmEncryptionProvider,
  sanitizeExceptionMessage,
  TokenEncryptionProvider,
} from '@hmt/security';

/**
 * TokenEncryptionService — Nest wrapper around AesGcmEncryptionProvider.
 * - Uses GITHUB_TOKEN_ENCRYPTION_KEY / ENCRYPTION_KEY from env
 * - Falls back to dev fallback key with warning (never in prod)
 * - Production must set key via Vault/KMS env injection (documented in docs/security/README)
 *
 * Deployment requirement:
 * - Production: set GITHUB_TOKEN_ENCRYPTION_KEY=$(openssl rand -base64 32)
 * - For Vault/KMS: implement TokenEncryptionProvider that calls Vault transit or KMS decrypt
 *   and provide it via { provide: TokenEncryptionProvider, useClass: VaultEncryptionProvider }
 *   This service is the interface boundary — swapping implementation requires no caller changes.
 */
@Injectable()
export class TokenEncryptionService implements TokenEncryptionProvider {
  private readonly logger = new Logger(TokenEncryptionService.name);
  private readonly provider: AesGcmEncryptionProvider;

  constructor(private readonly configService?: ConfigService) {
    let explicitKey: string | undefined;
    try {
      explicitKey =
        this.configService?.get<string>('GITHUB_TOKEN_ENCRYPTION_KEY') ||
        this.configService?.get<string>('ENCRYPTION_KEY') ||
        this.configService?.get<string>('CREDENTIAL_ENCRYPTION_KEY') ||
        process.env.GITHUB_TOKEN_ENCRYPTION_KEY ||
        process.env.ENCRYPTION_KEY ||
        process.env.CREDENTIAL_ENCRYPTION_KEY;
    } catch {
      explicitKey = process.env.GITHUB_TOKEN_ENCRYPTION_KEY || process.env.ENCRYPTION_KEY;
    }
    if (explicitKey) {
      this.provider = new AesGcmEncryptionProvider(explicitKey);
      this.logger.log(`TokenEncryptionService initialized with key from env (source: ${this.provider.getKeySource()})`);
    } else {
      this.provider = new AesGcmEncryptionProvider();
      if (process.env.NODE_ENV === 'production') {
        throw new Error(
          'TokenEncryptionService: missing encryption key in production. Set GITHUB_TOKEN_ENCRYPTION_KEY. See docs/security/ENCRYPTION.md',
        );
      }
      this.logger.warn('TokenEncryptionService using fallback dev key — not for production');
    }
  }

  encrypt(plaintext: string): string {
    if (!plaintext) return plaintext;
    return this.provider.encrypt(plaintext);
  }

  decrypt(ciphertext: string): string {
    if (!ciphertext) return ciphertext;
    return this.provider.decrypt(ciphertext);
  }

  isEncrypted(value: string): boolean {
    return this.provider.isEncrypted(value);
  }

  /**
   * Sanitize exceptions so decrypted tokens never leak in logs/audit/errors.
   */
  sanitizeError(message: string): string {
    return sanitizeExceptionMessage(message);
  }

  /**
   * Helper: encrypt access token for storage (DB column is encryptedAccessToken)
   */
  encryptToken(token: string): string {
    return this.encrypt(token);
  }

  decryptToken(encrypted: string): string {
    return this.decrypt(encrypted);
  }
}
