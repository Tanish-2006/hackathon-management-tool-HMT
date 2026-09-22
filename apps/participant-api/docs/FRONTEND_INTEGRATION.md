# FRONTEND INTEGRATION CONTRACT

## Authentication Flow
1. User submits credentials to `POST /api/v1/auth/login`.
2. Response returns `accessToken` (JWT string) and sets HTTP-only `refreshToken` cookie (or returns `refreshToken` in response payload for header storage).
3. Subsequent API calls include `Authorization: Bearer <accessToken>`.
4. When request returns HTTP 401 `TOKEN_EXPIRED`, frontend calls `POST /api/v1/auth/refresh`.

## Error Response Standard
All error responses adhere to standard NestJS / RFC7807 structure:
```json
{
  "statusCode": 400,
  "error": "Bad Request",
  "message": ["email must be an email"],
  "timestamp": "2026-08-23T00:35:00.000Z",
  "path": "/api/v1/auth/register"
}
```

## Real-time & Polling Statuses
For Repository Analysis and AI Continuation Jobs:
- Query `GET /api/v1/repository/status/:scanId` to check status (`PENDING`, `SCANNING`, `COMPLETED`, `FAILED`).
- Returns percentage progress and array of findings as they become available.
