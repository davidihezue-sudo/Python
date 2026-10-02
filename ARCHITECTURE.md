# Architecture

## Overview

A single Next.js 15 application (App Router) contains the UI, REST API and — via a separate process using the same code — the background worker. PostgreSQL is the only required stateful dependency; files go to local disk or any S3-compatible bucket.

```
Browser (PWA, React, TanStack Query)
   │  fetch JSON            ▲ service worker: offline cache + IndexedDB outbox
   ▼
Next.js route handlers  ──►  route() wrapper: session → CSRF origin check → rate limit → zod → handler → error mapping
   │
   ▼
Services (src/server/services)  ── authorise (access.ts) → transaction → derived data → audit log
   │            │
   │            └── Engines (src/server/engine): pure functions, no I/O, exhaustively unit-tested
   ▼
Prisma ─► PostgreSQL            Storage driver ─► local disk | S3        Integrations: VIN · OCR · diagnostics · email · push · AI
Worker (npm run worker) ─► jobs: notifications.generate · schedules.refresh · email.flush · cleanup
```

### Layering rules

1. **Route handlers are thin.** They validate input with the shared zod schemas (`src/lib/validation.ts`, also used by the forms) and call one service function.
2. **Services own authorisation.** Every vehicle-scoped operation resolves the vehicle through `requireVehicle()` / `accessibleVehicles()` (`services/access.ts`), which checks household membership and the per-vehicle grant. Unauthorised access is reported as **404** (not 403) so identifiers can't be probed. Financial fields are redacted per vehicle (`viewFinancials`).
3. **Engines are pure.** `engine/mileage.ts`, `schedule.ts`, `costs.ts`, `fuel.ts`, `alerts.ts`, `insights.ts`, `status.ts` take plain data and return plain data. They are where the product's intelligence lives and where accuracy is tested (spec examples are literal test cases).
4. **Derived data is a function of records.** Completing/editing/deleting a service re-derives odometer entries, the linked expense, installed-part chains and schedule state inside one transaction (`records.ts`: `rollbackDerived` → write → `applyDerived`).

### Units & time

Odometer values are stored in **kilometres** (Decimal(10,1)), litres for volume. The UI converts using the user's preference (`lib/units.ts`, `lib/client/format.ts`) — units are never mixed silently. Calendar dates are `date` columns handled as ISO strings (no timezone drift); "today" is computed in the user's timezone.

## Component architecture (UI)

* `components/ui` — design system: primitives, accessible modal (native `<dialog>`), tabs, dropdown menu, toasts, charts (each chart ships a screen-reader data table).
* `components/forms` — react-hook-form + zod helpers, `DistanceInput` (display unit ⇄ km), `MoneyInput`, server-error mapping.
* `components/features/*` — feature panels (schedules, records, issues, parts, expenses/fuel/budgets, documents, vehicle sub-panels). The same panel is used on its module page (all vehicles or the selected one) and on the vehicle profile tab.
* `components/shell` — providers (query client, current user, formatters, selected vehicle, offline sync) and the application shell (sidebar, bottom navigation, quick add, search palette, notifications bell).

## Maintenance engine

`MaintenanceSchedule` is a *template* (system library or household-defined). Applying it to a vehicle copies the rule into a `MaintenanceScheduleAssignment`, so later edits never drift from history. Each assignment stores derived `lastCompleted*`, `nextDue*` and a `status` snapshot; the API always evaluates **live** (`evaluateRule`) with the caller's thresholds so statuses are never stale. Recalculation (`refreshVehicleSchedules`) runs on: odometer change, record create/update/delete, inspection change, schedule edit and a periodic job.

Status per dimension: remaining ≤ −grace → Overdue; ≤ 0 → Due now; ≤ due-soon → Due soon; ≤ upcoming → Upcoming; else Up to date. OR rules take the worst dimension, AND rules become due only when both elapse. Estimates state their basis (your schedule / manufacturer / driving history / generic suggestion).

## Authentication & sessions

Email/password (bcrypt, cost 12), optional Google OAuth (authorization-code + PKCE + signed state). Sessions are random 256-bit tokens; only the SHA-256 hash is stored (`Session.tokenHash`), delivered in an `HttpOnly; SameSite=Lax; Secure` cookie, sliding 30-day expiry. Email verification and password reset use single-use hashed tokens. Registration, login, forgot-password and resend are enumeration-safe and rate-limited. Roles: platform (`USER`/`PLATFORM_ADMIN`), household (`ADMIN`/`MEMBER`), vehicle (`OWNER`/`CO_OWNER`/`MAINTENANCE_MANAGER`/`VIEWER` + `canViewFinancials`). Permission logic is a pure function (`lib/permissions.ts`).

## Background jobs

`server/jobs/jobs.ts` defines four idempotent jobs recorded in `JobRun`. Run them with `npm run worker` (recommended), in-process (`ENABLE_INPROCESS_JOBS=true`, single instance) or from an external scheduler via `POST /api/cron/run` with `Authorization: Bearer $CRON_SECRET`. Notification generation iterates every vehicle and recipient, computes candidate alerts with deterministic `dedupeKey`s (`maint:<assignment>:<dueKm>|<dueDate>:<stage>`), and inserts with `ON CONFLICT DO NOTHING` on `(userId, dedupeKey)` — so it cannot duplicate, and a completed service (new due point) re-arms alerts. It does not depend on anyone opening the app. Delivery (email via outbox/SMTP, web push) is a separate step.

## File storage

`lib/storage` exposes `put/get/delete` with a local-disk driver and an S3 driver (any S3-compatible endpoint). Keys are server-generated (`h/<household>/<uuid>`) — never derived from user input. Uploads are sniffed by magic bytes (PDF/JPEG/PNG/WEBP only), extension-checked, size-limited, hashed, and served only through `/api/documents/:id/file` after an authorisation check, with `nosniff` and a locked CSP.

## Integration architecture

| Integration | Module | Without credentials |
|---|---|---|
| VIN decoding | `integrations/vin.ts` (NHTSA vPIC) | Manual entry; decode returns *suggestions*; user-confirmed fields are never overwritten |
| OCR | `integrations/ocr.ts` provider interface (`text` PDFs, `anthropic` vision) | Text-layer PDFs parsed locally; always produces *candidates* shown for verification — never creates records |
| AI assistant | `services/ai.ts` (read-only tools) | Deterministic rule-based assistant using the same tools |
| Diagnostics | `integrations/diagnostics.ts` provider registry + OBD ingest endpoint | Manual DTC entry; BMW ConnectedDrive/CarData registered as *not available* (no unofficial APIs, no credentials requested) |
| Email / push | `lib/email.ts`, `services/notifications.ts` | Outbox + log; in-app always works |
| Billing | `services/entitlements.ts` | `BILLING_MODE=disabled` unlocks everything; payment processing intentionally not implemented |

## PWA & offline

`public/sw.js`: cache-first for static assets, network-first with cache fallback for API GETs (previously loaded data stays readable), navigation fallback to the last cached page then `/offline`. Writes made offline go to an IndexedDB outbox (`lib/client/offline.ts`) with client idempotency keys and are replayed on `online`, at start-up, or via Background Sync where `SyncManager` exists. Capability detection is surfaced in Settings → App & offline; caches are cleared on logout/login.
