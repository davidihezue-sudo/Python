#!/bin/sh
set -e
case "$1" in
  web)
    # Apply pending migrations and make sure reference data (maintenance categories + suggested library) exists.
    if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
      npx prisma migrate deploy
      npx tsx prisma/seed.ts
    fi
    exec npx next start -p "${PORT:-3000}" -H 0.0.0.0
    ;;
  worker)
    exec npx tsx src/server/jobs/worker.ts
    ;;
  migrate)
    npx prisma migrate deploy && exec npx tsx prisma/seed.ts
    ;;
  *)
    exec "$@"
    ;;
esac
