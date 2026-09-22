# SECURITY SPECIFICATION — HMT PARTICIPANT PLATFORM

## Threat Mitigations & Defensive Architecture

### 1. Authentication & Session Security
- **Password Hashing**: Argon2id with random salt (minimum 19MB memory, 2 iterations, 1 parallelism degree).
- **JWT Architecture**: Access tokens signed with RS256/HS256 expiring in 15 minutes. Refresh tokens are 256-bit cryptographically secure random strings stored as hashed values in PostgreSQL.
- **Refresh Token Rotation & Reuse Detection**: Each refresh token belongs to a Token Family (`familyId`). If a revoked or previously exchanged refresh token is presented, the entire Token Family is revoked immediately, invalidating all sessions for that device.
- **Strict Server-Side Authorization**: The server NEVER accepts `userId`, `role`, `teamId`, or `projectId` from request parameters or request bodies to establish ownership. All identities are strictly extracted from validated JWT context and cross-verified in DB.

### 2. OWASP API Top 10 Protections
- **BOLA / IDOR**: Every resource read/write guard verifies that the requesting user's team ID matches the resource's owner team ID in PostgreSQL.
- **Broken Function Level Authorization**: RBAC guards enforce exact role requirements (`PARTICIPANT`, `MENTOR`, `ORGANIZER`, `ADMIN`).
- **Mass Assignment**: DTOs use `class-validator` with `whitelist: true` and `forbidNonWhitelisted: true` on NestJS ValidationPipe.
- **Rate Limiting**: Redis-backed rate limiter limits IP and user token requests (100 req/min general, 5 req/min auth endpoints).
- **Injection Protection**: PostgreSQL queries use Prisma parameterized prepared statements. Neo4j Cypher queries use parameterized parameters only (`$param`).
- **Secret Redaction**: Repository scanner automatically redacts AWS keys, JWT secrets, passwords, high-entropy API tokens, and RSA private keys before sending content to AI or logs.

### 3. Repository Analysis Sandbox Security
- Analysis is performed in memory or isolated temporary working directories.
- Arbitrary code execution from user repositories is prohibited during automated scans. Static AST parsing, dependency graph checks, and linting run with zero-privilege profiles.
