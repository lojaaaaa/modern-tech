#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
api_id=$(docker compose ps -q api)
if [[ -z "$api_id" ]]; then
  echo 'PostgreSQL tests require the local api container. Start Docker Compose first.' >&2
  exit 1
fi
qa_name="modern-tech-postgres-test-$$"
# Separate ephemeral database, sharing only the API network namespace, never app data.
qa_port=55439
cleanup() { docker rm -f "$qa_name" >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker run -d --name "$qa_name" --network "container:$api_id" \
  -e POSTGRES_DB=modern_tech_postgres_test -e POSTGRES_USER=modern_tech_test \
  -e POSTGRES_PASSWORD=modern-tech-test-only postgres:18-alpine -p "$qa_port" >/dev/null
ready=0
for attempt in {1..30}; do
  if docker exec "$qa_name" pg_isready -h 127.0.0.1 -p "$qa_port" -U modern_tech_test -d modern_tech_postgres_test >/dev/null 2>&1; then ready=1; break; fi
  sleep 1
done
if [[ "$ready" != 1 ]]; then echo 'Isolated PostgreSQL did not become ready.' >&2; exit 1; fi
docker compose exec -T -e POSTGRES_TEST_PORT="$qa_port" api vendor/bin/phpunit tests/Postgres
