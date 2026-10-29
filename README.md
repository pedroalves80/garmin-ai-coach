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

The Garmin token exchange and persistence boundary are in place. The exact activity and health endpoint URLs remain configuration-driven until selected from Garmin's Personal API Swagger operations. The OpenAI adapter is not connected yet.

## Local development

```bash
cp .env.example .env
npm run db:migrate
npm run dev
```

Open http://localhost:3000.

## Raspberry Pi

Create `.env` with server-only secrets, then run:

```bash
docker compose up -d --build
```

The app will be available on port 3000. Keep the Garmin and OpenAI keys out of the repository and never prefix them with `NEXT_PUBLIC_`.

The protected sync route is `POST /api/garmin/sync` with the `x-sync-secret` header. The status route is `GET /api/garmin/status`.

## Quality checks

```bash
npm run lint
npm run build
```

## Planned next slices

1. SQLite and Drizzle schema.
2. Garmin Personal API token and incremental activity sync.
3. Deterministic load, HR-at-pace and recovery metrics.
4. Low-cost OpenAI Responses API coach adapter with structured output validation.
5. Workout generator and Garmin-ready copy/export workflow.
