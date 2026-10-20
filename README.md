# ApCiDa Reporting Server

Separate REST service for user-submitted smishing reports. Detection remains on the
Android device. The server receives feedback and a scan snapshot. SMS text is
accepted only when the user selects the separate sharing option in the app.

## Requirements

- Node.js 22 or newer
- PostgreSQL (local or hosted, such as Neon)

## Local setup

1. Run `npm ci`.
2. Copy `.env.example` to `.env` and set `DATABASE_URL` and `REPORT_API_KEY`.
   Generate a random key with `openssl rand -hex 32`. Keep `.env` out of Git.
3. Run `npm start`. The server applies its idempotent schema migrations at startup.
4. Run `npm test` to check the endpoint and retry behavior.

The default port is `3000`; set `PORT` to use another port. `GET /health`
returns `{"status":"ok"}`. It checks that the process is running, not the
database connection. `GET /ready` checks PostgreSQL and returns 503 if it is
unavailable.

## Private report review

The admin dashboard is disabled until all three admin settings are set. Give it
a **separate** username, password hash, and session secret; never use the
Android `REPORT_API_KEY` for admin access. To create a password hash, run
`ADMIN_PASSWORD='your long password' npm run hash-admin-password` and put the
result in `ADMIN_PASSWORD_HASH`. Generate `ADMIN_SESSION_SECRET` with
`openssl rand -hex 32`. Set `ADMIN_USERNAME` to your chosen username. Keep
all three values in server environment variables, not Git. Run the dashboard
over HTTPS when hosted.

Open `/admin/login` to sign in. `/admin` shows received totals, review counts,
breakdowns by reason, final verdict, AI status, Gemma classification, matched
indicator, app/model version, and received day. Separate tables group confirmed
findings by Gemma result, indicator, and app/model version. The report list has
filters for reason, verdict, AI status, review status, and received dates, with 25 reports
per page. It never includes SMS text. A report detail shows the saved snapshot,
redacted remarks and rationale, and a collapsed SMS section only when the user
opted to share it. Reviewers can save an `IN_REVIEW` or `RESOLVED` decision,
confirmed `SCAM`/`LEGITIMATE`/`UNCERTAIN` label, finding, and notes. A resolved
decision requires both a label and finding; an in-review decision has neither. Each save
adds a review history entry; the submitted report remains unchanged.

`MISSED_SCAM` and `FALSE_ALERT` are confirmed reviewer findings. User reasons
and scan results are feedback, not ground truth. The dashboard does not infer
detector accuracy from this selected set of reports. Use the `ANALYSIS_FAILURE`
finding for cases where scanning failed. Use `INCONCLUSIVE` when evidence is
insufficient. The admin login is rate limited, sessions expire after eight
hours, and review forms require a CSRF token. A missing or partial admin
configuration never exposes the dashboard: partial configuration fails startup.

## Android request contract

`POST /api/reports/submit` with `Content-Type: application/json`, an
`X-API-Key` header, and an `X-Timestamp` header containing Unix **milliseconds**.
The timestamp must be within five minutes of server time. The body uses the
current Android client's camelCase names:

```json
{
  "reportType": "Scam was not detected",
  "remarks": null,
  "riskScore": 0,
  "gemmaClassification": "LEGITIMATE",
  "gemmaRationale": "No suspicious request was identified.",
  "detectedKeywords": [],
  "reportedAt": 1792416000000,
  "appVersion": "1.0",
  "clientReportId": "5a884d88-074f-4fa2-842c-a9122ee37901",
  "finalVerdict": "SAFE",
  "ruleVerdict": "SAFE",
  "processingState": "COMPLETED",
  "aiStatus": "AVAILABLE",
  "gemmaConfidence": "LOW",
  "modelVersion": "gemma3-1b-it-int4.task",
  "messageSharingConsent": false
}
```

`reportedAt` is also Unix milliseconds. It may be old because the Android app
queues reports offline. `remarks`, `riskScore`, `gemmaClassification`, and
`gemmaRationale` may be omitted or null. A `clientReportId` marks a new scan
snapshot; its final verdict, rule verdict, processing state, AI status, and
sharing choice are required. Older queued reports without snapshot fields
remain accepted. Optional `smsText` is accepted only when
`messageSharingConsent` is `true`. The app leaves the sharing option unchecked
by default. Sender addresses and contact names are not accepted. The server
cannot independently verify the client's consent claim.

The response is `{"success":true,"message":"Report received","reportId":"..."}`
with HTTP 201 for a new report. If an identical normalized payload is retried,
the response is HTTP 200 with the existing `reportId`. Errors return
`success:false` and an appropriate 4xx or 503 status; the Android app keeps
those reports pending. New reports use a stable `clientReportId` for retries.
The server also checks a digest of the normalized payload; reusing a client ID
with different content returns HTTP 409. Legacy reports without an ID use the
digest.

## Privacy and security

The server rejects unexpected JSON fields. It replaces common phone numbers,
email addresses, URLs, and long numbers in remarks and Gemma rationale before
storage. This is best-effort redaction, not a guarantee of anonymity. If the
user opts in, `smsText` is stored exactly as sent so reviewers can inspect the
words and links that led to a wrong result. Restrict database access and set a
retention policy before collecting real reports. Do not log request bodies,
API keys, or database connection strings.

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
  `REPORT_API_KEY` (the random key generated above), and `ADMIN_USERNAME`,
  `ADMIN_PASSWORD_HASH`, `ADMIN_SESSION_SECRET` to enable private review
- Health-check path: `/ready`

A failed first attempt stays pending; the Android client retries through
WorkManager with a network constraint. Its request timeout is 90 seconds.

The Android app has a default server URL and an empty API key. Server deployment
alone will not make reports upload until the client is configured.
The admin dashboard is available only after its separate credentials are set.
