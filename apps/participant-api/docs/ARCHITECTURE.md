# ARCHITECTURE SPECIFICATION — HMT PARTICIPANT PLATFORM

## System Overview
The Hackathon Management Tool (HMT) Participant Platform is an enterprise-grade backend service built using NestJS and Fastify. It provides real-time hackathon management, automated repository security & quality analysis, AI-powered team advisory during the event, and post-hackathon project continuation roadmapping.

## Technology Stack
- **Runtime & Framework**: Node.js v22 LTS, NestJS v10+, Fastify (`@nestjs/platform-fastify`)
- **Primary Database (Relational/Transactional)**: PostgreSQL managed via Prisma ORM
- **Graph Database (Relationships/Knowledge Graph)**: Neo4j via official `neo4j-driver`
- **In-Memory Cache & Job Queue**: Redis via `ioredis` & BullMQ
- **Authentication & Security**: Argon2id password hashing, JWT Access/Refresh tokens with Token Family reuse detection, Helmet, Rate Limiting, OWASP compliance guards
- **AI Integration Engine**: Abstracted LLM Provider Architecture (`AIProvider` interface) supporting OpenAI/Anthropic/Custom models with zero hard-dependency on active API keys at startup
- **Static Analysis & Sandbox Engine**: AST & pattern-based repository analyzer with secret redactor, lint/compile checker, and contract verifier

## Core Data Flow Architecture

```
[ Participant Client / Frontend ]
               │
               ▼
   [ NestJS + Fastify Gateway ]  <---> Rate Limiter / Redis
               │
      ┌────────┴────────┐
      ▼                 ▼
[ Auth & RBAC ]  [ Hackathon & Team APIs ]
      │                 │
      ▼                 ▼
[ PostgreSQL ]   [ Neo4j Knowledge Graph ]
(Transactional)  (Skills, Mistake Graphs, Feedback)
      │
      ├─────────────────────────────────────────┐
      ▼                                         ▼
[ Async BullMQ Queue ]                [ AI Teammate Engine ]
      │                                         │
      ▼                                         ▼
[ Repository Scanner Engine ] ──(Findings)──> [ AI Provider Adapter ]
(AST, Secrets, Lint, Arch)                     (GPT-4o/Claude 3.5/Mock)
                                                │
                                                ▼
                                    [ Structured Recommendations ]
```

## Database Responsibility Matrix

### PostgreSQL (Source of Truth)
- Users, Roles, Refresh Tokens, Email Verification Tokens
- Hackathon registrations, Teams, Teammates
- Projects, Repository Connections, Scans
- Mistakes, Mentor Feedback, Judging Feedback, Elimination Records
- AI Conversation Logs, Job Audit Logs

### Neo4j (Graph Network)
- `(:Participant)-[:MEMBER_OF]->(:Team)-[:BUILT]->(:Project)`
- `(:Participant)-[:HAS_SKILL]->(:Skill)`
- `(:Project)-[:USES]->(:Technology)`
- `(:Project)-[:ADDRESSES]->(:ProblemStatement)`
- `(:Mistake)-[:MITIGATED_BY]->(:Recommendation)`
- `(:MentorFeedback)-[:TARGETS]->(:Project)`

### Redis (Transient & Real-time State)
- Access Token Blacklist & Refresh Family Revocation lists
- API Rate Limiting windows
- BullMQ Job queue states for Repository Analysis & AI processing
- Active user socket/session cache
