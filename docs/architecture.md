# Architecture

[Project overview](../README.md) · [Deployment](../deploy/README.md)

## Runtime

The application has two long-running processes:

| Process         | Responsibility                                                                        |
| --------------- | ------------------------------------------------------------------------------------- |
| Next.js web app | Server-rendered screens, local API routes, planning views and user actions.           |
| Garmin worker   | Scheduled imports, persistent retry scheduling and optional background coach reviews. |

Both use the same SQLite database. `npm start` launches both for a local production installation. Docker Compose runs them as separate services, with no published port on the worker.

Development uses `npm run dev` plus a separately compiled worker. Rebuild the worker after changing its TypeScript source.

## Code organization

```text
src/
  app/                  Next.js routes, layouts and API handlers
  components/
    atoms/              Basic controls and visual primitives
    molecules/          Focused combinations such as workout steps and notices
    organisms/          Functional panels and workspaces
    templates/          Page composition
  shared/               Typed contracts and pure planning rules
  server/
    db/                 SQLite access, schema and migrations
    garmin/             Authentication, API requests, import and scheduling
    training/           Persistence, evidence, calendar projection and reviews
    coach/              Model adapters, constraints, caching and approval
```

Components follow Atomic Design. Shared planning functions do not need browser state or provider credentials. Server modules own Garmin/OpenAI calls and database access.

## Planning and approval

1. Stored activity, health data, settings and events feed the local planner.
2. Local rules build bounded weekly options and a proposed calendar.
3. An optional AI review selects among the supplied options and explains the evidence.
4. The user accepts a new week once. Schedule edits use their own preview and apply flow.
5. Automatic race-recovery assessment may restore only the existing base range for eligible upcoming runs. It cannot add mileage, quality or a higher calibrated target.

Future calendars are forecasts. They are never evidence of completed training. The AI cannot create arbitrary workouts, bypass local validation or upload to Garmin.

## Persistence and history

SQLite stores imported activity/health data, plans, preferences, commitments, feedback, prescription versions, schedule changes, sync leases and coach request history. Migrations initialize tables on first use; `npm run db:migrate` initializes them explicitly.

A saved week is a reviewed snapshot. Calendar projection applies events, availability and guarded recovery rules without rebuilding historical training from today's settings. Prescription versions retain the targets known before an activity began. A later capture cannot establish what was prescribed in the past.

Automatic recovery assessments are derived from current evidence, not persisted as athlete attestations. Resulting upcoming prescription changes are versioned after sync, date rollover or relevant user updates. Recorded workouts retain an unambiguous version known at activity start.

## Garmin integration

The integration uses the official [Garmin Connect Personal API](https://developer.garmin.com/gc-developer-program/personal/swagger-docs/).

- A personal API key is exchanged for an access token, retained in memory with an expiry margin. A 401 allows one renewal.
- The first import covers 90 days. Incremental imports replay the previous seven days to capture late uploads and corrections.
- Activity, daily health and sleep data are normalized and committed transactionally. Missing measurements stay null. Failed imports retain the last successful checkpoint.
- Selected recent activity detail is enriched separately; unavailable detail cannot roll back the core import. Attached workouts and grouped split summaries are not proof of interval execution.
- Garmin deletions are not currently mirrored.

The worker normally attempts sync on startup and every three hours. SQLite leases prevent competing workers/imports. Persisted cooldowns and bounded retries avoid replaying every missed interval after downtime. Manual sync resets the scheduled interval.

The UI polls local sync status while visible, refreshing when imports or the Lisbon calendar date change. A healthy worker means its leadership lease is current; it does not prove that Garmin connectivity or credentials are working.

## AI cost and failure boundaries

AI reviews use the OpenAI Responses API with structured output, server-side validation and locally allowed actions. Changing the configured model requires compatibility with the adapter's Responses, structured-output and reasoning settings.

| Control                  | Current behavior                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------------- |
| Shared request limits    | Six fresh attempts per Lisbon day; 60 per calendar month. Failed attempts count.                  |
| Cached reviews           | Reused for the same model, prompt version and training fingerprint.                               |
| Daily background review  | At most one automatic attempt per eligible day.                                                   |
| Weekly background review | One preparation attempt per week, subject to eligibility.                                         |
| Provider retries         | No automatic AI retry or model fallback.                                                          |
| Input/output bounds      | Daily input capped at 24 KB, weekly at 18 KB; output capped at 1,600 and 900 tokens respectively. |

These are request and token controls, not a monetary budget. Actual cost depends on model pricing. The local planner remains usable without an OpenAI key or after an AI failure. Page reads, schedule previews, feedback saves and automatic recovery checks do not call OpenAI.

## Privacy and access

This app has no user authentication. It is intended for a trusted LAN/VPN; host/origin checks protect browser requests but do not authenticate people who can reach the service.

Garmin keys, access tokens and OpenAI keys stay server-side. Enabled AI reviews send an allowlisted training/health summary; raw Garmin JSON, GPS coordinates, credentials, names and free-text check-in notes stay local. Requests set `store: false`; this should not be interpreted as eliminating all provider retention.

The UI's `x-coach-request` header is a non-secret same-origin request marker. `SYNC_SECRET` is an optional server-to-server secret, not a user login or app passphrase.

Dates and weekly boundaries use Europe/Lisbon. Recorded activity is retained even when it exceeds the plan's session limits.
