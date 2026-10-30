# Raspberry Pi homelab deployment

This app is an independent Compose project alongside the existing `docker-home` stack. Do not merge or overwrite the main Compose file, its `.env`, proxy, DNS, authentication, setup, or backup configuration. Starting or stopping this project never requires restarting shared services.

## Files on the Pi

Under `/home/pi-user/docker-home`:

- `docker-compose.coach.yml` — copy of `deploy/compose.pi.yml`.
- `configs/garmin-ai-coach/coach.env` — server credentials, mode 0600, excluded by that directory's `.gitignore`.
- `configs/garmin-ai-coach/coach.env.example` — placeholders only.
- `data/garmin-ai-coach/coach.db` — persistent SQLite, UID/GID 1001, directory 0700.
- `data/garmin-ai-coach-deploy-state/baseline.json` — pre-deployment container IDs, restart counts, start times, and shared configuration hashes. No credentials are captured.
- `setup-garmin-coach.sh` — provisions only the coach directories. Do not run the homelab's full setup script.
- `backup-garmin-coach.sh` — online SQLite backup to `/mnt/backups/garmin-ai-coach`; keeps 14 verified snapshots and copies this app's private environment/deployment file. Does not stop containers.

The web and worker run as UID 1001 with read-only roots, dropped capabilities, no privilege escalation, bounded logs, CPU and memory limits. The web is limited to 512 MiB / 0.75 CPU; the worker to 256 MiB / 0.25 CPU. Only the web joins `proxy_network`; the worker has its own outbound network and no published port.

## Access

- Immediate private LAN access: `http://192.168.1.10:3100`. The port binds only to that LAN address.
- Existing Traefik HTTPS route: `https://coach.home.arpa`, once that name resolves to `192.168.1.10` on clients. This deployment does not modify DNS or shared Traefik configuration. Use the homelab's existing trusted wildcard certificate.
- `APP_ALLOWED_ORIGINS` explicitly includes both addresses. There is no added sign-in, matching this app's trusted-private-network design.

## Exact service commands

From `docker-home`, always select this file/project explicitly:

```bash
docker compose --env-file configs/garmin-ai-coach/coach.env -p garmin-ai-coach -f docker-compose.coach.yml config --quiet
docker compose --env-file configs/garmin-ai-coach/coach.env -p garmin-ai-coach -f docker-compose.coach.yml up -d --no-deps coach garmin-worker
docker compose --env-file configs/garmin-ai-coach/coach.env -p garmin-ai-coach -f docker-compose.coach.yml ps
docker compose --env-file configs/garmin-ai-coach/coach.env -p garmin-ai-coach -f docker-compose.coach.yml logs --tail 30 coach garmin-worker
```

Never run the homelab's unqualified `up`, `down`, `pull`, cleanup/prune, setup, or backup scripts as part of this app deployment. Existing local and Pi copies have independent edits.

## Build away from the live Pi

Use the dedicated Colima profile `garmin-coach-build`: ARM64 Linux, 2 CPUs, 4 GiB RAM, no personal-folder mounts or port forwarding. It does not replace or activate the existing Docker context. Stop this profile after building. Build the exact committed source, excluding `.env`, databases, macOS modules and local output.

The production Dockerfile installs Python/make/g++ only in the dependency stage because `better-sqlite3` compiles a native addon. Existing dependency versions stay pinned. The builder runs types, all tests and the production build; the final image contains only the standalone runtime, assets and worker. Pin `NODE_IMAGE` to the verified digest and tag/label the image with the Git revision.

```bash
colima start garmin-coach-build --arch aarch64 --cpus 2 --memory 4 --disk 20 --activate=false --ssh-config=false --mount none --port-forwarder none
docker --context colima-garmin-coach-build build --platform linux/arm64 --build-arg APP_REVISION=<revision> -t garmin-ai-coach:<revision>-arm64 .
```

Export the finished image, copy it over SSH and load it on the Pi. This avoids compiling on the live server. Verify ARM64 architecture, image revision and target container health before enabling provider jobs. Never use macOS standalone output.

An initial capped build on the system SD card caused storage latency. It was stopped; all 31 original containers retained their IDs/start times/restart counts. Moving files to the backup drive relieved that pressure; final compilation happens off-Pi. Do not repeat a full dependency installation/build on the live server's SD card.

## Data migration and cutover

Keep the Mac app available while building. At cutover, stop its supervisor/worker, take an online SQLite backup with `better-sqlite3`, and transfer it over SSH. Preserve a second pre-deployment snapshot. Install it as UID 1001, mode 0600; do not copy a live main database file without its WAL.

Transfer only the app's server configuration over SSH with protected permissions. First smoke-test the Pi with automatic sync disabled and no OpenAI key; then restore the intended environment and recreate **only these two coach services**. Keep the local worker stopped afterwards to avoid two independent copies generating recommendations or syncing. The Mac database remains a rollback snapshot, not a second live source of truth.

Verify the running web, assets, all screens, origin checks, native SQLite, worker heartbeat, successful Garmin sync, one configured AI model/key (without making a paid smoke-test request), and data counts/targets/check-ins. Make an online backup, verify it independently in a network-disabled container, then restart only the coach services to verify persistence.

A separate `/etc/cron.d/garmin-ai-coach-backup` runs the app-only backup daily at 02:40 in the Pi's local timezone. It does not edit the existing backup job. The backup drive must be mounted; failure leaves prior snapshots intact. The backup contains private health data and credentials, so preserve its 0700 directory / 0600 credential permissions.

## Rollback

Stop only these services (data is retained):

```bash
docker compose --env-file configs/garmin-ai-coach/coach.env -p garmin-ai-coach -f docker-compose.coach.yml stop coach garmin-worker
```

For an upgrade rollback, change `GARMIN_COACH_IMAGE` to the retained previous immutable image and run the scoped `up` command. If schema restoration is needed, stop both coach services first, restore the matching verified SQLite snapshot and permissions, and start only those services. Do not restore the old Mac snapshot over newer Pi data or run both workers. Removing this project's containers/network does not require removing `proxy_network`, host data, or touching any other stack.
