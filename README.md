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
- On-demand AI weekly/daily reviews, cached responses and approved workout reductions
- Automatic startup and three-hour Garmin syncing with persistent retries and worker health

The dashboard reads stored Garmin data and includes a 30-stage running planner with Garmin-ready steps. Future stages are previews; only explicitly saved weeks enter adherence comparisons. The Coach tab explains the training and proposes daily changes for explicit approval.

## Screens and navigation

The light interface uses dark text and green accents. Desktop navigation is a sidebar; phones use a persistent bottom bar with the current screen highlighted.

- **Today** (`/`): today's recorded/scheduled running, weekly totals, a recovery snapshot and an expandable check-in form.
- **Plan** (`/plan`): a seven-day selector and one workout's Garmin-ready distance steps at a time. Every generated run totals at least 5 km including warm-up and cool-down. Week, volume and tempo pace controls are under **Adjust week & pace settings**. Saving still requires explicit review and the existing progression checks.
- **Coach** (`/coach`): on-demand daily/weekly reviews and reviewed changes. Privacy, usage limits and review metadata are available through expandable details.
- **Progress** (`/progress`): switch between training trends and recent activities. Comparison methods and saved-versus-recorded details expand on request.
- **Settings** (`/settings`): Garmin connection, automatic sync status and data/privacy information.

Old section bookmarks such as `/#connection` redirect to the corresponding screen. A shared status observer refreshes the visible screen when Garmin imports change, without making AI requests. Workout targets, copy actions, check-in saves and approval rules remain available across the new screens.

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

Set `GARMIN_PERSONAL_API_KEY` and, optionally, `OPENAI_API_KEY` in `.env`, and restart after changing environment variables. No login, session key or passphrase is required to use this trusted-local app. Without an OpenAI key, Garmin syncing and the planner still work. Existing `APP_SESSION_SECRET` values are unused and may remain in older `.env` files.

In the Garmin panel, press **Sync Garmin**. The Garmin key stays on the server. The first sync imports the last 90 days. Later syncs replay from seven days before the last successful checkpoint to capture late uploads and corrections. Use “Recheck the last 90 days” for older edits within that period. Deletions in Garmin are not mirrored yet.

Each successful sync updates normalized fields and retained JSON in a single database transaction. A failed sync preserves existing records and the last successful checkpoint. SQLite leases prevent concurrent imports across app processes. Missing sleep/HR measurements remain null, rather than fabricated zero values.

## Automatic Garmin syncing

Production `npm start` launches both the Next.js server and the Garmin worker and stops both on Ctrl+C/SIGTERM. Build first with `npm run build`; it also compiles the independent worker using TypeScript, without adding a runtime transpiler. During development, run `npm run build:worker && npm run worker` in a second terminal alongside `npm run dev`.

The worker attempts a sync on startup, then three hours after each successful scheduled run. A persisted five-minute startup cooldown avoids repeated requests during rapid restarts. Network failures, HTTP 429 and 5xx responses schedule retries after 5 and 15 minutes; further failures return to a three-hour wait. Credential and malformed-data failures wait three hours immediately. Existing per-request retries still apply. Set `GARMIN_AUTO_SYNC=false` in `.env` and restart to disable scheduled calls; manual sync continues to work. No AI requests are made by the worker.

Schedules and retry counts live in SQLite. A 90-second leadership lease, renewed every 20 seconds, selects one worker across processes; the existing Garmin sync lease also prevents overlap with manual sync. Work is checked every 30 seconds, so scheduled times can vary by that amount while the worker is healthy. A successful manual sync cancels outstanding scheduled retries and starts a fresh three-hour interval. Missed intervals are not replayed individually after downtime.

Sync jobs have a five-minute deadline, including token exchange and pagination. Shutdown cancels in-flight HTTP calls and preserves the last successful checkpoint. The app polls local sync status every 30 seconds while visible and refreshes imported data when the successful-sync timestamp changes. Settings shows worker availability, retry errors and the next attempt in Lisbon time. The status endpoint reports worker health separately from Garmin connectivity; a healthy worker can be waiting for credentials or a network retry.

Docker Compose runs the web app and `garmin-worker` as separate services using the same image and persistent SQLite volume. The worker has no published port; its healthcheck reads the stored leadership lease, and `restart: unless-stopped` restarts an exited process. Docker marks a failed healthcheck unhealthy; health status alone does not restart a process. Use `docker compose logs -f garmin-worker` and `docker compose ps` to inspect it. No new passphrase or scheduler API key is needed.

Dashboard weeks start Monday in Europe/Lisbon. Hyrox is identified by its type or an explicit HYROX activity label; generic strength sessions are not assumed to be Hyrox. Meditation, breathing and yoga are separate wellness time. Per-sport minutes describe volume, not physiological load or equivalent running distance.

## Training metrics and planner

- Four completed weeks plus the current partial week show running distance and time. Week-over-week percentage change compares completed weeks only.
- Similar-run observations compare the latest 28 days with the preceding 28, using at least three independent matched pairs. Matching requires road running, average HR 135–150 bpm with at most 3 bpm difference, distance within 10%, start locations within 250 m, ascent density within 5 m/km, and temperature within 5°C where available. Missing ascent/location excludes a run. Matching start points does not establish identical routes; wind, effort and stops are not controlled. These are observations, not proof of a lower HR or a standardized fitness test.
- Log fatigue and muscle soreness on a 1–5 scale and pain on a 0–10 scale. Check-ins upsert by date, are stored locally, and accept dates within the last 14 days. Coach requests include recent scores; notes stay local. No scores are filled in automatically.
- A plan starts on Monday and stores a complete snapshot of its reviewed steps. The first draft defaults to next Monday so it does not add quality work to the already-started week. The 30 stages toward 80 km are milestone ceilings, not automatic calendar advancement. Reviewed volume can be set below a milestone; at least 20 km is supported in this starting template.
- Save starting stage 1 first. Later approvals move no more than one stage at a time. An increase must satisfy the volume review and cannot exceed its suggested kilometers. Holding/reducing is supported by repeating the stage or using a lower reviewed volume. Saving a plan does not publish anything to Garmin.
- New workouts use distance for every step, including warm-ups, cool-downs and nested repeats. Every run is at least 5 km in total. The weekly split is redistributed within the reviewed total, rather than increasing weekly volume to meet this minimum. The 20 km minimum supports four 5 km runs. Distances use 10 m increments, so the steps displayed and copied into Garmin add up exactly; reviewed volume accepts increments of 0.01 km.
- Tuesday has six 0.08 km strides with 0.25 km recovery steps. Thursday has two 1.30 km tempo reps with 0.30 km recovery steps. These are distance-based replacements for the former timed reps. Pace/HR targets still control intensity; changing a pace does not change the planned kilometers. Cutback weeks replace quality work with base running.
- Previously saved snapshots keep their reviewed steps until explicitly resaved. If an older saved week differs from the new generator, Plan shows an updated draft for review. Legacy timed steps remain readable and use estimated distance for historical comparisons. The current distance-only planner shows kilometers without a scheduled-duration target.
- Recorded distance is matched by local day. “Distance met” means at least 90% of the estimated distance, not that target pace, HR or session intent was achieved. Several runs on one day are combined; future days are not marked missed.

Mutation routes `POST /api/training/check-in`, `POST /api/training/plan` and `POST /api/garmin/sync` accept normal same-origin app requests. The UI adds a non-secret `x-coach-request: local` header; the server checks the request origin and Fetch Metadata. Cross-origin forms and foreign websites cannot use these browser actions. Requests addressed to unrecognized public hostnames are rejected for both reads and writes to help prevent DNS rebinding. Common loopback, private LAN/overlay IPs, single-label hostnames, `.local`, `.localhost` and `.home.arpa` names work by default. Use `APP_ALLOWED_ORIGINS` for another custom private name.

Progression rules are transparent app heuristics, not validated injury predictions: recent pain or high fatigue/soreness suggests reduction; missing/stale sync, incomplete weeks, insufficient adherence or recovery check-ins suggest holding. An increase requires a finished recent plan, at least 90% recorded distance, three check-ins over seven days including today/yesterday, and consistently low fatigue/soreness. A competing-sport time rise over 25% also triggers a review. The increase suggestion is capped at the smaller of 2 km or 5%; this is a conservative implementation choice, not a universal safe percentage. Scheduled cutback stages remain reductions. The timeline can therefore extend beyond 30 weeks.

The single-session review flag compares the longest planned run with the longest recorded in 30 days; a >10% difference asks for review. It is informed by this [2025 cohort study](https://pubmed.ncbi.nlm.nih.gov/40623829/), not a guarantee of safety. The broader evidence does not establish a universal weekly progression rule: see the [systematic review](https://pmc.ncbi.nlm.nih.gov/articles/PMC9528699/).

This is a single-user app with no sign-in. Access control is your network boundary: anyone who can reach the app through an accepted hostname can view its data and use it. A Raspberry Pi alone does not restrict network access; keep the service on your trusted LAN/VPN and do not port-forward it publicly. Host/origin protections do not authenticate users or replace a firewall.

## AI coach

Open **Coach** and choose **What should I do today?** or **Review my week**. Opening the dashboard, syncing Garmin, saving check-ins and reading saved reviews make no OpenAI requests. `GET /api/coach` reads local status/history; same-origin `POST /api/coach` generates reviews or approves their proposed workout changes.

The adapter uses the [OpenAI Responses API with structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs), server-side validation, a 30-second timeout, low reasoning effort, at most 1,600 output tokens and no automatic retries or model fallback. `OPENAI_MODEL` defaults to the inexpensive [gpt-6-luna](https://developers.openai.com/api/docs/models/gpt-6-luna). Changing it requires a model supporting Responses, structured outputs and low reasoning effort. Actual charges depend on the configured model and OpenAI pricing.

SQLite records request attempts before contacting OpenAI. Limits are six fresh attempts per Lisbon calendar day and 60 per calendar month, shared across browser sessions and app restarts. Failed attempts also count because their billing status can be uncertain. These are request limits, not a dollar budget. Context is bounded to 16 KB and output is capped; unchanged reviews are cached by model, prompt version and training fingerprint. A persistent lease rejects overlapping requests. There is no background AI spending.

Only an explicit allowlist of training/health summaries is sent: five weeks of sport totals, seven days of session summaries, sleep/resting-HR/Body-Battery measurements, check-in scores, the saved plan's stage/volume, today's steps and locally calculated progression/comparison results. Garmin raw JSON, locations, activity names, check-in notes, credentials and personal identifiers are excluded. Dates are included for scheduling. Requests set `store: false`; this does not eliminate OpenAI's default abuse-monitoring retention. See [OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data).

The model can choose only follow, shorten, replace quality with a recovery run, or rest. All changes are constructed locally: shorten removes up to 20% of the original distance at HR 125–140 bpm, with a 5 km floor. Replacement uses at most the original distance at that HR, also at least 5 km. A run already at the minimum cannot be shortened; rest remains available. The floor never increases an older, shorter saved run. The coach cannot raise volume or speed, write arbitrary workouts, bypass progression rules or upload to Garmin. Recent reported pain requires rest advice; high fatigue/soreness permits only reduction or rest. Missing check-ins, stale sync, no saved workout, or an already recorded run limit proposals. These are conservative app rules, not validated medical or injury predictions.

**Approve this workout change** saves a date-specific override only after rechecking the training fingerprint and date. A new sync, changed plan/check-in scores or a recorded activity invalidates an unapproved proposal. Saving a newly reviewed week clears its earlier daily overrides. The planner and approved-review card show the adjusted steps; original weekly totals and distance-adherence comparisons remain the reviewed baseline. Approval is local; copy the steps into Garmin Connect. Reviews and approvals survive restarts.

Provider failures, refusals, incomplete output, schema errors and disallowed actions leave workouts unchanged. The UI shows a retryable error without exposing provider responses or secrets.

## Raspberry Pi deployment

Create `.env` with server-only secrets, then run:

```bash
docker compose up -d --build
```

The app will be available on port 3000. Use a Raspberry Pi with a 64-bit OS (ARM64). The image runs as a non-root user and stores SQLite in the `coach-data` named volume, which survives container replacement. Do not remove this volume during upgrades. The Docker build excludes `.env`, local databases and the Git directory. Keep the Garmin and OpenAI keys out of the repository and never prefix them with `NEXT_PUBLIC_`.

For local production mode, `npm run build && npm start` prepares the standalone server with its CSS/public assets and loads `.env`. The launcher resolves `DATABASE_PATH` to an absolute path before Next.js changes directory, so relative databases stay in the project's persistent `data` directory, outside `.next`. SQLite tables are created on first use; `npm run db:migrate` also initializes them explicitly. Back up SQLite with its online backup API rather than copying a live WAL database file alone.

For optional server-to-server jobs, set `SYNC_SECRET` to a random value of at least 16 characters and send it as `x-sync-secret`. This supports requests without browser Origin headers and is never entered in the app. The status route is `GET /api/garmin/status`.

## Quality checks

```bash
npm run lint
npm test
npm run typecheck
npm run format:check
npm run build
```

## Planned next slices

1. Detailed activity/FIT analysis for HR drift and stronger route comparisons.
2. Workout FIT export workflow.

The automated tests use an in-memory database and synthetic API responses. They cover pagination, retries, malformed data, token renewal, atomic failure recovery, duplicate prevention, corrections, Lisbon week boundaries, persisted schedules, competing workers, restart cooldowns, manual-sync coordination and cancellation. A real Garmin account test requires your own key and is not part of the test suite.
