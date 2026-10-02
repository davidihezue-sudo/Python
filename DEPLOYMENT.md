# Deployment

## Requirements

Node 20+ (22 recommended) or Docker · PostgreSQL 14+ (16 tested) · a place for files (local volume or S3-compatible bucket) · an SMTP provider for real email (optional but recommended).

## Local development

```bash
cp .env.example .env && npm install
npx prisma migrate deploy && npm run db:seed && npm run db:seed:demo
npm run dev   # + `npm run worker` in another terminal
```
Dev email links: <http://localhost:3000/dev/outbox>.

## Docker / Compose

`docker compose up --build` starts `web` (migrates + seeds reference data, then serves), `worker`, `db`. Set at least `AUTH_SECRET`, `POSTGRES_PASSWORD`, `APP_URL`, `CRON_SECRET` in `.env`. Add `--profile dev` for Mailpit and MinIO.

## Production configuration checklist

| Item | Setting |
|---|---|
| Secrets | `AUTH_SECRET` (≥32 random chars; production refuses placeholder values) · `DATABASE_URL` (use `?sslmode=require` for managed Postgres) |
| URL | `APP_URL=https://your.domain` (used for email links, OAuth redirect and CSRF origin matching) |
| Email | `SMTP_*`, `EMAIL_FROM`; keep `REQUIRE_EMAIL_VERIFICATION=true` |
| Storage | `STORAGE_DRIVER=s3` + bucket credentials (enable bucket encryption, block public access) |
| Jobs | run the `worker` service **or** set `ENABLE_INPROCESS_JOBS=true` (single instance) **or** schedule `POST /api/cron/run` every 5–15 min with `CRON_SECRET` |
| Admin | `ADMIN_EMAILS=you@example.com` — verified accounts with these emails become platform admins |
| Rate limiting | `RATE_LIMIT_STORE=postgres` when running more than one web instance |
| Proxy | terminate TLS in front; the proxy must set `X-Forwarded-For`/`Host`; cookies are `Secure` in production |
| Plans | `BILLING_MODE=disabled` (everything free) or `enforced` (Free = 1 vehicle) |
| Logging | structured JSON to stdout (`LOG_LEVEL`); wire an error reporter via `registerErrorReporter` in `src/lib/logger.ts` (Sentry etc.) |

### Provider notes

* **Railway / Render / Fly.io**: deploy the Dockerfile; add a managed Postgres, set env vars, create a second service/process with command `worker` (or use their cron to call `/api/cron/run`). Mount a volume or use S3 for uploads (serverless-style ephemeral disks lose files). Health check path: `/api/health` (`?deep=1` verifies the DB).
* **AWS**: ECS/Fargate (web + worker tasks) or App Runner, RDS PostgreSQL, S3 bucket, SES SMTP. Put an ALB/CloudFront in front.
* Database migrations run at container start; for zero-downtime blue/green, run `docker run … migrate` (entrypoint command `migrate`) as a release step and set `RUN_MIGRATIONS=false` on web instances.

## Database migrations

`npx prisma migrate deploy` (idempotent). Migrations are forward-only SQL committed under `prisma/migrations`. Test a restore + migrate before major upgrades.

## Backup and restore

```bash
# backup (daily; keep 7 daily / 4 weekly / 6 monthly)
pg_dump --format=custom --no-owner "$DATABASE_URL" > autovault-$(date +%F).dump
# restore into an empty database
createdb autovault_restore && pg_restore --no-owner -d autovault_restore autovault-2026-01-01.dump
```
Managed Postgres: enable point-in-time recovery. **Files** live outside the database — back up the uploads volume or enable S3 versioning/replication; the `Document` table references objects by `fileKey`. Rehearse restores quarterly.

## Monitoring

* Liveness `GET /api/health`; readiness `GET /api/health?deep=1` (503 when the database is unreachable).
* Admin → *Recent background jobs* shows every job run, status and stats; alert if `notifications.generate` hasn't succeeded for > 1 h.
* Logs are JSON with request ids (`x-request-id` echoed on every response and error body).
* Error monitoring: set `ERROR_MONITORING_DSN` and register a reporter (integration point provided; vendor SDK not bundled).

## Deployment procedure

1. `npm ci && npm run typecheck && npm run lint && npm test && npm run test:integration`
2. Build image: `docker build -t autovault .`
3. Release step: `docker run --env-file .env autovault migrate`
4. Roll out `web` then `worker` with the new image; verify `/api/health?deep=1`.
5. Smoke test: sign in, open dashboard, run Admin → jobs.

## Verification performed in the build environment

PostgreSQL 16 (local), Node 22, Chromium via Playwright: migrations, seeds, typecheck, lint, 140+ unit/integration tests, production build, and end-to-end journeys A–E, security and mobile/offline suites were run. **Not verifiable in the build sandbox** (no credentials / no Docker daemon / no internet to third parties): Google OAuth against Google, S3 against a real bucket, SMTP delivery, web-push delivery, the Anthropic AI/OCR providers, NHTSA VIN decoding (code + mapping tested, network call not), and building/running the Docker image. Each has a documented fallback and is isolated behind an interface.

## Known limitations

* No payment processing (by design) — the entitlement model is ready for Stripe webhooks writing `Subscription`.
* OCR for photos/scans needs an external provider; the built-in provider reads text-layer PDFs only.
* BMW ConnectedDrive/CarData integration is an unimplemented provider slot (no documented public API is assumed).
* Background Sync / push availability depends on the browser (iOS needs the installed PWA, 16.4+); fallbacks are in place.
* Multi-currency amounts are never converted; analytics use the dominant/preferred currency and report excluded rows.
* Intervals in the library are generic suggestions — **not** manufacturer data (the BMW X3 profile deliberately contains no authoritative BMW intervals).
