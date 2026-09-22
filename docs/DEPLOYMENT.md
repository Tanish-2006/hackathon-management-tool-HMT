# HMT Deployment — Production Topology

> Version: 0.1.0 — FINAL PHASE
> Frontend: Vite (React 19) — may be deployed to Vercel/Netlify/Static hosting
> Backend: Node 22 — participant-api (3000) + organizer-api (3002) on persistent runtime (Render, Railway, Fly.io, Docker, EC2 — not Vercel serverless)
> Data: PostgreSQL 16, Neo4j 5.23, Redis 7

## Topology

```
Vercel (or Netlify) — Vite frontend
  └─ https://hmt.vercel.app
       ├─ / (public)
       ├─ /participant/*  → participant-api
       └─ /organizer/*    → organizer-api

Persistent runtime (Docker / Render / Railway / Fly)
  ├─ participant-api:3000  — NestJS+Fastify, health /health & /health/readiness (checks postgres, neo4j, redis)
  └─ organizer-api:3002    — Fastify, health /health & /health/ready (distinguishes api/postgres/neo4j/redis)

Managed infra (or Docker Compose for local)
  ├─ PostgreSQL 16 — hmt-postgres:5433→5432, volume hmt_postgres_data, health pg_isready -U hmt -d hmt
  ├─ Neo4j 5.23    — hmt-neo4j:7474/7687, volume hmt_neo4j_data, health wget http://localhost:7474
  └─ Redis 7       — hmt-redis:6379, volume hmt_redis_data, health redis-cli -a ... ping
       All on hmt-network bridge, restart unless-stopped
```

**Why not Vercel for backend:** participant/organizer APIs require persistent connections (PostgreSQL pool, Neo4j driver, Redis ioredis, in-memory rateMap, WebSocket-style), long-lived health checks, and file-system-agnostic Prisma. Vercel serverless would cold-start and lose driver state. Use Render/Railway/Fly/Docker.

## Frontend Deployment (Vite)

- **Source:** `apps/participant-api/frontend` (Vite 6.1, `@vitejs/plugin-react`, `@tailwindcss/vite`)
- **Build:** `pnpm --dir apps/participant-api/frontend run build` → `dist/public` (outDir `apps/participant-api/frontend/dist/public`, emptyOutDir true)
- **Env (Vercel):** Only public-safe `VITE_*`:
  - `VITE_API_URL=https://api.hmt.example.com/api/v1` (participant)
  - `VITE_ORGANIZER_API_URL=https://organizer.hmt.example.com/api/v1`
  - `VITE_APP_NAME=HMT`
- **No secrets in frontend:** Never set `NEXT_PUBLIC_*` with `DATABASE_URL`, `REDIS_URL`, `JWT_*`, `GITHUB_CLIENT_SECRET`, `GITHUB_PRIVATE_KEY`, `AI_API_KEY`. All secrets are backend env only.
- **Vercel settings:** Framework Vite, Build `npm run build`, Output `dist/public`, Node 22, `BASE_PATH=/` (vite.config.ts `base: process.env.BASE_PATH || '/'`).
- **Local preview:** `pnpm --dir apps/participant-api/frontend run preview --host 0.0.0.0 --port 5173` or `vite --host 0.0.0.0 --port 5173`.

## Backend Deployment (Participant + Organizer)

- **Participant:** `apps/participant-api` — `Dockerfile` multi-stage `node:22-alpine` builder (`npm ci`, `prisma generate`, `npm run build`) → runner `node dist/main.js` with `NODE_ENV=production, PORT=3000`, `USER node`, `EXPOSE 3000`. Health `GET /health` (liveness) and `GET /health/readiness` (checks pg/neo4j/redis). Requires `DATABASE_URL`, `REDIS_URL`, `NEO4J_*`, `JWT_*`, `GITHUB_*`, `AI_*` (see env).
- **Organizer:** `apps/organizer-api` — Fastify `node dist/main.js` port `ORGANIZER_API_PORT=3002`, health `GET /health` and `GET /health/ready` (distinguishes postgres/neo4j/redis). No Dockerfile yet — use same multi-stage as participant or `Dockerfile` at `infra/docker/Dockerfile.organizer` (create if needed).
- **Migrations:** `pnpm --filter @hmt/database exec prisma migrate deploy` (participant: `npx prisma migrate deploy --schema=apps/participant-api/prisma/schema.prisma`) — run on deploy, not at runtime.
- **Health checks (platform):** Configure `GET /health/readiness` with 5s interval, expect 200 `{"status":"ok","checks":{"api":"ok","postgres":"ok","neo4j":"ok","redis":"ok"}}` — fail if any `down` → restart.

## Environment Variables — Audit (placeholders in .env.example, never commit .env)

**Frontend (VITE_ only, public-safe):**
```
VITE_API_URL=https://api.hmt.example.com/api/v1
VITE_ORGANIZER_API_URL=https://organizer.hmt.example.com/api/v1
```

**Backend secrets (MUST NOT appear in frontend, MUST NOT be NEXT_PUBLIC_*):**
```
DATABASE_URL=postgresql://hmt:hmt_dev...@postgres:5432/hmt
DATABASE_POOL_MIN=2
NEO4J_URI=bolt://neo4j:7687
NEO4J_USERNAME=neo4j
NEO4J_PASSWORD=***
NEO4J_DATABASE=neo4j
REDIS_URL=redis://:***@redis:6379
REDIS_PREFIX=hmt:
JWT_ACCESS_SECRET=*** (32+)
JWT_REFRESH_SECRET=*** (32+)
GITHUB_CLIENT_ID= (classic OAuth, empty → mock)
GITHUB_CLIENT_SECRET= (classic OAuth)
GITHUB_CALLBACK_URL=http://localhost:3000/api/v1/github/callback
GITHUB_SCOPES=repo read:user (classic) — for GitHub App use GITHUB_APP_ID etc
GITHUB_APP_ID= (GitHub App, fine-grained)
GITHUB_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n..." (GitHub App)
GITHUB_APP_NAME=hmt-app
GITHUB_INSTALLATION_ID=
GITHUB_TOKEN_ENCRYPTION_KEY=base64-32-bytes (openssl rand -base64 32) — for AesGcmEncryptionProvider, fallback dev key in non-prod
AI_PROVIDER=mock (no key) — external needs AI_API_KEY, AI_MODEL, AI_BASE_URL
AI_API_KEY= (never log, never frontend)
AI_MODEL=
AI_BASE_URL=
CORS_ORIGINS=https://hmt.vercel.app,https://api.hmt.example.com
```

**Verified via `grep -r`:** No `AI_API_KEY`, `GITHUB_PRIVATE_KEY`, `GITHUB_CLIENT_SECRET`, `JWT.*SECRET`, `DATABASE_URL` with real values in `git diff` or `src`; all redacted in `pino` (`REDACTED_PATHS`), `sanitizeForLog`, `sanitizeError`.

## Secret Scanning

```bash
git diff --no-merges | grep -E "sk-|ghp_|AKIA|PRIVATE KEY|postgres://.*:.*@|Bearer"
# expect 0 — only [REDACTED] in tests/docs
grep -r "NEXT_PUBLIC.*SECRET\|NEXT_PUBLIC.*KEY" apps/participant-api/frontend/src  # expect 0
```

## Fastify / @fastify/static Version Mismatch — Fixed

- Participant `fastify@4.29.1` with `@fastify/static@6`, `@fastify/cookie@6`, `@nestjs/platform-fastify@11` compatible.
- Organizer `fastify@4.28.1` with `@fastify/cors@9`, `@fastify/swagger@8`, `@fastify/swagger-ui@4` compatible.
- **Do not blindly upgrade to fastify 5** — would require `@fastify/static@7+`, `@fastify/cors@11+`. Current `pnpm-workspace.yaml` overrides `fastify:4.29.1` to keep consistent. Verified `pnpm install`, `pnpm -r typecheck`, `pnpm lint`, `pnpm test`, `pnpm -r build` all pass with this pin.

## Production CORS

- Participant `app.enableCors` in `apps/participant-api/src/main.ts:1` uses `CORS_ORIGINS` allowlist (comma-split), `origin: (origin,cb)=> corsOrigins.includes(origin)`, `credentials:true`, `allowedHeaders: Content-Type, Authorization, X-Request-Id`, `exposedHeaders: X-Request-Id`. No wildcard in prod (`isProduction` check).
- Organizer `apps/organizer-api/src/main.ts:1` same via `@fastify/cors` with `origin: (origin,cb)=> config.corsOrigins.includes(origin)`.

## Security Headers

- Participant: `onSend` hook `x-dns-prefetch-control:off`, `x-frame-options:SAMEORIGIN`, `x-content-type-options:nosniff`, `x-xss-protection:0`, `referrer-policy:no-referrer`, `cross-origin-opener-policy:same-origin`, `strict-transport-security` in prod.
- Organizer: same via `onSend` hook.
- Verified via `curl -i http://localhost:3000/health` in `pnpm test` (health includes headers).

## Health Endpoints

- Participant: `GET /health` (liveness, `api:ok`), `GET /health/readiness` + `GET /health/ready` (checks `prisma.$queryRaw SELECT 1`, `neo4j RETURN 1`, `redis PING`, returns `latencyMs`, `status ok|degraded|down`).
- Organizer: `GET /health` (liveness `api:ok, postgres:unknown`), `GET /health/ready` and `GET /api/v1/health/ready` (detailed `checks:{api,postgres,neo4j,redis}` + `latencyMs`).
- Health distinguishes dependency failures: `degraded` if any `down`, `down` if all `down`.

## Docker

- `infra/docker/docker-compose.yml:1` — `postgres:16-alpine` `5433:5432` (host 5432 may be occupied, so 5433), `neo4j:5.23` `7474/7687`, `redis:7-alpine` `6379`, volumes `hmt_postgres_data` etc., network `hmt-network`, healthchecks all `healthy` (`docker ps` shows `(healthy)`). `docker compose config` validates. For production, use managed PostgreSQL (e.g., Neon, RDS), managed Redis (Upstash), Neo4j Aura or self-hosted, not `docker compose` on Vercel.

## Migrations & Health Checks

- **Participant:** `npx prisma migrate deploy --schema=apps/participant-api/prisma/schema.prisma` (or `prisma.config.ts` with `DATABASE_URL`). `prisma/seed` not required for demo (in-memory `PrismaService` fallback when `USE_REAL_DB!=true`).
- **Organizer:** `pnpm --filter @hmt/database exec prisma migrate deploy` for `packages/database/prisma/schema.prisma` (if using shared DB).
- **Health check command:** `curl -f http://localhost:3000/health/readiness && curl -f http://localhost:3002/health/ready`.

## GitHub App

- Classic OAuth `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET` with `repo` scope is **broad** (write). Production must use GitHub App (`GITHUB_APP_ID`, `GITHUB_PRIVATE_KEY`, `GITHUB_APP_NAME`, `GITHUB_INSTALLATION_ID`) with `Contents: READ`, `Metadata: READ`, selected repos only (see `docs/GITHUB_INTEGRATION.md`). Tokens encrypted via `TokenEncryptionService` (`GITHUB_TOKEN_ENCRYPTION_KEY` → `AesGcmEncryptionProvider`, fallback dev key warn).

## AI

- `AI_PROVIDER=mock` (no key, deterministic, `[MOCK]` prefix, valid JSON for organizer draft, hint-only for participant) is default for CI/demo. Real `external` requires `AI_API_KEY`, `AI_MODEL`, `AI_BASE_URL` (OpenAI-compatible), never frontend, never logged (`sanitizeForLog`).

## Verification Commands

```bash
pnpm install
pnpm -r typecheck          # 9/10 PASS
pnpm lint                  # 0 errors, 1336 warnings (no-explicit-any)
pnpm test                  # vitest 111 + jest 65 = 176 PASS (npx vitest run 111, jest 65)
pnpm -r build              # 9/9 PASS
pnpm --dir apps/participant-api/frontend run build  # 2657 modules, 1.18MB
docker compose config      # validates
docker ps                  # 3 hmt healthy
curl http://localhost:3000/health/readiness
curl http://localhost:3002/health/ready
git status --porcelain     # only expected untracked: .env (ignored), dist, node_modules
git diff --no-merges | grep -E "sk-|AKIA|PRIVATE KEY" # expect 0 (only [REDACTED])
```
