# DEMO MANUAL & VERIFICATION SCRIPT

## How to Run Demo Verification
1. Ensure node environment is ready (`node -v`).
2. Run `npm run build` to verify compilation.
3. Run `npm test` to verify unit & security test suite.
4. Start server in demo mode: `npm run start:dev`.
5. Run the automated demo flow script: `npm run demo`.

## Supported Demo Flow Steps
- **Step 1**: Register & Login Participant (`john@example.com`).
- **Step 2**: Fetch Active Hackathon context & Problem Statement.
- **Step 3**: Connect Project & Git Repository (`https://github.com/example/demo-project`).
- **Step 4**: Run Repository Analysis engine (detects secrets, lint issues, missing tests).
- **Step 5**: Query AI Teammate (operates smoothly even without live `AI_API_KEY` using fallback adapter).
- **Step 6**: Receive Winning Strategy & Bug Mitigation suggestions.
- **Step 7**: Ingest Mentor & Judge feedback.
- **Step 8**: Trigger Post-Hackathon Project Continuation Roadmap.
