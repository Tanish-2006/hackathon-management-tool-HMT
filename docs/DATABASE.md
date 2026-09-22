# HMT Database Foundation

## 1. Store Responsibilities

| Store | Role | Data |
|---|---|---|
| **PostgreSQL** (Prisma) | Primary transactional source of truth | All entities, constraints, indexes, audit logs, sessions, grants |
| **Neo4j** | Relationship / knowledge graph | Edges: `MEMBER_OF`, `PARTICIPATES_IN`, `HAS_SKILL`, `SIMILAR_TO`; minimal props |
| **Redis** | Cache, rate limiting, queues, tmp state | `hmt:cache:*`, `hmt:rl:*`, `hmt:auth:revoked:*`, `hmt:queue:*`, `hmt:tmp:*` |

Never duplicate entire relational state into Neo4j; only relationships + IDs needed for traversals. Sync via domain events (e.g., `TeamCreated`).

## 2. PostgreSQL Schema (Prisma)

File: `packages/database/prisma/schema.prisma:1`.

### 2.1 Enums

- `Role` : `PARTICIPANT`, `ORGANIZER`, `MENTOR`, `ADMIN`
- `HackathonStatus` : `DRAFT`, `PUBLISHED`, `ARCHIVED`
- `PhaseStatus` : `UPCOMING`, `ACTIVE`, `COMPLETED`
- `TeamRole` : `LEADER`, `MEMBER`
- `ProjectVisibility` : `TEAM_PRIVATE`, `MENTOR_VISIBLE`, `PUBLIC`
- `RepositoryAccessScope` : `READ`, `READ_WRITE`
- `GrantStatus` : `ACTIVE`, `REVOKED`, `EXPIRED`

### 2.2 Tables

**users** — `id cuid PK`, `email unique`, `password_hash`, `role`, `display_name`, `is_active`, `email_verified`, `created_at`, `updated_at` — indexes on `email`, `role`.

**sessions** — `id cuid PK`, `user_id FK users cascade`, `refresh_token_hash`, `jti unique` (reuse detection), `token_version`, `device_info`, `ip_address`, `user_agent`, `expires_at`, `revoked_at`, `created_at`, `last_used_at` — indexes on `userId`, `expiresAt`.

**hackathons** — `id cuid`, `slug unique`, `title`, `description text`, `status`, `starts_at`, `ends_at`, `published_at`, `created_by_id`, `created_at`, `updated_at` — indexes on `status`, `slug`.

**phases** — `id cuid`, `hackathon_id FK cascade`, `name`, `description text`, `order int`, `status`, `starts_at`, `ends_at` — unique `(hackathonId, order)`, indexes on `hackathonId`, `status`.

**problem_statements** — `id cuid`, `hackathon_id FK cascade`, `title`, `description text`, `category`.

**resources** — `id cuid`, `hackathon_id FK cascade`, `title`, `url`, `type`.

**participants / organizers / mentors** — 1-1 with `users` (`user_id unique FK cascade`), plus domain fields (bio, skills, expertise).

**teams** — `id cuid`, `hackathon_id FK cascade`, `name`, `description text`, `invite_code unique` — unique `(hackathonId, name)`, index on `hackathonId`.

**team_members** — `id cuid`, `team_id FK cascade`, `user_id FK cascade`, `role`, `joined_at` — unique `(teamId, userId)`, indexes on `teamId`, `userId`.

**projects** — `id cuid`, `team_id FK cascade`, `title`, `description text`, `visibility`, `repo_url`, `demo_url` — index on `teamId`.

**repository_connections** — `id cuid`, `team_id FK cascade`, `provider` (default github), `repository_identifier`, `owner_user_id`, `created_at`, `updated_at` — unique `(provider, repositoryIdentifier)`.

**repository_access_grants** — `id cuid`, `connection_id FK cascade`, `granted_by_id FK Restrict`, `granted_to` (string id, e.g., `hmt-ai-teammate`), `granted_to_user_id FK SetNull`, `scope`, `status`, `created_at`, `revoked_at`, `revoked_by_id`, `expires_at`, `audit_info Json` — indexes on `connectionId`, `grantedById`, `status`.

**audit_logs** — append-only: `id cuid`, `timestamp`, `actor_id FK SetNull`, `actor_role`, `action`, `resource_type`, `resource_id`, `outcome`, `ip`, `user_agent`, `requestId`, `metadata Json`, `created_at` — indexes on `actorId`, `action`, `(resourceType, resourceId)`, `timestamp`.

### 2.3 Constraints & Indexes Philosophy

- All FKs have `onDelete` semantics (Cascade for owned entities, Restrict/SetNull for grants/audit).
- Unique constraints prevent duplicates (`email`, `slug`, `(hackathonId, order)`, `(teamId, userId)`).
- Indexes on hot query paths (status, hackathonId, userId).

## 3. Neo4j Graph Model

Driver: `neo4j-driver` 5, helper in `packages/database/src/neo4j.ts:1`.

### 3.1 Init Cypher (idempotent)

```cypher
CREATE CONSTRAINT user_id IF NOT EXISTS FOR (u:User) REQUIRE u.id IS UNIQUE;
CREATE CONSTRAINT hackathon_id IF NOT EXISTS FOR (h:Hackathon) REQUIRE h.id IS UNIQUE;
CREATE CONSTRAINT team_id IF NOT EXISTS FOR (t:Team) REQUIRE t.id IS UNIQUE;
CREATE CONSTRAINT project_id IF NOT EXISTS FOR (p:Project) REQUIRE p.id IS UNIQUE;
CREATE INDEX skill_name IF NOT EXISTS FOR (s:Skill) ON (s.name);
```

### 3.2 Node Labels & Relationships

- Nodes: `(:User {id,email,role})`, `(:Hackathon {id,slug,title})`, `(:Team {id,name})`, `(:Project {id,title})`, `(:Skill {name})`, `(:ProblemStatement {id})`
- Relationships:
  - `(User)-[:MEMBER_OF {role: LEADER|MEMBER, joinedAt}]->(Team)`
  - `(Team)-[:PARTICIPATES_IN]->(Hackathon)`
  - `(User)-[:HAS_SKILL]->(Skill)`
  - `(Team)-[:WORKS_ON]->(Project)`
  - `(User)-[:MENTORS {hackathonId}]->(Team)`
  - `(Project)-[:SIMILAR_TO {score}]->(ProblemStatement)` (future AI)

Write via background job on domain events; reads for "find teammates with skill X", "recommend problem statements".

### 3.3 Responsibility Split

Postgres owns entities + transactions; Neo4j owns traversals. If Neo4j is down, Postgres remains authoritative; graph can be rebuilt from events.

## 4. Redis Conventions

Client via `ioredis` (`packages/database/src/redis.ts:1`).

- Prefix: `hmt:` (configurable `REDIS_PREFIX`).
- Keys:
  - `hmt:cache:<domain>:<id>` — memoization, TTL seconds..hours.
  - `hmt:rl:<ip|userId>:<route>` — rate limit counters (`INCR` + `EXPIRE`).
  - `hmt:auth:revoked:<jti>` — revoked refresh JTI, TTL = `JWT_REFRESH_TTL_SECONDS`.
  - `hmt:auth:session:<sessionId>` — session metadata.
  - `hmt:queue:<name>` — BullMQ future.
  - `hmt:tmp:<id>` — temp state (e.g., invite token), short TTL.
- `REDIS_KEYS` helpers provide typed keys.

## 5. Migrations

- Prisma migrations will live in `packages/database/prisma/migrations/` (not yet generated; `pnpm --filter @hmt/database prisma:migrate` will create).
- Neo4j constraints are applied at startup via `NEO4J_INIT_CYPHER`.

## 6. Repository Access Abstraction

See `packages/database/src/repository-access.ts:1` `canAccessRepository`. Policy: default deny, active grants only, `READ_WRITE` requires exact scope, expiration checked.

## 7. Health Checks

- `checkPostgresHealth` (`$queryRaw SELECT 1`) — `packages/database/src/postgres.ts:1`
- `checkNeo4jHealth` (`RETURN 1`) — `packages/database/src/neo4j.ts:1`
- `checkRedisHealth` (`PING`) — `packages/database/src/redis.ts:1`

All return `{ ok, latencyMs, error }` and feed readiness endpoint.
