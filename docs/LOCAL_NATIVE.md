# HMT Local Development Without Docker (Windows)

> Scope: run the HMT stack on Windows with **no Docker runtime dependency**.
> Docker files (`infra/docker/docker-compose.yml`, Dockerfiles) are kept intact
> for deployment/recovery. Nothing below uninstalls Docker, deletes volumes,
> or touches existing data.

## Key fact: databases are optional for local development

Both APIs run **fully in-memory by default** (`USE_REAL_DB` unset). PostgreSQL,
Redis, and Neo4j are currently used only by the **readiness probes**
(`GET /health/ready` reports `unknown`/`degraded` without them); liveness
(`GET /health`), discovery, registration, teams, sync, and AI flows all work
without any database process running. This was verified end-to-end with zero
database processes on Windows Server 2022.

So the minimal native setup is: **Node.js + pnpm only**. Install the databases
below only if you want green readiness checks or are preparing persistence work.

## 0. Prerequisite: Node.js + pnpm

```powershell
node --version   # need >= 20 (repo .nvmrc pins 22; engines allow >= 20)
corepack enable
corepack prepare pnpm@9.12.3 --activate
pnpm --version   # expect 9.12.3
```

## 1. Install and start the workspace (no databases needed)

```powershell
cd C:\Users\mysterysd\Documents\HMTRepo
pnpm install
pnpm -r typecheck
pnpm -r build
# Option A — both backends together (uses root dev:backend script):
pnpm dev:backend
# Option B — separately:
# participant API :3000
#   cd apps/participant-api; $env:PORT='3000'; node dist/src/main.js
# organizer API :3002
#   cd apps/organizer-api; npx tsx src/main.ts
# Frontend :5173 (Vite dev; for daily use prefer the production build — see note)
pnpm dev:frontend
```

Health expectations **without databases**:

```powershell
curl.exe -s http://localhost:3002/health                 # {"status":"ok",...}
curl.exe -s http://localhost:3000/api/v1/health          # {"status":"ok",...}
curl.exe -s http://localhost:3000/api/v1/health/readiness
# -> checks.postgres/neo4j/redis are "unknown" or "down", status degraded/down.
#    This is NORMAL without local databases and does not block any feature.
```

> Performance note (measured Oct 2026, same machine): with Vite **dev** the site
> feels laggy because dev serves ~hundreds of unbundled modules. For daily use,
> serve the production build instead:
>
> ```powershell
> pnpm --dir apps/participant-api/frontend run build
> pnpm --dir apps/participant-api/frontend run preview --port 5173
> ```
>
> Measured API latencies (local, p50): discover 1.9ms, detail ~2ms,
> current/team/project/timeline/AI-status ~1–2ms, login (argon2) ~31ms.
> No backend optimization was needed; the two frontend fixes were removing a
> sequential per-hackathon AI-status loop (now `Promise.all`) and skipping the
> dashboard timeline fetch until registered.

## 2. Optional native databases (only for green readiness)

Keep the compose port conventions. Compose maps Postgres as `5433:5432`
(host 5433 avoids clashes); a **native** Postgres listens on **5432** by
default — point `DATABASE_URL` at whichever you run (examples below).

### 2a. PostgreSQL 16 (native)

- Install: download the EDB installer for PostgreSQL 16
  (https://www.postgresql.org/download/windows/), remember the `postgres`
  superuser password. No winget/WSL required.
- Create the dev database/user (run in "SQL Shell (psql)" or pgAdmin):

```sql
CREATE USER hmt WITH PASSWORD 'hmt_dev_password_change_in_prod';
CREATE DATABASE hmt OWNER hmt;
```

- Start/stop: `services.msc` → `postgresql-x64-16` (set to Manual if you want
  it off by default; this is also how you keep it from consuming resources).
- Connectivity check (no data touched):

```powershell
$env:PGPASSWORD='hmt_dev_password_change_in_prod'
psql -h localhost -p 5432 -U hmt -d hmt -c 'SELECT 1;'
```

- Wire it (native port 5432, NOT the compose host port 5433):

```powershell
$env:DATABASE_URL='postgresql://hmt:hmt_dev_password_change_in_prod@localhost:5432/hmt?schema=public'
```

### 2b. Redis 7 (native)

There is no official Windows Redis build. Pick one:

- **Memurai Developer** (free, native Windows port): install from
  https://www.memurai.com, default port 6379. If you set a password, mirror
  the compose convention (`hmt_redis_password`).
- **Or WSL2 Ubuntu** (if WSL is available): `sudo apt install redis-server`
  then `sudo service redis-server start`.

Connectivity check:

```powershell
redis-cli -a hmt_redis_password ping   # expect PONG (omit -a if no password)
```

Wire it:

```powershell
$env:REDIS_URL='redis://:hmt_redis_password@localhost:6379'
$env:REDIS_PREFIX='hmt:'
```

### 2c. Neo4j 5 (native)

- Install Java 17+ (https://adoptium.net), then **Neo4j Desktop**
  (https://neo4j.com/download/) and create a DBMS with password
  `hmt_neo4j_password` (compose convention), Bolt port **7687**; or unzip a
  Neo4j 5.23 tarball and run `bin\neo4j console`.
- Connectivity check (Browser at http://localhost:7474, or via API readiness
  below).

Wire it:

```powershell
$env:NEO4J_URI='bolt://localhost:7687'
$env:NEO4J_USERNAME='neo4j'
$env:NEO4J_PASSWORD='hmt_neo4j_password'
$env:NEO4J_DATABASE='neo4j'
```

## 3. Verify databases are picked up (read-only checks)

With the env vars set (same shell), restart the two APIs and check readiness:

```powershell
curl.exe -s http://localhost:3000/api/v1/health/readiness
curl.exe -s http://localhost:3002/health/ready
# expect checks.postgres/neo4j/redis = "ok" with latencyMs
```

No migrations are run by these steps (`packages/database/prisma/migrations`
does not exist yet; the apps serve from memory). **Never run
`docker compose down -v`, volume/image pruning, or database resets.**

## 4. What was NOT done here

- Docker was not uninstalled; no images, containers, or volumes were removed.
- Native PostgreSQL/Redis/Neo4j were **not installed** in this session (this
  machine has no winget/admin-download path set up, and the stack was proven
  to run without them). Follow sections 2a–2c on your machine; section 3
  tells you how to confirm.
- Ports kept: participant **:3000**, organizer **:3002**, frontend **:5173**,
  native Postgres **:5432** (compose host port 5433 only applies to Docker).
