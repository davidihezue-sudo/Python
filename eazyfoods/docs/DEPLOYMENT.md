# Deployment

## Processes

| Process | Command | Scale |
| --- | --- | --- |
| API | `node apps/api/dist/server.js` | Stateless. Run two or more behind a load balancer. |
| Worker | `node apps/api/dist/worker.js` | Run one or two. Jobs are claimed with `FOR UPDATE SKIP LOCKED`, so extra workers are safe. |
| Web | `next start -p 3000` in `apps/web` | Stateless. Scale horizontally. |
| PostgreSQL | managed Postgres 16 | Use a managed service with point in time recovery. |

Build: `npm ci && npm run build` (compiles the API with `tsup` and the web app with `next build`). Container images are defined in `deploy/Dockerfile.api` and `deploy/Dockerfile.web`; `docker-compose.yml` runs the full stack locally.

## First deployment

1. Create the database and a role with rights to create extensions (`pg_trgm`, `unaccent`, `pgcrypto`, `citext`).
2. Set the environment variables from `.env.example`. At minimum in production: `NODE_ENV=production`, `DATABASE_URL`, `APP_URL`, `CORS_ORIGINS`, `SECURE_COOKIES=true`, and the payment provider keys.
3. Run migrations: `node apps/api/dist/migrate.js`. Migrations are numbered, run in one transaction each, and recorded so they apply once. Do not use `--reset` (it refuses to run in production).
4. Create the first super admin. The demo seed refuses to run in production, so insert the first administrator with a one off script or SQL, then add everyone else from the Staff screen in the operations portal. Do not leave any `*.demo.eazyfoods.test` account in a real environment.
5. Review the settings in the operations portal (Settings, fees and zones): service fee, commission, delivery zones and fee rules, tax rates, payout schedule, privacy options, compliance document rules. These ship with sensible defaults but are business decisions.

## Domains and cookies

Either serve everything from one host (portals live at `/vendor`, `/chef`, `/driver`, `/admin`, `/marketing`), or point `vendor.`, `chef.`, `driver.`, `admin.` and `marketing.` sub domains at the same web deployment; `apps/web/src/proxy.ts` rewrites by host. For the sub domain layout set `COOKIE_DOMAIN=.eazyfoods.ca` so a single sign in works across them, and add every origin to `CORS_ORIGINS`.

Put TLS in front of both the web app and API. Server sent events need the proxy to disable response buffering (the API already sends `X-Accel-Buffering: no`) and an idle timeout above 30 seconds (heartbeats are sent every 25 seconds).

## Health, logs, jobs

* `GET /api/health` returns 200 when the API can reach Postgres.
* Logs are structured JSON (pino). Set `LOG_LEVEL`.
* Background jobs and their schedules are listed in `apps/api/src/jobs-registry.ts`: unpaid order expiry (every minute), offer expiry (30 seconds), promotion lifecycle, document expiry reminders, payout cycle, analytics roll up, fraud scan, subscription billing, abandoned cart reminders, location pruning.
* A failing job is retried with back off and then kept in the `jobs` table with its error for inspection.

## Scaling notes

* Search uses Postgres full text and trigram indexes. At large catalogue sizes move search to a dedicated engine behind the same `searchProducts` function.
* Server sent events hold one connection per open page. Each API process listens on one Postgres connection for `NOTIFY`, so fan out scales with API processes, not database connections.
* Uploaded files use the `local` storage provider by default. In a multi instance deployment mount shared storage or implement the S3 compatible provider in `apps/api/src/lib/storage.ts` (the interface is small).
