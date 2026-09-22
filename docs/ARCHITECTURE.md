# HMT Architecture — Final Backend Integration (Phase 2.6C)

> Version: 0.1.0 — Final Integration Verified 2026-09-21
> Scope: Participant API (NestJS + Fastify), Organizer API (Fastify), Shared Packages (ai, database, security, contracts, config, observability)
> Verified: `pnpm test` 111 PASS, `pnpm -r typecheck` 9/9, `pnpm -r build` 9/9, `pnpm lint` 0 errors, Health readiness distinguishes deps

## 1. Overview

```
Organizer
  ↓
Organizer API (Fastify, @hmt/config, @hmt/security, AIGateway)
  ↓
PostgreSQL / Neo4j / Redis  (source of truth / graph / ephemeral)
  ↓
Participant API (NestJS + Fastify, @hmt/database, @hmt/security)
  ↓
GitHub read-only integration (GitHubAppProvider preferred, GitHubApiProvider, MockGitHubProvider)
  ↓
RepositoryAccessGrant (explicit, leader-only, default deny)
  ↓
README retrieval → TargetedRetrievalService (question-driven, budget-limited, secret-redacted)
  ↓
AI Gateway (Mock / External OpenAI-compatible)
  ↓
Hint only (no code, no authority)
```

Monorepo `pnpm-workspace.yaml` with `apps/*`, `packages/*`. Shared packages are `workspace:*`, no duplicate auth/database.

```
HMT
├── apps/participant-api  (NestJS + Fastify, Prisma in-memory with real Postgres fallback, auth, team, project, github, ai, repository-access, privacy, health)
├── apps/organizer-api    (Fastify, memoryStore with Postgres future, auth, hackathon, mentor, sync, analytics, audit, timeline)
└── packages/
    ├── config            (Zod env, AppConfig: DATABASE_URL, JWT_*, AI_PROVIDER, GITHUB_*)
    ├── common            (Types, Brand IDs, Pagination)
    ├── contracts         (Versioned events: HackathonPublished, etc., api.ts envelope)
    ├── database          (Prisma helpers, postgres/neo4j/redis health, repository-access policy)
    ├── security          (Argon2id, JWT, RBAC, audit, hashing, validation, encryption)
    ├── ai                (AIService, AIGateway, retrieval, prompts, providers, evaluation)
    └── observability     (Pino logger with redaction, AsyncLocalStorage request context)
```

## 2. Participant API Domains

- **auth** (`auth.service.ts`, guards): Argon2id, JWT access 15m + refresh 7d rotating, family reuse detection via `hmt:auth:revoked:*`, Redis ephemeral, session/device tracking, email verification + password reset tokens (SHA256 hashed), RBAC `PARTICIPANT` default.
- **team** (`team.controller.ts`): create, discover (pagination capped 50), join/invite/interest, privacy `TEAM_PRIVATE` enforced, IDOR via `teamMember.teamId === project.teamId`, Neo4j `MEMBER_OF`, `PARTICIPATES_IN` sync.
- **project** (`project.controller.ts`): upsert, milestones, visibility filtering via `PrivacyService`.
- **github** (`github.service.ts`, providers): GitHub App read-only (`Contents:READ, Metadata:READ`) preferred, OAuth `state` CSRF, team-leader-only `connectRepository`, `grantAiAccess`, `revokeAiAccess`, tokens never logged/returned, `getReadmeForProject`/`getFileContentForProject` with grant check.
- **repository-access** (`repository-access.controller.ts`): `assertLeader` enforces `LEADER` role, `grant`/`revoke`/`history`/`check` with IDOR.
- **ai** (`ai.controller.ts`, `targeted-retrieval.service.ts`): `checkRepositoryAccess` (`GRANTED` + `revokedAt:null` + membership), `buildAIContext` (only `isPublished` hackathon, hide `repoUrl` if no grant), question-driven `TargetedRetrievalService` (README-first, max 5 files, 3 rounds, 15000 chars, ignores `node_modules/dist/.git/binary`), secret redaction, `AIGateway.analyzeRepositoryParticipant` (hint <2000, no large blocks), conversation/job contracts with IDOR.
- **health** (`health.service.ts`, `health.controller.ts`): liveness `GET /health` returns `ok` with `unknown` deps; readiness `GET /health/ready` + `/health/readiness` checks `postgres`/`neo4j`/`redis` with `checkPostgresHealth`/`checkNeo4jHealth`/`checkRedisHealth`, `latencyMs`, status `ok`/`degraded`/`down`.

## 3. Organizer API Domains

- **auth**: `POST /auth/register|login|refresh`, `GET /auth/me`, `POST /auth/logout*`, JWT via `@hmt/security`.
- **hackathon** (`hackathon.service.ts`): `generateDraft` via `AIGateway` (provider `mock/external`), creates `Hackathon {status:DRAFT, version:1, slug}`, `DRAFT→REVIEW→CONFIRMED→PUBLISHED→ARCHIVED` via `memoryStore.canTransition`. `update` only `DRAFT|REVIEW`. AI cannot set `status` (validated), cannot jump `DRAFT→PUBLISHED`. Published event `HackathonPublished` via `syncService`.
- **mentor** (`mentor.service.ts`): `assignMentor`, `submitFeedback` (immutable, `MENTOR_SUBMITTED`), `correctFeedback` (new version, original preserved, `parentId`, audit), `reviewFeedback` (`MENTOR_SUBMITTED→ORGANIZER_REVIEWED`), `publishFeedback` (`→PUBLISHED`), `illegalDirectEdit` blocked `403`. Visibility: participants only `PUBLISHED`.
- **sync** (`sync.service.ts`): `getPublishedEvent`, `getParticipantContext` (filters `PUBLIC|PARTICIPANT` resources), `consumeAsParticipant`, `getContractSchema`; direct DB write `403`.
- **resources, themes, evaluation, timeline, audit, analytics, participants**: Zod schemas, ownership via `enforceHackathonOwnership`.

## 4. Data Stores

| Store | Owns | Key Files |
|---|---|---|
| PostgreSQL | User, Session, Hackathon, Phase, Team, TeamMember, Project, RepositoryAccessGrant, GitHubConnection (encrypted if production), AiConversation/Message, MentorFeedback, AuditLog | `packages/database/src/postgres.ts`, `apps/participant-api/src/database/prisma.service.ts` (in-memory + Prisma future) |
| Neo4j | `(:User)-[:MEMBER_OF]->(:Team)-[:PARTICIPATES_IN]->(:Hackathon)-[:BUILT]->(:Project)-[:USES]->(:Technology)` | `packages/database/src/neo4j.ts` |
| Redis | `hmt:cache:*`, `hmt:rl:*`, `hmt:auth:revoked:<jti>` TTL 7d, `hmt:auth:revoked:<jti>` for reuse, `hmt:tmp:*` | `packages/database/src/redis.ts` |

## 5. Contracts

- API envelope `packages/contracts/src/api.ts`: `{version:"v1", data, meta:{requestId,timestamp,pagination}}` / `{version:"v1", error:{code,message,requestId}}`.
- Events `packages/contracts/src/events.ts`: `HackathonPublished` (publishedAt, phases[]), etc., `version:"v1"` discriminated union.
- OpenAPI: participant `@nestjs/swagger` at `/api/v1` + `/docs/api` + `/api/docs-json`; organizer `@fastify/swagger` at `/api/docs` + `/api/docs-json`. Both `.addBearerAuth()` / `securitySchemes: bearerAuth`. All protected routes annotated `@ApiBearerAuth` + `@UseGuards(JwtAuthGuard)` or `preHandler:[authGuard]`; health is public.

## 6. Security Headers & Request ID

- Helmet-equivalent `onSend`: `x-dns-prefetch-control:off`, `x-frame-options:SAMEORIGIN`, `x-content-type-options:nosniff`, `x-xss-protection:0`, `referrer-policy:no-referrer`, `cross-origin-opener-policy:same-origin`, `strict-transport-security` prod.
- Request ID: `x-request-id` / `x-correlation-id` or `randomUUID()`, stored on `req`, returned header, ALS via `@hmt/observability`.
- CORS: `CORS_ORIGINS` allowlist from `packages/config/src/env.ts`.

## 7. Health

- Liveness `GET /api/v1/health` + `/health` + `/api/v1/health/live`: `{status:"ok", service, version, checks:{api:"ok", postgres:"unknown", neo4j:"unknown", redis:"unknown"}, timestamp}`.
- Readiness `GET /api/v1/health/ready` + `/health/ready` + `/health/readiness` + `/health/live` (organizer) or `/health/readiness` (participant): same plus `checks` actual `ok|down` and `latencyMs`, status `ok` if all ok, `degraded` if any down, `down` if all down. Timeout 2000ms per dependency.
