# Garmin AI Coach

Mobile-first personal training coach for running, Hyrox and cycling. The app is designed for private Raspberry Pi deployment and uses Atomic Design for the UI.

## Current status

Implemented:

- Next.js App Router dashboard shell
- Mobile-first responsive layout
- Atomic Design components under `src/components`
- Typed workout and coach contracts
- Server-only Garmin and OpenAI boundaries
- SQLite persistence with Drizzle-compatible schema
- Garmin token exchange, sync status and protected sync route
- Docker and Docker Compose configuration
- Training trends, check-ins, planned-versus-recorded distance and progression reviews

The dashboard reads stored Garmin data and includes a 30-stage running planner with Garmin-ready steps. Future stages are previews; only explicitly saved weeks enter adherence comparisons. AI coaching is the next feature.

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

Dashboard weeks start Monday in Europe/Lisbon. Hyrox is identified by its type or an explicit HYROX activity label; generic strength sessions are not assumed to be Hyrox. Meditation, breathing and yoga are separate wellness time. Per-sport minutes describe volume, not physiological load or equivalent running distance.

## Training metrics and planner

- Four completed weeks plus the current partial week show running distance and time. Week-over-week percentage change compares completed weeks only.
- Similar-run observations compare the latest 28 days with the preceding 28, using at least three independent matched pairs. Matching requires road running, average HR 135–150 bpm with at most 3 bpm difference, distance within 10%, start locations within 250 m, ascent density within 5 m/km, and temperature within 5°C where available. Missing ascent/location excludes a run. Matching start points does not establish identical routes; wind, effort and stops are not controlled. These are observations, not proof of a lower HR or a standardized fitness test.
- Log fatigue and muscle soreness on a 1–5 scale and pain on a 0–10 scale. Check-ins upsert by date, are stored only locally, and accept dates within the last 14 days. No scores are filled in automatically.
- A plan starts on Monday and stores a complete snapshot of its reviewed steps. The first draft defaults to next Monday so it does not add quality work to the already-started week. The 30 stages toward 80 km are milestone ceilings, not automatic calendar advancement. Reviewed volume can be set below a milestone; at least 20 km is supported in this starting template.
- Save starting stage 1 first. Later approvals move no more than one stage at a time. An increase must satisfy the volume review and cannot exceed its suggested kilometers. Holding/reducing is supported by repeating the stage or using a lower reviewed volume. Saving a plan does not publish anything to Garmin.
- Weekly distance is calculated from every step, including warm-ups, cool-downs and nested repeats. Distance steps are exact; time-step distances use the midpoint of the target pace range and are explicitly estimated. The editable HR planning pace estimates duration, not the effort target. Tuesday strides and Thursday tempo remain a small, fixed amount of quality while volume builds; cutback weeks replace them with base running.
- Recorded distance is matched by local day. “Distance met” means at least 90% of the estimated distance, not that target pace, HR or session intent was achieved. Several runs on one day are combined; future days are not marked missed.

Mutation routes `POST /api/training/check-in` and `POST /api/training/plan` use the same `x-sync-secret` passphrase and origin validation as sync. Enter that passphrase in the training workspace to save. It remains in page memory and is never stored in browser local storage.

Progression rules are transparent app heuristics, not validated injury predictions: recent pain or high fatigue/soreness suggests reduction; missing/stale sync, incomplete weeks, insufficient adherence or recovery check-ins suggest holding. An increase requires a finished recent plan, at least 90% recorded distance, three check-ins over seven days including today/yesterday, and consistently low fatigue/soreness. A competing-sport time rise over 25% also triggers a review. The increase suggestion is capped at the smaller of 2 km or 5%; this is a conservative implementation choice, not a universal safe percentage. Scheduled cutback stages remain reductions. The timeline can therefore extend beyond 30 weeks.

The single-session review flag compares the longest planned run with the longest recorded in 30 days; a >10% difference asks for review. It is informed by this [2025 cohort study](https://pubmed.ncbi.nlm.nih.gov/40623829/), not a guarantee of safety. The broader evidence does not establish a universal weekly progression rule: see the [systematic review](https://pmc.ncbi.nlm.nih.gov/articles/PMC9528699/).

The current app is single-user and intended for a private network. The sync endpoint requires a secret; dashboard reads do not yet have user-session authentication. Use a private VPN or authenticated HTTPS reverse proxy for remote access; do not expose the app directly to the public internet.

## Raspberry Pi

Create `.env` with server-only secrets, then run:

```bash
docker compose up -d --build
```

The app will be available on port 3000. Use a Raspberry Pi with a 64-bit OS (ARM64). The image runs as a non-root user and stores SQLite in the `coach-data` named volume, which survives container replacement. Do not remove this volume during upgrades. The Docker build excludes `.env`, local databases and the Git directory. Keep the Garmin and OpenAI keys out of the repository and never prefix them with `NEXT_PUBLIC_`.

For local production mode, `npm run build && npm start` prepares the standalone server with its CSS/public assets and loads `.env`. The launcher resolves `DATABASE_PATH` to an absolute path before Next.js changes directory, so relative databases stay in the project's persistent `data` directory, outside `.next`. SQLite tables are created on first use; `npm run db:migrate` also initializes them explicitly. Back up SQLite with its online backup API rather than copying a live WAL database file alone.

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
2. Detailed activity/FIT analysis for HR drift and stronger route comparisons.
3. Low-cost OpenAI Responses API coach adapter with structured output validation.
4. Workout FIT export workflow.

The automated tests use an in-memory database and synthetic API responses. They cover pagination, retries, malformed data, token renewal, atomic failure recovery, duplicate prevention, corrections and Lisbon week boundaries. A real Garmin account test requires your own key and is not part of the test suite.
