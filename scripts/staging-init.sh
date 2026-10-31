#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
umask 077
mkdir -p .local/staging
python3 - <<'PY'
from pathlib import Path
import base64
import secrets
folder = Path('.local/staging')
compose = folder / 'compose.env'
backend = folder / 'backend.env'
if not compose.exists():
    compose.write_text('DB_PASSWORD=' + secrets.token_hex(24) + '\nSTAGING_PORT=8089\nRELEASE_TAG=staging\n')
settings = dict(line.split('=', 1) for line in compose.read_text().splitlines() if '=' in line and not line.startswith('#'))
if not backend.exists():
    content = Path('backend/.env.example').read_text()
    content = content.replace('APP_ENV=local', 'APP_ENV=production')
    content = content.replace('APP_KEY=\n', 'APP_KEY=base64:' + base64.b64encode(secrets.token_bytes(32)).decode() + '\n')
    content = content.replace('DB_PASSWORD=change-me', 'DB_PASSWORD=' + settings['DB_PASSWORD'])
    content = content.replace('http://localhost:8088', 'http://localhost:' + settings['STAGING_PORT'])
    content = content.replace('localhost:8088,localhost:5173', 'localhost:' + settings['STAGING_PORT'])
    backend.write_text(content)
PY
printf 'Staging configuration ready in .local/staging; existing settings preserved.\n'
