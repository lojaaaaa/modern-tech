#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [ ! -f .env ]; then
  printf 'DB_PASSWORD=%s\n' "$(openssl rand -hex 24)" > .env
  chmod 600 .env
fi
if [ ! -f backend/.env ]; then
  cp backend/.env.example backend/.env
  db_password=$(sed -n 's/^DB_PASSWORD=//p' .env)
  app_key=$(openssl rand -base64 32)
  DB_SECRET="$db_password" APP_SECRET="$app_key" python3 - <<'PY'
import os
from pathlib import Path
p=Path('backend/.env')
s=p.read_text().replace('DB_PASSWORD=change-me', 'DB_PASSWORD='+os.environ['DB_SECRET']).replace('APP_KEY=', 'APP_KEY=base64:'+os.environ['APP_SECRET'])
p.write_text(s)
PY
  chmod 600 backend/.env
fi
printf 'Local configuration ready. Existing secrets were preserved.\n'
