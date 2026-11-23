# Docker and Raspberry Pi deployment

[Project overview](../README.md) · [Architecture](../docs/architecture.md)

The repository provides a standalone Compose setup and a separate homelab template. Use the latter when this app shares a Raspberry Pi with other services.

## Standalone installation

From the project root, create `.env` from [.env.example](../.env.example), add the required Garmin key and optional OpenAI key, then run:

```bash
docker compose up -d --build
docker compose ps
```

The web service listens on port 3000. The `garmin-worker` service has no published port. Both share the `coach-data` named volume at `/app/data`; retain it during upgrades.

Use a 64-bit OS for an ARM64 Raspberry Pi. The Dockerfile includes the native build tools needed by SQLite bindings and runs the resulting application as UID/GID 1001.

## Existing homelab stack

[compose.pi.yml](compose.pi.yml) defines the independent `garmin-ai-coach` project, with scoped web/worker services, persistent bind-mounted data, resource limits and hardened runtime settings.

The template assumes an existing `proxy_network` and Traefik configuration. Review its router hostname, TLS settings, network and LAN binding for your environment. Use a trusted LAN/VPN: the app has no sign-in.

Expected files inside the homelab directory:

```text
homelab/
  docker-compose.coach.yml
  setup-garmin-coach.sh
  backup-garmin-coach.sh
  configs/garmin-ai-coach/
    coach.env.example
    coach.env
  data/garmin-ai-coach/
    coach.db
  data/garmin-ai-coach-deploy-state/
```

For a first installation, copy the Compose template, [environment example](coach.env.example) and app-specific setup/backup scripts into this layout. Run `setup-garmin-coach.sh` from that homelab directory. It provisions only the app directories and preserves an existing private environment file.

Edit `configs/garmin-ai-coach/coach.env` before starting:

| Setting                  | Purpose                                       |
| ------------------------ | --------------------------------------------- |
| `GARMIN_COACH_IMAGE`     | Worker image and default web image.           |
| `GARMIN_COACH_WEB_IMAGE` | Optional independent web image override.      |
| `GARMIN_COACH_BIND_IP`   | The host's intended LAN/VPN address.          |
| `APP_ALLOWED_ORIGINS`    | Custom private origins used to reach the app. |
| `DATABASE_PATH`          | `/app/data/coach.db` inside both containers.  |

Add the provider keys described in the [main configuration table](../README.md#configuration). Keep the private environment mode at `0600` and the data directory writable by UID/GID 1001. Do not replace an existing homelab's main Compose file, `.env`, proxy, authentication or DNS configuration.

### Scoped service commands

Run these from the homelab directory, not the app checkout:

```bash
docker compose --env-file configs/garmin-ai-coach/coach.env -p garmin-ai-coach -f docker-compose.coach.yml config --quiet
docker compose --env-file configs/garmin-ai-coach/coach.env -p garmin-ai-coach -f docker-compose.coach.yml up -d --no-deps coach garmin-worker
docker compose --env-file configs/garmin-ai-coach/coach.env -p garmin-ai-coach -f docker-compose.coach.yml ps
docker compose --env-file configs/garmin-ai-coach/coach.env -p garmin-ai-coach -f docker-compose.coach.yml logs --tail 50 coach garmin-worker
```

Avoid unqualified stack-wide `up`, `down`, setup or cleanup commands on a shared host. For an existing installation, preserve local configuration rather than copying a fresh template over it.

## Build an ARM64 image

Build on a separate ARM64 machine or a builder that supports `linux/arm64`, rather than using a busy live Pi:

```bash
COACH_REVISION=$(git rev-parse --short HEAD)
docker build --platform linux/arm64 \
  --build-arg APP_REVISION="$COACH_REVISION" \
  -t "garmin-ai-coach:$COACH_REVISION-arm64" .
docker save "garmin-ai-coach:$COACH_REVISION-arm64" | gzip > "garmin-ai-coach-$COACH_REVISION-arm64.tar.gz"
```

For reproducible releases, also supply an immutable Node 22 image digest through the Dockerfile's `NODE_IMAGE` build argument. The image build runs types, tests and production/worker builds. `.env`, local databases and Git metadata are excluded from its context.

Transfer the archive to the target and load it with `docker load -i <archive>`. Update only the coach image settings in the private environment, validate Compose, and use the scoped service command above.

For UI-only releases, the independent web override can update only `coach`. Shared planning, data or worker changes generally require both services to use the compatible release.

## Backups

SQLite uses live database files that may have WAL sidecars. Use SQLite's online backup API; do not copy only the main live file.

For the homelab layout, [backup-garmin-coach.sh](backup-garmin-coach.sh) expects a mounted `/mnt/backups`. It creates an online snapshot, normalizes its journal mode, checks integrity, retains 14 snapshots and copies only this app's deployment/private environment files. It does not stop any service.

```bash
./backup-garmin-coach.sh
```

Keep backups and their private environment file protected. Configure recurring execution in the host's existing scheduler if desired. For standalone Compose, use the same online-backup approach against its named volume; the supplied homelab script assumes the homelab container names and paths.

## Upgrade and rollback

Before upgrading, record the current image settings and take a verified online backup. Keep the previous image available. On a shared host, capture service identities and configuration fingerprints so unrelated services can be checked afterward.

After the scoped update, verify web/worker health, Garmin status, a saved week's steps, persisted history and unaffected neighboring services. Database initialization/migrations run on first use; rehearse unfamiliar changes on a disposable backup first.

For image-only rollback, restore the two coach image settings and recreate only the scoped services. Retain the current database. An older image must understand the newer stored plan/schema format; use a compatible release or forward fix otherwise. Never overwrite newer athlete data with a stale backup just to undo a code release.

## Operations

- `GET /api/garmin/status` reports sync state and worker availability. A healthy worker lease is separate from successful Garmin connectivity.
- Scheduled sync normally runs on startup and every three hours, with persisted cooldowns and bounded retries.
- `GARMIN_AUTO_SYNC=false` disables scheduled Garmin calls; manual sync remains available.
- Local production mode uses `npm run build && npm start`; Docker runs the web app and worker separately.
- After changing provider keys or environment settings, restart the affected app services.
