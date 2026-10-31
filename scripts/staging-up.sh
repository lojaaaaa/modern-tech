#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
bash scripts/staging-init.sh
compose=(docker compose --env-file .local/staging/compose.env -f compose.staging.yaml)
"${compose[@]}" config --quiet
"${compose[@]}" build api web
"${compose[@]}" up -d postgres redis-queue redis-cache tika gotenberg clamav mailpit
"${compose[@]}" run --rm api php artisan migrate --force
"${compose[@]}" up -d --wait --wait-timeout 180 api web worker worker-processing worker-transfers scheduler
"${compose[@]}" ps
