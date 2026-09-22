# HMT Privacy Foundation

## 1. Privacy Scopes

| Scope | Who can access | Typical data |
|---|---|---|
| **PUBLIC** | Anyone (no auth) | Published hackathon title, slug, description, public phases, public resources |
| **PARTICIPANT** | Any authenticated user | List published hackathons, public themes |
| **TEAM_MEMBER** | Members of team + allowlisted roles | Team-private project details, repo URL (if shared), internal discussion |
| **TEAM_LEADER** | Leader only (+ ADMIN) | Invite codes, repository grants (`RepositoryAccessGrant`), team settings |
| **MENTOR** | Assigned mentor + ORGANIZER/ADMIN | Mentor-private notes (immutable drafts before publish), feedback strengths/weaknesses |
| **ORGANIZER** | Organizer of hackathon + ADMIN | Organizer-private data: DRAFT/REVIEW hackathons, analytics, participant roster (redacted private fields) |
| **ADMIN** | ADMIN only | All data, audit logs, account management |

Scopes map to minimum roles (`packages/security/src/rbac.ts:1` `canAccessScope`):

```
PUBLIC -> PARTICIPANT (always allowed)
PARTICIPANT -> PARTICIPANT
TEAM_MEMBER/C_LEADER -> PARTICIPANT (+ ownership check)
MENTOR -> MENTOR
ORGANIZER -> ORGANIZER
ADMIN -> ADMIN
```

## 2. Authorization Boundaries

### 2.1 Team-Private Information
- Projects default `visibility=TEAM_PRIVATE` (`ProjectVisibility` in Prisma).
- Only `isTeamMember({ userId, teamMemberIds })` may read. Organizer/Mentor see only if project set `MENTOR_VISIBLE` or `PUBLIC`.
- Example: `POST /teams/:id/projects` checks `isTeamMember` or `isTeamLeader`.

### 2.2 Repository-Private Information
- Repo URL is team-private until explicitly shared via `RepositoryConnection` grant.
- Default `scope=READ` denied. Leader must create `RepositoryAccessGrant` (`grantedById=leader`, `grantedTo=ai_teammate`, `scope`) — see `docs/DATABASE.md:1`.
- Never expose `repoUrl` in public `GET /hackathons` — filter in service layer.

### 2.3 Mentor-Private Notes
- `MentorFeedback.version` chain: `MENTOR_SUBMITTED` → `ORGANIZER_REVIEWED` → `PUBLISHED`.
- Mentor-private notes (`recommendation`, `technicalFeedback`) visible to `MENTOR`, `ORGANIZER`, `ADMIN` only before `PUBLISHED`.
- Published feedback (`PUBLISHED`) becomes `PARTICIPANT` visible to team.

### 2.4 Organizer-Private Data
- Hackathon `DRAFT`/`REVIEW`/`CONFIRMED` statuses are organizer-private. Only creator `organizerId` or `ADMIN` can `GET /hackathons/:id` in those states (`apps/organizer-api/src/modules/hackathon/hackathon.routes.ts:1` ownership check).
- Analytics (`participants`, `teams`, `projects` maps) are organizer-only; participants see aggregated counts only.

### 2.5 Published Participant Feedback
- `EvaluationPublished` event signals scores are public to team. Until published, evaluations are `ORGANIZER_PRIVATE`.

### 2.6 Public Hackathon Data
- `PUBLISHED` hackathons are `PUBLIC` — no auth needed for `GET /hackathons/:slug` (future). Includes slug, title, phases (UPCOMING/ACTIVE), public resources (`visibility=PUBLIC`).

## 3. Enforcement Architecture

1. **Server-side checks only** — `isResourceOwner`, `isTeamMember`, `isTeamLeader` (`packages/security/src/rbac.ts:1`) use DB-derived arrays, not client input.
2. **Service layer filtering** — e.g., `hackathonService.listAll()` returns filtered set per role before controller serialization.
3. **Zod strict schemas** strip private fields from public DTOs (e.g., `Hackathon` public view omits `organizerId`).
4. **Neo4j** does NOT store private fields — only IDs for traversals.

## 4. Audit Trail for Private Access

All cross-boundary reads are audit-logged: `actorId`, `resourceType`, `requestId`, `outcome` (`packages/security/src/audit.ts:1`). Used to prove compliance.

## 5. Example Matrix

| Action | PUBLIC | PARTICIPANT | TEAM_MEMBER | MENTOR (assigned) | ORGANIZER | ADMIN |
|---|---|---|---|---|---|---|
| View PUBLISHED hackathon | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| View DRAFT hackathon | ✗ | ✗ | ✗ | ✗ | owner only | ✓ |
| Create team | — | ✓ | ✓ | — | — | ✓ |
| Grant repo to AI | — | — | leader only | — | — | — |
| Submit mentor feedback | — | — | — | ✓ | ✓ | ✓ |
| Publish evaluation | — | — | — | — | ✓ | ✓ |
| View audit logs | — | — | — | — | ✓ (own hackathon) | ✓ |

## 6. Future: Repository Access Scope

See `docs/DATABASE.md:1` `RepositoryConnection`/`RepositoryAccessGrant`. Only `TEAM_LEADER` can grant `READ` to `hmt-ai-teammate`; revocation sets `revokedAt` and audit. Default deny enforced in `packages/database/src/repository-access.ts:1` `canAccessRepository`.
