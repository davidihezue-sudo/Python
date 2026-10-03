# Backup and restore

PostgreSQL is the system of record: orders, the ledger, payouts, audit logs and settings all live there. Uploaded documents and images live in the storage provider (`STORAGE_LOCAL_DIR` by default) and must be backed up with it.

## What to back up

| Data | How | Frequency |
| --- | --- | --- |
| PostgreSQL | Managed point in time recovery, plus a nightly logical dump kept off site | Continuous WAL, nightly dump |
| Uploaded files | Snapshot or object storage versioning | Daily |
| Configuration | Keep environment variables in your secret manager | On change |

## Logical backup and restore

```bash
# Backup (custom format, compressed)
pg_dump --format=custom --no-owner --file=eazyfoods-$(date +%F).dump "$DATABASE_URL"

# Restore into an empty database
createdb eazyfoods_restore
pg_restore --no-owner --dbname=eazyfoods_restore eazyfoods-2026-01-01.dump
```

After a restore, run a ledger check before reopening the platform:

1. Sign in to the operations portal, open Finance and payouts, and confirm the banner reads "Ledger is balanced" and the payments reconciliation reports no differences.
2. Run `node apps/api/dist/migrate.js` to apply any migration newer than the backup.
3. Start the API, then the worker. Stop the worker first when restoring so no job runs against a half restored database.

## Recovery targets to agree with the business

The ledger is append only and every order change is in `order_status_history` and `audit_logs`, so a point in time restore never loses the explanation for a balance. Decide and document your recovery point objective (how much data you can lose) and recovery time objective (how long you can be down). With managed Postgres point in time recovery, a recovery point of a few minutes is normal. Test a restore into a scratch environment at least once a quarter; an untested backup is not a backup.

## Retention

Audit logs and ledger entries are kept indefinitely. Driver location history is pruned after 30 days by the `prune_driver_locations` job. Account closure removes personal details but keeps order and ledger rows with the name removed, because tax and refund records must be kept.
