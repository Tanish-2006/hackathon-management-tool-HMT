# API CONTRACT — HMT PARTICIPANT PLATFORM

All requests respond with standardized JSON envelopes.

## Base URL: `/api/v1`

### Authentication Envelopes
- `POST /auth/register` - Create participant account
- `POST /auth/login` - Authenticate & obtain token pair (Access JWT + Refresh Token HTTP cookie or payload)
- `POST /auth/refresh` - Rotate refresh token & return new access token
- `POST /auth/logout` - Revoke current refresh token family & clear session
- `POST /auth/logout-all` - Revoke all active sessions for user
- `GET /auth/me` - Fetch current authenticated user context

### Profile Management
- `GET /profile` - Retrieve full profile
- `PUT /profile` - Update skills, experience, bio
- `POST /profile/skills` - Add skills to graph & DB

### Hackathon Integration (Participant View)
- `GET /hackathons/current` - Active joined hackathon context
- `GET /hackathons/:id/problem-statement` - Detailed problem statement & rules
- `GET /hackathons/:id/resources` - Organizer-provided APIs/docs/assets
- `GET /hackathons/:id/announcements` - Event timeline and broadcast messages

### Team & Project
- `GET /team/me` - Team membership, teammates, and project info
- `POST /team/project` - Register/update team project details
- `POST /team/repository` - Connect Git repository URL & credentials/token

### Repository Analysis Engine
- `POST /repository/analyze` - Trigger background scan & AST breakdown
- `GET /repository/status/:scanId` - Get scan progress and findings
- `GET /repository/findings` - List security, compile, lint & architecture findings

### AI Teammate & Strategy
- `POST /ai/chat` - Interactive AI advice informed by repository & hackathon context
- `GET /ai/recommendations` - Prioritized recommendations to win hackathon
- `POST /ai/analyze-architecture` - Strategic architecture suggestions

### Performance & Mentor Feedback
- `GET /performance/timeline` - Phase progress, milestones, mistakes
- `GET /performance/feedback` - Mentor and judge feedback
- `GET /performance/elimination-analysis` - Structured elimination analysis & recovery advice

### Post-Hackathon Continuation
- `POST /post-hackathon/roadmap` - Generate product roadmap & market opportunity report
- `GET /post-hackathon/resources` - Recommended continuation resources & target users
