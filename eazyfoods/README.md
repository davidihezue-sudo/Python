# EAZyfoods

A multi-vendor marketplace for African and multicultural food: groceries and specialty foods from local stores, and prepared meals from home chefs, delivered or picked up. This repository is a standalone platform. It shares no code, data or configuration with any other project.

It contains six working surfaces built on one PostgreSQL database and one set of business rules:

| Surface | Route (localhost) | Production host (optional) | Who uses it |
| --- | --- | --- | --- |
| Customer app | `/` | `eazyfoods.ca` | Shoppers |
| Vendor portal | `/vendor` | `vendor.` | Store owners and staff |
| Chef portal | `/chef` | `chef.` | Home chefs |
| Driver app (PWA) | `/driver` | `driver.` | Delivery drivers |
| Marketing portal | `/marketing` | `marketing.` | Marketing and content team |
| Operations portal | `/admin` | `admin.` | Administrators, support, finance |

The web app reads the host name (`apps/web/src/proxy.ts`) so each portal can be served from its own sub domain, or from a path on one domain, without code changes.

## Stack

* **API**: Fastify 5, TypeScript, `pg`, zod. No ORM; every query is explicit SQL.
* **Database**: PostgreSQL 16 with `pg_trgm`, `unaccent`, `pgcrypto`, `citext`. Money is `NUMERIC(12,2)` in storage and integer cents in code.
* **Web**: Next.js 16 (App Router), React 19, TypeScript. Fonts are Manrope (headings) and Source Sans 3 (text), self-hosted.
* **Real time**: server sent events fed by Postgres `LISTEN/NOTIFY`.
* **Background jobs**: a Postgres backed queue with schedules, run by `apps/api/src/worker.ts`.

## Run it locally

Requirements: Node 22 or newer, PostgreSQL 16 (a running server you can create databases on).

```bash
npm install
cp .env.example .env                 # edit DATABASE_URL to point at your Postgres
createdb eazyfoods && createdb eazyfoods_test
npm run db:reset                     # creates every table and loads realistic demo data
npm run dev:api                      # http://localhost:4000
npm run dev:worker                   # dispatch, expiries, payouts, reminders
npm run dev:web                      # http://localhost:3000
```

Production style run: `npm run build`, then start `apps/api` (`node dist/server.js`, `node dist/worker.js`) and `apps/web` (`next start`). A Docker based stack is in `docker-compose.yml`.

## Demo accounts

All seeded accounts use the password in `DEMO_PASSWORD` (default `EazyDemo!2026`). The seed is for development and demos only and refuses to run in production.

| Role | Email |
| --- | --- |
| Customer | `amara@demo.eazyfoods.test`, `david@demo.eazyfoods.test`, `fatou@demo.eazyfoods.test` |
| Store owner (Mama Nkechi African Market) | `owner+nkechi@demo.eazyfoods.test` |
| Store owner (Island Spice, Sahel, Lagos Kitchen) | `owner+island@...`, `owner+sahel@...`, `owner+lagos@...` (same domain) |
| Chef | `owner+ada@demo.eazyfoods.test`, `owner+kofi@demo.eazyfoods.test`, `owner+selam@demo.eazyfoods.test` |
| Driver | `samuel@driver.demo.eazyfoods.test`, `yasmin@driver.demo.eazyfoods.test` |
| Super admin | `admin@demo.eazyfoods.test` |
| Operations | `ops@demo.eazyfoods.test` |
| Vendor admin | `vendors@demo.eazyfoods.test` |
| Support | `support@demo.eazyfoods.test` |
| Finance | `finance@demo.eazyfoods.test` |
| Marketing | `marketing@demo.eazyfoods.test` |
| Content | `content@demo.eazyfoods.test` |

Payments run against a sandbox processor. At checkout pick a test card (`tok_visa` succeeds, `tok_declined` is declined). No money moves.

## Tests and checks

```bash
npm test                 # 140+ integration tests against a real Postgres (apps/api)
npm run lint:content     # fails on em dashes, banned fonts or more than two font families
npm run typecheck -w apps/api && npm run typecheck -w apps/web
```

## Documentation

* [Architecture](docs/ARCHITECTURE.md): data model, order and delivery state machines, pricing, ledger, dispatch.
* [Deployment](docs/DEPLOYMENT.md): environments, domains, workers, scaling, health checks.
* [Backup and restore](docs/BACKUP_RESTORE.md)
* [Security](docs/SECURITY.md)
* [API overview](docs/API.md)
* [Integrations and credentials](docs/INTEGRATIONS.md)
* [Known limitations](docs/LIMITATIONS.md)
