#!/bin/sh
set -eu
export APP_URL="${RENDER_EXTERNAL_URL:?}"
export SANCTUM_STATEFUL_DOMAINS="${RENDER_EXTERNAL_HOSTNAME:?}"
# Render supplies a stable generated secret. Laravel expects a 32-byte key.
export APP_KEY="$(php -r 'echo "base64:".base64_encode(hash("sha256", getenv("APP_SECRET") ?: exit(1), true));')"
test -n "$APP_KEY"
php artisan migrate --force
exec supervisord -c /etc/supervisor/supervisord.conf
