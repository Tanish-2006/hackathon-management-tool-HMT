# AGENTS.md — HMT Monorepo

pnpm workspace (`apps/*`, `packages/*`). Node 22 (`.nvmrc`; engines `>=20`), `pnpm@9.12.3`. Always use pnpm, never npm/yarn.

## Commands (run from repo root)

- Install: `pnpm install`
- Verify order: `pnpm -r typecheck` → `pnpm lint` → `pnpm test` → `pnpm -r build`
- Root tests are vitest: `pnpm test` (`vitest run`, include: `packages/*/src/**/*.test.ts`, `apps/*/src/**/*.test.ts`, `tests/**/*.test.ts`, 15s timeout). Single file: `npx vitest run <path>`
- Per package: `pnpm --filter @hmt/<name> test|typecheck|build` (e.g. `@hmt/database`, `@hmt/organizer-api`)
- `participant-api` is the exception: package name is literally `HMT(Participant)`, so `pnpm build:apps` (`--filter "@hmt/*-api"`) silently skips it. Use `pnpm -r build` or run inside `apps/participant-api`. Its unit tests are **jest** (`*.spec.ts` under `src/`), not vitest: `cd apps/participant-api && npx jest <file>`
- Prisma: `pnpm --filter @hmt/database prisma:generate|prisma:migrate` (`migrate` = `prisma migrate dev`; deploy uses `migrate deploy`)
- Infra: `pnpm docker:up|docker:down|docker:validate` (compose file `infra/docker/docker-compose.yml`); `pnpm prisma:generate|prisma:migrate` are root aliases to the database package
- Format: `pnpm format:check` (prettier); frontend builds separately: `pnpm --dir apps/participant-api/frontend run build`

## Layout (non-obvious)

- `apps/participant-api` — NestJS + Fastify. Entrypoints `src/main.ts` (global prefix `api/v1`, binds `::`) + `src/app.module.ts`. Own jest config + own `prisma/schema.prisma` (in-memory `PrismaService` fallback unless `USE_REAL_DB=true`). Frontend lives **inside it**: `apps/participant-api/frontend` (Vite React 19, `vercel.json` builds `pnpm --dir apps/participant-api/frontend run build` → `dist/public`).
- `apps/organizer-api` — plain Fastify (no Nest). Entrypoint `src/main.ts` exports `buildApp()`; business routes registered under `/api/v1` prefix in `src/modules/*/*.routes.ts`.
- `packages/`: `config` (Zod env, single source of truth — see below), `contracts` (`api.ts` v1 envelope + versioned `events.ts`), `database` (Prisma schema is canonical + `postgres.ts`/`neo4j.ts`/`redis.ts` health helpers + `repository-access.ts` policy), `security` (argon2id, JWT, RBAC), `ai` (mock/external gateway), `observability` (pino + `AsyncLocalStorage` request context), `common` (brand IDs, pagination).
- Two Prisma schemas exist: `packages/database/prisma/schema.prisma` and `apps/participant-api/prisma/schema.prisma`. Keep entity changes in sync.
- `tests/` holds repo-wide regression as file-content assertions: `foundation.test.ts` (structure, contracts, health) and `production-readiness.test.ts` (ports, rate limits, redaction, no demo fallbacks). `foundation.test.ts` shells out to `docker compose config` — needs docker.
- No CI workflows, no `opencode.json`, no existing instruction files. Docs that matter: `docs/ARCHITECTURE.md` (module map), `docs/DATABASE.md` (store split), `docs/DEPLOYMENT.md` (topology, fastify pin rationale).

## Env, ports, services

- Copy `.env.example` → `.env` (never commit `.env`). `AI_PROVIDER=mock` + empty `GITHUB_*` = deterministic mocks, no keys needed for tests/CI. `external` AI needs `AI_API_KEY`/`AI_MODEL`/`AI_BASE_URL`.
- Canonical ports: participant `:3000`, organizer `:3002`, frontend `:5173`. **`:3001` is legacy, do not use.** Postgres is `5433:5432` on host (5432 often occupied). Redis `6379`, Neo4j `7474/7687`.
- Env validation (`packages/config/src/env.ts`) fails fast: `JWT_*_SECRET` min 32 chars, `DATABASE_URL`/`NEO4J_PASSWORD` required. Encryption key: `openssl rand -base64 32` → `GITHUB_TOKEN_ENCRYPTION_KEY` (dev fallback only, never prod).
- Data split: Postgres = source of truth; Neo4j = relationship edges only (`MEMBER_OF`, `PARTICIPATES_IN`, …), rebuildable from events; Redis keys prefixed `hmt:` (`hmt:cache:*`, `hmt:rl:*`, `hmt:auth:revoked:<jti>`, `hmt:tmp:*`).

## Constraints agents get wrong

- `fastify` pinned to `4.29.1` via `pnpm-workspace.yaml` + `package.json` overrides. Do **not** upgrade to v5 (breaks `@fastify/static`, `@fastify/cors`, `@nestjs/platform-fastify`).
- Strict TS: `noUncheckedIndexedAccess: true` + `exactOptionalPropertyTypes: true` (`tsconfig.base.json`) — index access yields `T|undefined`, optional props need explicit handling.
- API contract: everything versioned `/api/v1` with envelope `{version:"v1", data, meta}` / `{version:"v1", error:{code,message,requestId}}`; events carry `version:"v1"`. Health must distinguish deps: liveness `GET /health` returns `unknown` deps; readiness (`/health/ready`, `/health/readiness`) reports per-dep `ok|down` + `latencyMs`, `degraded` if any down (2s timeout per dep).
- Security invariants (enforced by `tests/production-readiness.test.ts`): GitHub integration is **read-only** (no `createCommit/push/merge/deleteBranch` — use `MockGitHubProvider` without creds); repo access is default-deny, leader-only grant/revoke (`packages/database/src/repository-access.ts`); auth is argon2id + 15m access / 7d rotating refresh with Redis revocation (`hmt:auth:revoked:*`); organizer blocks second-ADMIN self-registration (403); AI output is hint-only with secret redaction; never put secrets in `frontend/` (`VITE_*` public only) and never return raw email-verification/reset tokens in production.
- Frontend guards: no demo identity (`Kai Morales`/`demoUser`), no `localhost:3001` defaults, auth via `auth-context.tsx` + `api-config.ts` (`VITE_API_URL`, `VITE_ORGANIZER_API_URL`).
- Request plumbing both APIs already do: `x-request-id` propagation, CORS strict allowlist from `CORS_ORIGINS`, helmet-equivalent `onSend` headers. Don't reimplement; reuse `@hmt/config`, `@hmt/security`, `@hmt/observability` (no duplicate auth/hashing in apps — `foundation.test.ts` checks this).
