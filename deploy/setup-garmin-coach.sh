#!/bin/bash
# Run from docker-home; only this app's new directories are provisioned.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
command -v docker >/dev/null
sudo install -d -o 1001 -g 1001 -m 0700 data/garmin-ai-coach
sudo install -d -o "$(id -u)" -g "$(id -g)" -m 0700 configs/garmin-ai-coach data/garmin-ai-coach-deploy-state
if [ ! -f configs/garmin-ai-coach/coach.env ]; then
    (umask 077; cp configs/garmin-ai-coach/coach.env.example configs/garmin-ai-coach/coach.env)
    echo "Add server keys to configs/garmin-ai-coach/coach.env before starting."
fi
echo "Coach-only directories ready; existing services were not changed."
