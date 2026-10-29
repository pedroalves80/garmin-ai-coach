# Garmin AI Coach

Mobile-first personal training coach for running, Hyrox and cycling. The app is designed for private Raspberry Pi deployment and uses Atomic Design for the UI.

## Current status

The first vertical slice is in place:

- Next.js App Router dashboard shell
- Mobile-first responsive layout
- Atomic Design components under `src/components`
- Typed workout and coach contracts
- Server-only Garmin and OpenAI boundaries
- SQLite persistence with Drizzle-compatible schema
- Garmin token exchange, sync status and protected sync route
- Docker and Docker Compose configuration
- Placeholder deterministic recovery rule

The dashboard reads actual stored activities and health summaries. Before the first sync it shows empty states. The old sample workout components are no longer displayed. AI coaching and the training planner are the next features.

Garmin sync uses the official [Personal API Swagger](https://developer.garmin.com/gc-developer-program/personal/swagger-docs/) (v1.0.0, checked 2026-10-29):

- `GET /activitylist-service/activities/search/activities` with `start`, `limit`, `startDate`, `endDate`; distances are meters and durations are seconds.
- `GET /usersummary-service/v2/dailysummaries` returns `{ data: [...] }`, including nested `heartRate.restingValue` and `bodyBattery.latestValue`.
- `GET /sleep-service/sleep/dailySleepSummariesByDate` returns daily sleep summaries; each request covers at most 31 days.

Token exchange uses the official Personal API token endpoint. Access tokens are held in memory for up to 24 hours (with an expiry margin); a 401 triggers one renewal. Network errors, HTTP 429 and 5xx responses retry at most twice with timeouts and bounded delays. Credentials and raw response bodies are never logged.

## Local development

```bash
cp .env.example .env
npm run db:migrate
npm run dev
```

Open http://localhost:3000.

Set `GARMIN_PERSONAL_API_KEY` and replace `SYNC_SECRET` with a random passphrase of at least 16 characters in `.env`. Keep `APP_SESSION_SECRET` set to a separate random value for the upcoming application session feature. Restart after changing environment variables. Leave the OpenAI key blank for this phase; syncing makes no AI calls.

In the Garmin panel, enter your sync passphrase (not your Garmin key). It is sent in a request header and kept only in page memory. The first sync imports the last 90 days. Later syncs replay from seven days before the last successful checkpoint to capture late uploads and corrections. Use “Recheck the last 90 days” for older edits within that period. Deletions in Garmin are not mirrored yet.

Each successful sync updates normalized fields and retained JSON in a single database transaction. A failed sync preserves existing records and the last successful checkpoint. SQLite leases prevent concurrent imports across app processes. Missing sleep/HR measurements remain null, rather than fabricated zero values.

Dashboard weeks start Monday in Europe/Lisbon. It displays all recorded sports, identifies running subtypes, and dates the latest health values. Generic strength sessions retain their Garmin activity type; the app does not infer that they were Hyrox.

The current app is single-user and intended for a private network. The sync endpoint requires a secret; dashboard reads do not yet have user-session authentication. Use a private VPN or authenticated HTTPS reverse proxy for remote access; do not expose the app directly to the public internet.

## Raspberry Pi

Create `.env` with server-only secrets, then run:

```bash
docker compose up -d --build
```

The app will be available on port 3000. Use a Raspberry Pi with a 64-bit OS (ARM64). The image runs as a non-root user and stores SQLite in the `coach-data` named volume, which survives container replacement. Do not remove this volume during upgrades. The Docker build excludes `.env`, local databases and the Git directory. Keep the Garmin and OpenAI keys out of the repository and never prefix them with `NEXT_PUBLIC_`.

For local production mode, `npm run build && npm start` prepares the standalone server with its CSS/public assets and loads `.env`. SQLite tables are created on first use; `npm run db:migrate` also initializes them explicitly. Back up SQLite with its online backup API rather than copying a live WAL database file alone.

The protected sync route is `POST /api/garmin/sync` with the `x-sync-secret` header. The status route is `GET /api/garmin/status`.

## Quality checks

```bash
npm run lint
npm test
npm run typecheck
npm run format:check
npm run build
```

## Planned next slices

1. Application authentication and scheduled syncing.
2. Deterministic load, HR-at-pace and recovery metrics.
3. Low-cost OpenAI Responses API coach adapter with structured output validation.
4. Workout generator and Garmin-ready copy/export workflow.

The automated tests use an in-memory database and synthetic API responses. They cover pagination, retries, malformed data, token renewal, atomic failure recovery, duplicate prevention, corrections and Lisbon week boundaries. A real Garmin account test requires your own key and is not part of the test suite.
