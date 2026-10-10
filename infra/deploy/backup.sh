#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$(realpath "$0")")"
dir="$HOME/hmt/backups"
mkdir -p "$dir"
partial="$dir/.partial.sql.gz"
docker compose -f docker-compose.prod.yml --env-file "${HMT_ENV_FILE:-$HOME/hmt/.env}" exec -T postgres pg_dump -U hmt hmt | gzip > "$partial"
mv "$partial" "$dir/hmt-$(date +%F-%H%M).sql.gz"
ls -1t "$dir"/hmt-*.sql.gz | tail -n +49 | xargs -r rm --
