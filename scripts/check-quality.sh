#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
echo 'Checking frontend: lint, types, tests and production build…'
(cd frontend && npm run lint && npm run typecheck && npm test && npm run build)
echo 'Checking backend: style, static analysis and tests…'
docker compose exec -T api vendor/bin/pint --test
docker compose exec -T api vendor/bin/phpstan analyse --memory-limit=512M --no-progress
docker compose exec -T api php artisan test
bash scripts/test-postgres.sh
