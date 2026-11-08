#!/usr/bin/env bash
set -euo pipefail
tools_dir="$(cd "$(dirname "$0")" && pwd)"
app_source="${1:-$(cd "$tools_dir/../.." && pwd)}"
state_dir="${2:-$app_source/.local/app-e2e}"
python3 "$tools_dir/bootstrap.py" --source "$app_source" --state-dir "$state_dir"
docker volume create modern-tech-app-e2e_web_modules >/dev/null
compose=(docker compose -f "$tools_dir/compose.yaml" --env-file "$state_dir/compose.env")
"${compose[@]}" config --quiet
"${compose[@]}" up -d --wait --wait-timeout 90 postgres redis-queue redis-cache mailpit
"${compose[@]}" run --rm --no-deps api php artisan migrate --force
"${compose[@]}" up -d --wait --wait-timeout 180 api web gateway
