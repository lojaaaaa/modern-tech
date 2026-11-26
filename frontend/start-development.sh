#!/bin/sh
set -eu
cd /app
expected=$(sha256sum package-lock.json | cut -d ' ' -f 1)
stamp=node_modules/.modern-tech-lock
if [ ! -f "$stamp" ] || [ "$(cat "$stamp")" != "$expected" ]; then
    printf 'Updating local frontend dependencies…\n'
    npm ci --registry=https://registry.npmjs.org
    printf '%s\n' "$expected" > "$stamp"
fi
exec npm run dev
