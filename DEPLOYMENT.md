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
| Admin | `ADMIN_EMAILS=you@example.com` - verified accounts with these emails become platform admins |
| Rate limiting | `RATE_LIMIT_STORE=postgres` when running more than one web instance |
| Proxy | terminate TLS in front; the proxy must set `X-Forwarded-For`/`Host`; cookies are `Secure` in production |
| Plans | `BILLING_MODE=disabled` (everything free) or `enforced` (plan limits apply) |
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
pg_dump --format=custom --no-owner "$DATABASE_URL" > familyfinance-$(date +%F).dump
# restore into an empty database
createdb familyfinance_restore && pg_restore --no-owner -d familyfinance_restore familyfinance-2026-01-01.dump
```
Managed Postgres: enable point-in-time recovery. **Files** live outside the database - back up the uploads volume or enable S3 versioning/replication; the `Document` table references objects by `fileKey`. Rehearse restores quarterly.

## Monitoring

* Liveness `GET /api/health`; readiness `GET /api/health?deep=1` (503 when the database is unreachable).
* Admin → *Recent background jobs* shows every job run, status and stats; alert if `notifications.generate` hasn't succeeded for > 1 h.
* Logs are JSON with request ids (`x-request-id` echoed on every response and error body).
* Error monitoring: set `ERROR_MONITORING_DSN` and register a reporter (integration point provided; vendor SDK not bundled).

## Deployment procedure

1. `npm ci && npm run typecheck && npm run lint && npm test && npm run test:integration`
2. Build image: `docker build -t familyfinance .`
3. Release step: `docker run --env-file .env familyfinance migrate`
4. Roll out `web` then `worker` with the new image; verify `/api/health?deep=1`.
5. Smoke test: sign in, open dashboard, run Admin → jobs.

## Verification performed in the build environment

PostgreSQL 16 (local), Node 22, Chromium via Playwright: migrations, seeds, typecheck, lint, 140+ unit/integration tests, production build, and end-to-end journeys A–E, security and mobile/offline suites were run. **Not verifiable in the build sandbox** (no credentials / no Docker daemon / no internet to third parties): Google OAuth against Google, S3 against a real bucket, SMTP delivery, web-push delivery, the Anthropic AI/OCR providers, NHTSA VIN decoding (code + mapping tested, network call not), and building/running the Docker image. Each has a documented fallback and is isolated behind an interface.

## Known limitations

* No payment processing (by design) - the entitlement model is ready for Stripe webhooks writing `Subscription`.
* OCR for photos/scans needs an external provider; the built-in provider reads text-layer PDFs only.
* BMW ConnectedDrive/CarData integration is an unimplemented provider slot (no documented public API is assumed).
* Background Sync / push availability depends on the browser (iOS needs the installed PWA, 16.4+); fallbacks are in place.
* Multi-currency amounts are never converted; analytics use the dominant/preferred currency and report excluded rows.
* Intervals in the library are generic suggestions - **not** manufacturer data (the BMW X3 profile deliberately contains no authoritative BMW intervals).

## HTTPS with Caddy (recommended for anything beyond your own computer)

Phones, and password managers, expect HTTPS, and the app only marks its session cookie `Secure` when `APP_URL` starts with `https://`. The repository includes a small Caddy setup that gets and renews a free certificate for you.

1. Point a domain (for example `finance.example.com`) at the machine that runs Docker, and open ports 80 and 443.
2. In `.env` set:
   ```
   DOMAIN=finance.example.com
   APP_URL=https://finance.example.com
   WEB_BIND=127.0.0.1:3000
   ```
   `WEB_BIND` stops the app from being reachable directly over plain HTTP from other machines.
3. Start everything:
   ```bash
   docker compose -f docker-compose.yml -f deploy/docker-compose.https.yml up -d --build
   ```
4. Open `https://finance.example.com`.

Notes
- Certificates are stored in the `caddy_data` volume. Do not delete it, or Caddy will ask for new certificates and may hit rate limits.
- If you already run another reverse proxy (nginx, Traefik, a cloud load balancer), do not use Caddy: proxy to `web:3000`, forward the `Host` and `X-Forwarded-*` headers, and set `APP_URL` to the public https address.
- Using this app only at home? You can use `http://` on your own network. Some browser features (installing the app on a phone, the camera for receipts on some devices) need HTTPS, which is another reason to set this up.
- This setup file has not been run against a live domain in the build environment. Check the first start with `docker compose logs caddy`.

## Backups and restore

- **Whole database (administrator):** `npm run backup` (or `pg_dump -Fc`) writes a dump; restore it into an empty database with `pg_restore`. Back up the `uploads` volume (or your S3 bucket) too, because receipts and documents are files, not database rows. There is no in-app restore.
- **Per person:** Tools, Backup and history downloads everything that member can see as JSON.
