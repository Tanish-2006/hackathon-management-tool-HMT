# ORGANIZER INTEGRATION CONTRACT

This document outlines the decoupled integration interface between the Participant Platform and the Organizer Platform.

## Data Exchange Strategy
The Participant Platform consumes organizer data via standard versioned REST API calls and/or asynchronous Webhook events.

### Required Organizer Endpoints / Events

#### 1. Hackathon Details & Context
`GET /organizer/api/v1/hackathons/:id`
```json
{
  "id": "hackathon_uuid",
  "title": "Global AI Hackathon 2026",
  "problemStatement": "Build an autonomous AI agent system to enhance developer productivity.",
  "rules": ["Must be open source", "Must include functional unit tests"],
  "resources": [
    { "name": "API Spec", "url": "https://api.hackathon.org/docs" }
  ],
  "judgingCriteria": [
    { "category": "Technical Complexity", "weight": 0.4 },
    { "category": "Originality", "weight": 0.3 },
    { "category": "UI/UX & Impact", "weight": 0.3 }
  ],
  "phases": [
    { "name": "Ideation", "deadline": "2026-08-23T12:00:00Z" },
    { "name": "Submission", "deadline": "2026-08-24T18:00:00Z" }
  ]
}
```

#### 2. Mentor & Judging Feedback Sync
`POST /participant/api/v1/organizer-webhook/feedback`
Webhook sent by Organizer system when a mentor or judge submits feedback.
Headers: `X-Organizer-Signature: sha256=...`
```json
{
  "event": "feedback.submitted",
  "teamId": "team_uuid",
  "phase": "Midway Evaluation",
  "authorRole": "MENTOR",
  "feedbackText": "Frontend API client lacks retry logic on 500 errors.",
  "score": 8.5
}
```

#### 3. Status & Elimination Event
`POST /participant/api/v1/organizer-webhook/elimination`
```json
{
  "event": "team.eliminated",
  "teamId": "team_uuid",
  "reason": "Failed to submit demo link before phase 2 deadline.",
  "category": "TIMELINE_MISSED",
  "detailedFeedback": "No working repository link was present at cutoff time."
}
```
