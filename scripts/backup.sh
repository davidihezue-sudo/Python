#!/usr/bin/env bash
# PostgreSQL backup. Usage: DATABASE_URL=... scripts/backup.sh [output-dir]
# Keeps the 14 most recent dumps. Also copy STORAGE_LOCAL_DIR (uploaded documents) if you use local storage.
set -euo pipefail
OUT="${1:-./backups}"
URL="${DATABASE_URL:?DATABASE_URL is required}"
URL="${URL%%\?*}"   # pg_dump does not accept Prisma's ?schema= suffix
mkdir -p "$OUT"
FILE="$OUT/familyfinance-$(date -u +%Y%m%dT%H%M%SZ).dump"
pg_dump --format=custom --no-owner --file "$FILE" "$URL"
echo "Wrote $FILE"
ls -1t "$OUT"/familyfinance-*.dump | tail -n +15 | xargs -r rm --
