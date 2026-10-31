#!/usr/bin/env bash
set -euo pipefail
umask 077
cd "$(dirname "$0")/.."
backup_dir=".local/backups/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$backup_dir"
docker compose exec -T postgres pg_dump -U modern_tech -d modern_tech -Fc > "$backup_dir/database.dump"
docker compose exec -T api tar -C storage/app/private -czf - . > "$backup_dir/documents.tar.gz"
cp .env "$backup_dir/compose.env"
cp backend/.env "$backup_dir/api.env"
printf '%s\n' 'Private local backup. Contains application encryption key and credentials. Never commit or share.' > "$backup_dir/README.txt"
printf 'Backup saved to %s\n' "$backup_dir"
