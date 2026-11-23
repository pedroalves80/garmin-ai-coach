# Garmin AI Coach

A self-hosted training planner that combines Garmin activity data, structured running workouts and an optional AI coach. Built with Next.js for daily use on a phone, with Docker support for a Raspberry Pi.

Running is the priority. Hyrox and Zwift cycling fit around the running plan, with an ongoing calendar, race preparation and recovery adjustments. The defaults follow a single athlete's running, Hyrox and cycling routine.

## Features

- Automatically prepared weekly plans with one approval before activation.
- Garmin-ready running steps by distance, with pace, heart-rate or effort targets.
- Cycling workouts in watts and percentage of an editable FTP.
- Workout moves, swaps, skips and availability changes with previews and undo.
- Road and trail events, training breaks and automatic post-race recovery reassessment.
- Planned-versus-recorded workout reviews, optional feedback and retained prescription history.
- An optional AI coach with cached responses and shared request limits.

## Getting started

Requires **Node.js 22** and npm. Run these commands from the repository root:

```bash
npm ci
cp .env.example .env
npm run db:migrate
npm run dev
```

Open [localhost:3000](http://localhost:3000). Add your Garmin personal API key in `.env` to import activities. An OpenAI key is optional; planning and local recovery assessments work without it.

To run the background worker during development, open a second terminal:

```bash
npm run build:worker
npm run worker
```

For a local production build, `npm run build && npm start` starts both the web app and worker.

## Configuration

All credentials stay on the server. Use [.env.example](.env.example) as the starting point.

| Variable                  | Purpose                                                                         |
| ------------------------- | ------------------------------------------------------------------------------- |
| `GARMIN_PERSONAL_API_KEY` | Garmin **personal API key**, not the temporary access token. Required for sync. |
| `GARMIN_AUTO_SYNC`        | Enable startup and three-hour sync; defaults to `true`.                         |
| `OPENAI_API_KEY`          | Optional AI reviews and explanations.                                           |
| `OPENAI_MODEL`            | Model used by the AI adapter; see the example environment.                      |
| `DATABASE_PATH`           | SQLite file; defaults to `./data/coach.db` outside Docker.                      |
| `APP_ALLOWED_ORIGINS`     | Additional accepted private origins for a custom hostname.                      |
| `SYNC_SECRET`             | Optional secret for non-browser automation; never entered in the UI.            |

Create a Garmin key through [Garmin Connect](https://connect.garmin.com/app/settings/personalApiToken). The app exchanges it for an access token. Restart the app and worker after changing environment variables.

## Daily use

1. Sync Garmin, then review and accept the proposed week in **Plan**.
2. Open **Today** for the current sessions, or select any day in **Plan** to copy workout steps into Garmin Connect or Zwift.
3. Use **Change workout** when your schedule changes. Check **Progress** after importing completed activities.

Recovery check-ins and effort ratings are optional. Post-race base effort can be reassessed automatically from completed recovery runs and current Garmin evidence; the reason appears in Plan.

See the [user guide](docs/usage.md) for races, trail runs, recovery, feedback and settings.

## Docker and Raspberry Pi

For a standalone installation, configure `.env` and run:

```bash
docker compose up -d --build
```

Open [localhost:3000](http://localhost:3000). The web app and worker share the persistent `coach-data` volume. Do not remove that volume during an upgrade.

For ARM64 builds or deployment alongside an existing homelab stack, use the [deployment guide](deploy/README.md). Its Compose template isolates this app from other services.

## Development

The stack is Next.js App Router, React, TypeScript, SQLite, Drizzle and the OpenAI Responses API. UI components follow Atomic Design.

```bash
npm run lint
npm test
npm run typecheck
npm run format:check
npm run build
```

Tests use synthetic activities, in-memory databases and mocked provider responses. They do not require Garmin or OpenAI credentials.

## Scope and limitations

- This is a single-user app for a trusted LAN or VPN. It has no sign-in; network access is the access boundary.
- Workouts are copied into Garmin Connect manually. App changes do not update a workout already scheduled on the watch.
- Training and recovery decisions are transparent planning heuristics. Wearable averages cannot establish full workout execution, absence of pain or medical readiness.
- AI reviews send bounded training and health summaries to OpenAI when enabled. Raw Garmin JSON, GPS coordinates, credentials and free-text check-in notes are excluded.

## Documentation

| Guide                                     | Contents                                                      |
| ----------------------------------------- | ------------------------------------------------------------- |
| [Using the app](docs/usage.md)            | Weekly and daily workflows, events, adjustments and feedback. |
| [Training rules](docs/training-policy.md) | Mileage, quality, recovery and evidence requirements.         |
| [Architecture](docs/architecture.md)      | Components, persistence, sync, AI boundaries and costs.       |
| [Deployment](deploy/README.md)            | Docker, Raspberry Pi operations, backups and upgrades.        |
