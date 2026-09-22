# HMT API Contract — Foundation

## 1. Versioning

- All APIs are `v1` (`/api/v1/...`). Breaking changes require new major `/api/v2/...` and dual publishing.
- Contracts carry `version: "v1"` field (from `packages/contracts/src/version.ts:1` `CONTRACT_VERSION`).
- Consumers must ignore unknown fields and check `version`.

## 2. Envelope

### 2.1 Success

```ts
// packages/contracts/src/api.ts:1 apiEnvelopeSchema
{
  version: "v1",
  data: T,
  meta?: {
    requestId: string,
    timestamp: string, // ISO
    pagination?: { page, pageSize, total, totalPages }
  }
}
```

### 2.2 Error

```ts
{
  version: "v1",
  error: {
    code: string, // e.g., BAD_REQUEST, UNAUTHORIZED, RATE_LIMITED
    message: string,
    details?: unknown, // validation issues, only non-500
    requestId?: string
  }
}
```

All errors include `x-request-id` header.

## 3. OpenAPI

- Participant: `@nestjs/swagger` at `/api/docs` and JSON at `/api/docs-json` (`apps/participant-api/src/main.ts:1`).
- Organizer: `@fastify/swagger` + `@fastify/swagger-ui` at `/api/docs` and `/api/docs-json` (`apps/organizer-api/src/main.ts:1`).
- Both expose `GET /`, `GET /api/v1`, `GET /api/v1/health`, `GET /api/v1/health/ready`, `GET /health`, etc.

## 4. Domain Events (Cross-Service Contracts)

File: `packages/contracts/src/events.ts:1`.

**These are the ONLY allowed cross-service contracts.** Participant backend must not query organizer DB.

| Event | Type | Payload fields |
|---|---|---|
| `HackathonPublished` | `HackathonPublished` | `hackathonId`, `slug`, `title`, `publishedAt`, `phases[]` |
| `HackathonUpdated` | `HackathonUpdated` | `hackathonId`, `updatedFields[]`, `updatedAt` |
| `HackathonPhaseChanged` | `HackathonPhaseChanged` | `hackathonId`, `previousPhaseId`, `newPhaseId`, `changedAt` |
| `TeamCreated` | `TeamCreated` | `teamId`, `hackathonId`, `name`, `leaderId`, `createdAt` |
| `TeamUpdated` | `TeamUpdated` | `teamId`, `hackathonId`, `updatedFields[]`, `updatedAt` |
| `MentorFeedbackSubmitted` | `MentorFeedbackSubmitted` | `feedbackId`, `teamId`, `projectId`, `mentorId`, `visibility`, `submittedAt` |
| `EvaluationPublished` | `EvaluationPublished` | `evaluationId`, `teamId`, `projectId`, `publishedAt` |
| `ParticipantStatusChanged` | `ParticipantStatusChanged` | `participantId`, `userId`, `hackathonId`, `previousStatus`, `newStatus`, `changedAt` |

Union validated via `domainEventSchema` (discriminated union on `type`). Each has:

```ts
{
  eventId: string,
  version: "v1",
  type: string,
  occurredAt: string, // ISO datetime
  actorId: string | null,
  payload: { ... }
}
```

Transport: future Redis Streams / Postgres outbox; foundation just defines shapes.

Validation: Zod schemas (`hackathonPublishedSchema` etc.) — strict.

## 5. Shared DTOs Example

- `healthResponseSchema` (`packages/contracts/src/api.ts:1`):

```ts
{
  status: "ok" | "degraded" | "down",
  service: string,
  version: string,
  uptimeSeconds: number,
  checks: { api, postgres, neo4j, redis }
}
```

## 6. Repository Access Abstraction (Not Yet GitHub Integration)

Future AI teammate will require `RepositoryAccessGrant`. Contract pre-defines:

```ts
RepositoryConnection { id, teamId, provider:"github", repositoryIdentifier, ownerUserId, createdAt }
RepositoryAccessGrant { id, connectionId, grantedById, grantedTo, grantedToUserId?, scope:READ|READ_WRITE, status, createdAt, revokedAt, auditInfo }
```

Default deny — see `packages/database/src/repository-access.ts:1`.

## 7. Rules for Future Business APIs

- Prefix: `/api/v1/<domain>` (e.g., `/api/v1/hackathons`, `/api/v1/teams`).
- DTOs must be Zod-validated, `strict()`.
- Never expose private fields in public GETs; filter by role in service.
- Audit all state-changing `POST/PATCH/DELETE`.
