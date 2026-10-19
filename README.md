# ApCiDa Reporting Server

Separate REST service for user-submitted smishing reports. Detection remains on the
Android device. This server accepts only the metadata fields sent by the current
`Mobile_App` Retrofit client; it has no SMS inbox or detection engine.

## Requirements

- Node.js 22 or newer
- PostgreSQL (local or hosted, such as Neon)

## Local setup

1. Run `npm ci`.
2. Copy `.env.example` to `.env` and set `DATABASE_URL` and `REPORT_API_KEY`.
   Generate a random key with `openssl rand -hex 32`. Keep `.env` out of Git.
3. Run `npm start`. The server applies its idempotent schema migration at startup.
4. Run `npm test` to check the endpoint and retry behavior.

The default port is `3000`; set `PORT` to use another port. `GET /health`
returns `{"status":"ok"}`. It checks that the process is running, not the
database connection.

## Android request contract

`POST /api/reports/submit` with `Content-Type: application/json`, an
`X-API-Key` header, and an `X-Timestamp` header containing Unix **milliseconds**.
The timestamp must be within five minutes of server time. The body uses the
current Android client's camelCase names:

```json
{
  "reportType": "Phishing Link (Fake Login Page)",
  "remarks": null,
  "riskScore": 65,
  "gemmaClassification": "SCAM",
  "gemmaRationale": "The message asks for urgent action.",
  "detectedKeywords": ["verify account", "bit.ly"],
  "reportedAt": 1792416000000,
  "appVersion": "1.0"
}
```

`reportedAt` is also Unix milliseconds. It may be old because the Android app
queues reports offline. `remarks`, `riskScore`, `gemmaClassification`, and
`gemmaRationale` may be omitted or null. Other fields are required. Unsupported
fields, including raw SMS or sender fields, are rejected.

The response is `{"success":true,"message":"Report received","reportId":"..."}`
with HTTP 201 for a new report. If an identical normalized payload is retried,
the response is HTTP 200 with the existing `reportId`. Errors return
`success:false` and an appropriate 4xx or 503 status; the Android app keeps
those reports pending. Duplicate matching uses the whole normalized payload,
including `reportedAt`. Two distinct reports with identical metadata and
millisecond timestamp would be treated as one.

## Privacy and security

The server stores only the listed metadata, and it rejects unexpected JSON
fields. It replaces common phone numbers, email addresses, URLs, and long
numbers in free-text remarks and Gemma rationale before storage. This is
best-effort redaction, not a guarantee of anonymity: users or the model can
include identifying information in other forms. Use synthetic or reviewed
test data until the reporting consent and privacy flow is verified. Do not log
request bodies, API keys, or database connection strings.

The shared API key is packaged in the Android app when configured and can be
extracted. A timestamp limits stale requests but does not by itself prevent
replay within the five-minute window. The payload digest avoids duplicate
storage on retry. This design is suitable for a controlled thesis prototype;
production use needs stronger client authentication and abuse protection.

## Deployment

Use a separate GitHub repository from `Mobile_App`. A low-cost prototype
option is a Render web service plus a Neon PostgreSQL database:

- Build command: `npm ci`
- Start command: `npm start`
- Environment variables: `DATABASE_URL` (use Neon's SSL connection string),
  `REPORT_API_KEY` (the random key generated above)
- Health-check path: `/health`

Render's free web services sleep when idle, and the first wake-up can take
longer than the Android client's current 30-second timeout. A failed first
attempt stays pending; the current client retries after a report submission or
on app startup. It does not yet schedule a connectivity-triggered worker.

The Android app still has a placeholder server URL and empty API key. Server
deployment alone will not make reports upload until the client is configured.
No safety-tip, keyword-update, or admin endpoints are included in this first
server version.
