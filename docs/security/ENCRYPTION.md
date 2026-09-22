# Credential Encryption — Production Deployment Requirement

## Overview
HMT encrypts GitHub access tokens at rest using **AES-256-GCM** (12-byte IV, 16-byte authTag, base64-encoded `iv+tag+ciphertext`).

- **Abstraction:** `packages/security/src/encryption.ts` (`TokenEncryptionProvider` interface) and `apps/participant-api/src/security/token-encryption.service.ts` (Nest wrapper).
- **Key source:** Environment variable `GITHUB_TOKEN_ENCRYPTION_KEY` (aliases: `ENCRYPTION_KEY`, `CREDENTIAL_ENCRYPTION_KEY`). Must be 32 random bytes, base64-encoded.

## Development
- If no key is set, a deterministic fallback key is used with a warning (`[security] Using fallback encryption key (dev only)`).
- **Never use fallback in production** — `TokenEncryptionService` throws in `NODE_ENV=production` if no key is set.

Generate a dev key:
```bash
openssl rand -base64 32
# example: 4qW7... (44 chars with padding, decodes to 32 bytes)
```

Set in `.env`:
```
GITHUB_TOKEN_ENCRYPTION_KEY=your-base64-32-bytes
```

Test encryption round-trip:
```bash
pnpm --filter @hmt/security test
# includes `encryption.test.ts` for encrypt/decrypt, redaction, and fallback
```

## Production — Vault / KMS Integration

**Requirement:** Production MUST set `GITHUB_TOKEN_ENCRYPTION_KEY` via secure env injection (Vault, AWS KMS, GCP KMS, Azure Key Vault). Plaintext `.env` must never be committed.

### Option A — HashiCorp Vault (Transit)
1. Enable transit: `vault secrets enable transit`
2. Create key: `vault write -f transit/keys/hmt-github`
3. Use Vault Agent to inject env: `vault agent -config=agent.hcl` renders `GITHUB_TOKEN_ENCRYPTION_KEY` from Vault.
4. Alternatively, implement `VaultEncryptionProvider`:
```ts
@Injectable()
export class VaultEncryptionProvider implements TokenEncryptionProvider {
  constructor(private readonly vault: VaultClient) {}
  encrypt(plaintext: string): string {
    const { ciphertext } = await this.vault.transitEncrypt('hmt-github', plaintext);
    return ciphertext; // vault:v1:...
  }
  decrypt(ciphertext: string): string {
    return (await this.vault.transitDecrypt('hmt-github', ciphertext)).plaintext;
  }
  isEncrypted(v: string): boolean { return v.startsWith('vault:'); }
}
```
   Then in `AppModule`:
```ts
{ provide: TokenEncryptionProvider, useClass: VaultEncryptionProvider }
{ provide: TokenEncryptionService, useExisting: TokenEncryptionProvider }
```

### Option B — AWS KMS
- Store `GITHUB_TOKEN_ENCRYPTION_KEY` as KMS-encrypted env var; decrypt at startup via `aws kms decrypt`.
- Or use `AwsKmsEncryptionProvider` that calls `kms.encrypt`/`decrypt` for each token (higher latency, but zero key in env).

### Option C — External Vault via Env
- Simplest production: inject `GITHUB_TOKEN_ENCRYPTION_KEY` from Vault via Kubernetes `envFrom` / Docker secrets / ECS secrets.
- This keeps current `AesGcmEncryptionProvider` unchanged, only key management is external.

**Abstraction guarantee:** Callers (`GitHubService`) depend on `TokenEncryptionProvider` interface, not concrete implementation. Swapping to Vault/KMS requires only DI binding change, no business logic change.

## Security Properties
- Tokens **never logged**: `sanitizeExceptionMessage` redacts `mock_github_token_*`, `ghp_*`, `gho_*`, `Bearer ...`, `AKIA*`, `sk-*`; `neverLogToken()` marker; pino `redact` paths include `*.accessToken`.
- Tokens **never returned in DTO**: `GitHubService.getConnection()` strips `encryptedAccessToken`/`accessToken`; `handleCallback` returns sanitized connection.
- Tokens **never in AI context**: `ParticipantTargetedRetrievalService` redacts before `relevantFiles`; `AIController` passes only `question`, `projectContext`, `readmeContext`, `relevantFiles` (with `retrievalReason`), `analysisScope` — never `entireRepository`, never token.
- Tokens **never in audit**: `AuditService.sanitizeDetails` redacts `accessToken`, `password`, `Authorization`, etc.; `redactAuditMetadata` in `@hmt/security`.

## Rotation
- To rotate key, decrypt with old key, re-encrypt with new key, update `github_connections.encryptedAccessToken` rows.
- Provide `scripts/rotate-encryption-key.ts` (future) that iterates `githubConnection` table.

## Verification
- Check DB column is ciphertext (base64, length > 40, not `mock_github_token` prefix).
- Run `apps/participant-api/src/security/phase26b-security.spec.ts`:
  - `encrypted GitHub credential storage` — ensures ciphertext stored, decrypt returns original, DTO/AI/audit never contain token.
  - `credential never logged` — ensures `sanitizeExceptionMessage` works.

## References
- Implementation: `packages/security/src/encryption.ts:1`, `apps/participant-api/src/security/token-encryption.service.ts:1`
- Tests: `packages/security/src/encryption.test.ts:1`, `apps/participant-api/src/security/phase26b-security.spec.ts:88`
