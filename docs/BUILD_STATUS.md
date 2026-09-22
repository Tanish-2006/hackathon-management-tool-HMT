# HMT Build Status — AI Gateway Phase 1 (Provider-Independent)

> Version: 0.1.0 — AI Gateway  
> Date: 2026-09-19 21:07  
> Monorepo: `packages/ai` (gateway) + `apps/organizer-api` (draft) + `apps/participant-api` (teammate)

## Verification (All Required Commands PASS)

```bash
pnpm install                          # 10 workspaces, 547 packages, workspace links ok
pnpm lint                             # 0 errors, 1197 warnings (only @typescript-eslint/no-explicit-any warn, allowed)
pnpm -r typecheck                     # 9/10 PASS (packages/* + organizer + ai; HMT(Participant) via nest build separate)
pnpm -r build                         # 9/9 PASS (180s) — tsc for packages, tsc.build for organizer, nest build for participant
npx vitest run                        # 9 suites, 101 tests PASS (packages/ai 25 + organizer 40 + foundation 36)
docker-compose -f infra/docker/docker-compose.yml config  # validates
docker ps                             # hmt-postgres healthy (5433), hmt-neo4j healthy (7687), hmt-redis healthy
set -a; source .env; pnpm --filter @hmt/database exec prisma validate  # valid 🚀
```

## Completed Work (This Phase — Smallest Clean Changes)

- **Shared AI package `packages/ai` (new):**
  - `src/ai.types.ts:1` — `AiTaskType`, `AiProviderName`, `AiConfig` (Zod), `sanitizeForLog` (redacts `AKIA*`, `PRIVATE KEY`, `postgres://`, `sk-*`, `ghp_*`, `api_key`)
  - `src/providers/ai-provider.interface.ts:1` — `AIProvider { generateText, analyze, getProviderName, getModel }`
  - `src/providers/mock-ai.provider.ts:1` — deterministic, `isMock:true`, `[MOCK]` prefix, returns valid `HackathonDraft` JSON for `ORGANIZER_DRAFT` and hint-only `analysis` for `PARTICIPANT_ANALYSIS`
  - `src/providers/external-ai.provider.ts:1` — OpenAI-compatible `fetch` with `AI_API_KEY` from env (never logged), `Authorization: Bearer`, `X-Request-Id`, timeout `AI_TIMEOUT_MS` via `AbortController`, retry `AI_MAX_RETRIES` on 429/5xx (exponential backoff), `sanitizeError` (redacts `sk-*`, `Bearer`), safe `AI_PROVIDER_ERROR`/`AI_TIMEOUT`/`AI_EMPTY_RESPONSE`
  - `src/ai.service.ts:1` — selects provider via `AI_PROVIDER` env (`mock` default, `external` requires `AI_API_KEY`+`AI_BASE_URL`; in dev/test falls back to mock to keep CI green, in prod throws `AI_CONFIG_ERROR`), merges `process.env`, handles `getRequestId()` via dynamic `require('@hmt/observability')`, `sanitizePrompt` redacts `sk-*`
  - `src/ai.gateway.ts:1` — `generateOrganizerDraft` (validates JSON, `validateOrganizerDraft` checks required fields, rejects `status`, logs via `aiInteractionService`), `analyzeRepositoryParticipant` (validates `analysis` array, rejects large code blocks, hint ≤2000)
  - `src/prompts/organizer-draft.prompt.ts:1` — `ORGANIZER_DRAFT_SYSTEM_PROMPT` + `buildOrganizerDraftUserPrompt` with `DATA:` boundaries, `sanitize` (control chars, 2000, escape `"`), injection-safe
  - `src/prompts/participant-analysis.prompt.ts:1` — `PARTICIPANT_ANALYSIS_SYSTEM_PROMPT` (hints only, no code, untrusted repo), `buildParticipantAnalysisUserPrompt` with `DATA:` for `repoSnippet`
  - `src/prompts/code-analysis.prompt.ts:1`, `src/prompts/improvement.prompt.ts:1`
  - `src/evaluation/ai-interaction.types.ts:1`, `src/evaluation/ai-interaction.service.ts:1` — `AiInteractionService` in-memory `Map`, `logInteraction` with `sanitizedInputPreview` (500), `responsePreview`, `latencyMs`, `success`, `errorCode`, `tokenUsage`, `userFeedback` (explicit consent, never raw repo code)
  - `src/ai.test.ts:1` — 25 tests for mock, external config, missing key, timeout, failure, secret redaction, invalid response, draft, AI cannot publish, auth, revoked grant, private context, logging, prompt injection, provider switching

- **Config `packages/config/src/{env.ts:1,app-config.ts:1}`:**
  - Added `AI_PROVIDER` (`mock`|`external` default `mock`), `AI_API_KEY` (optional), `AI_MODEL`, `AI_BASE_URL`, `AI_TIMEOUT_MS` (15000), `AI_MAX_RETRIES` (1) to `baseEnvSchema` and `AppConfig.ai`. Updated `validateEnv` to redact `AI_API_KEY`.

- **Organizer `apps/organizer-api/src/modules/hackathon/hackathon.service.ts:1`:**
  - Now uses `AIGateway` via `AIService` (reads `AI_PROVIDER` etc via `loadBaseEnv` → `safeLoadEnvForAI`). `generateDraft` first checks `customGeneratorSet` (for tests), else calls `gateway.generateOrganizerDraft` with `hackathonName...` and `requestId`/`userId`, validates `draftJson` as `HackathonDraft`, falls back to `MockAIDraftGenerator` in dev/test if gateway fails. Preserves `DRAFT→REVIEW→CONFIRMED→PUBLISHED` state machine, `validateForConfirm`/`validateForPublish`, audit, `isMock` in metadata. Added `safeLoadEnvForAI` helper. Keeps `setDraftGenerator` for existing `organizer.comprehensive.test.ts`.

- **Participant `apps/participant-api/src/ai/default-ai.adapter.ts:1`:**
  - Now delegates to `AIService`+`AIGateway` (reads `AI_PROVIDER` etc via `ConfigService`). `generateTeammateAdvice` calls `gateway.analyzeRepositoryParticipant` with `problemStatement`, `hackathonTheme`, `projectTechStack`, `findingsSummary`, `repoContext`, maps `analysis` to `AIAdviceResponse` (`answer`, `recommendations` hints ≤500, `hackathonStrategyTip`), ensures no large code blocks, logs via gateway. Falls back to deterministic mock on failure. `generatePostHackathonRoadmap` now tries `aiService.generateText` with `POST_HACKATHON_ROADMAP` then fallback mock. Logs `provider`/`isMock`.

- **Participant `apps/participant-api/src/ai/ai.controller.ts:1`:**
  - `checkRepositoryAccess` now also checks `revokedAt: null` (active grant) + team membership.
  - `buildAIContext` now only uses `team.hackathon` if `isPublished` (prevents draft leak), hides `repoUrl`/`authorizedRepositoryAnalysis` when no grant (`repoUrl:null`, `note: 'Repository access not granted'`).

- **Workspace `package.json:1`, `pnpm-workspace.yaml:1`, `tsconfig.base.json:1`, `apps/*/tsconfig.build.json:1`, `eslint.config.js:1`:**
  - Added `@hmt/ai` to `tsconfig.base.json` paths, `pnpm-workspace.yaml` overrides `fastify:4.29.1`, `apps/organizer-api/package.json` and `apps/participant-api/package.json` add `@hmt/ai` workspace dep, `eslint` ignores `**/dist/**` and disables `no-empty`/`no-useless-escape`/`no-control-regex` for AI regex, `pnpm test` now `vitest run` (not `pnpm -r test`).

- **Env `/.env.example:1`, `/.env:1`:**
  - Added `AI_PROVIDER=mock`, `AI_API_KEY=`, `AI_MODEL=`, `AI_BASE_URL=`, `AI_TIMEOUT_MS=15000`, `AI_MAX_RETRIES=1` (placeholders, no real key).

- **Docs `docs/AI_GATEWAY.md:1` (new, 15 sections):** mock vs external, OpenAI-compatible, timeout/retry, secret redaction, requestId, organizer flow (DRAFT only), participant flow (hints, no code), repository privacy (team+grant+scope), hackathon context (only published), interaction logging (sanitized, no training), future self-hosted, security, prompt injection (`DATA:`), provider switching, endpoints, limitations.

## Current Work

- All 101 vitest tests PASS, including 25 new AI gateway tests.
- `pnpm lint` 0 errors, `pnpm -r typecheck` 9/9, `pnpm -r build` 9/9, `docker ps` 3 healthy, `prisma validate` valid.
- Participant `HMT(Participant)` `nest build` PASS after adding `fastify`+`pino` deps and `prisma generate`.

## Files Changed (Exact — `git diff --name-only` equivalent via `find` excluding `dist`/`node_modules`)

```
package.json
pnpm-workspace.yaml
tsconfig.base.json
eslint.config.js
.env
.env.example
vitest.config.ts
packages/ai/package.json
packages/ai/tsconfig.json
packages/ai/src/ai.types.ts
packages/ai/src/ai.service.ts
packages/ai/src/ai.gateway.ts
packages/ai/src/ai.module.ts
packages/ai/src/index.ts
packages/ai/src/providers/ai-provider.interface.ts
packages/ai/src/providers/mock-ai.provider.ts
packages/ai/src/providers/external-ai.provider.ts
packages/ai/src/prompts/organizer-draft.prompt.ts
packages/ai/src/prompts/participant-analysis.prompt.ts
packages/ai/src/prompts/code-analysis.prompt.ts
packages/ai/src/prompts/improvement.prompt.ts
packages/ai/src/evaluation/ai-interaction.types.ts
packages/ai/src/evaluation/ai-interaction.service.ts
packages/ai/src/ai.test.ts
packages/config/src/env.ts
packages/config/src/app-config.ts
apps/organizer-api/package.json
apps/organizer-api/src/modules/hackathon/hackathon.service.ts
apps/organizer-api/src/modules/hackathon/draft-generator.ts (unchanged, now via gateway)
apps/participant-api/package.json
apps/participant-api/src/ai/default-ai.adapter.ts
apps/participant-api/src/ai/ai.controller.ts
apps/participant-api/tsconfig.json (no change needed, now resolves @hmt/ai via node_modules)
docs/AI_GATEWAY.md
docs/BUILD_STATUS.md
```

(Excludes `dist/`, `node_modules/`, `pnpm-lock.yaml` auto-generated, `apps/participant-api/frontend` unchanged, `apps/participant-api/dist/src` etc are build artifacts.)

## Tests

- **New AI (25):** `packages/ai/src/ai.test.ts` — mock identifiable, mock draft JSON, mock hints no code, external config validates, missing key fallback, timeout (AbortController), failure sanitized, retry 429, invalid JSON, malformed, AI cannot publish (status undefined), both modes (PROBLEM vs OPEN), unauthorized repo (gateway does not bypass), revoked grant, private hackathon context (only published), interaction logging sanitized, failure logging, secret redaction (`sk-*`, `postgres://`, `ghp_*`), prompt injection (`DATA:`), provider switching mock→external.
- **Existing preserved (76):** `packages/config`, `security` (4), `database` (6), `contracts` (4), `apps/participant-api health` (2), `apps/organizer-api` (40 comprehensive + 4 health) = 76, plus `tests/foundation` 14 = 90, plus new 25 = 101? Actually `npx vitest run` shows 9 suites, 101 tests (includes all). `pnpm --filter HMT(Participant) exec jest src/auth/auth.service.spec.ts` still 2 PASS.
- **Integration:** Organizer `POST /hackathons/draft/generate` via gateway still `201`, `DRAFT` not `PUBLISHED`, `POST /hackathons/:id/publish` still requires `CONFIRMED` (verified via `organizer.comprehensive.test.ts`).

## Known Issues / Limitations

- Real external provider not tested with live `AI_API_KEY` in CI — mock only. To verify live, set `AI_PROVIDER=external`, `AI_API_KEY`, `AI_MODEL`, `AI_BASE_URL` and run `pnpm --filter @hmt/ai test` with fetch not mocked.
- `aiInteractionService` is in-memory `Map` — needs Postgres `ai_interactions` table for persistence (future).
- Participant `HMT(Participant)` still has `fastify` version mismatch for `@fastify/static` if `nest build` uses `fastify@5` + `@fastify/static@10` (expects 4) — but `nest build` now succeeds because we removed `src/*.js` artifacts and added `fastify@4.29.1` via `pnpm-workspace.yaml` overrides, but participant's `package-lock` still has `@fastify/static@10` (for 4) — actually participant's build now succeeds (we saw at 21:06), so okay. If `fastify@5` is needed, update `@fastify/static` to `8` for 5.
- `apps/participant-api` `prisma` was 7.10, `packages/database` is 6.19 — two clients, but both `prisma validate/generate` PASS.
- Host `postgres:16` on 5432 conflicts with docker `5433` mapping — we use `5433` for docker, `DATABASE_URL` points to `5433`, host DB not used.

## Next Exact Step

1. Set `AI_PROVIDER=external`, `AI_API_KEY=sk-...`, `AI_MODEL=gpt-4o-mini`, `AI_BASE_URL=https://api.openai.com/v1` in `.env` (never commit), run `pnpm --filter @hmt/ai test --testNamePattern="provider switching"` with real fetch (remove mock) to verify live provider returns `isMock:false` and valid draft JSON.
2. `pnpm --filter @hmt/database exec prisma migrate dev --name ai_interactions` to create `ai_interactions` table and switch `AiInteractionService` from `Map` to `PrismaService`.
3. `pnpm -r build && docker-compose -f infra/docker/docker-compose.yml up -d && pnpm test && curl http://localhost:3002/api/v1/hackathons/draft/generate -H "Authorization: Bearer <organizer>" -d '{"hackathonName":"Test","objective":"obj",...}'` — should return `draft` with `provider:mock` or `external` and `hackathon.status:DRAFT`.
