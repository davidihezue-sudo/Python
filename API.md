# API

REST over JSON, same-origin, cookie-session authenticated. Base path `/api`. Every success response is `{ "data": … }`; every error is:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Some fields are invalid", "details": { "fieldErrors": { "email": ["Enter a valid email"] } }, "requestId": "…" } }
```

| Code | HTTP | Meaning |
|---|---|---|
| `VALIDATION_ERROR` / `BAD_REQUEST` | 400 | Invalid input (`details.fieldErrors`) |
| `UNAUTHENTICATED` | 401 | No/invalid session (login failures use this too) |
| `PLAN_LIMIT` | 402 | Plan limit/feature (only when `BILLING_MODE=enforced`) |
| `FORBIDDEN` | 403 | Authenticated but lacking the capability / cross-origin write blocked |
| `NOT_FOUND` | 404 | Missing **or not accessible** (existence is not leaked) |
| `CONFLICT`, `DUPLICATE_RECORD`, `ODOMETER_REGRESSION` | 409 | State conflicts; `details` carries the conflicting item / `requiresConfirmation` |
| `PAYLOAD_TOO_LARGE` / `UNSUPPORTED_MEDIA_TYPE` | 413 / 415 | Upload limits |
| `RATE_LIMITED` | 429 | `Retry-After` header set |
| `INTERNAL` | 500 | Generic; correlate via `requestId` |

**Conventions** — odometer values are **kilometres** on the wire; money is a JSON number in the record's currency; dates are `YYYY-MM-DD`; list endpoints accept `page`, `pageSize`, `sort`, filters and return `{ items, page, pageSize, total }`. State-changing requests must be same-origin (Origin / Sec-Fetch-Site checked). Machine endpoints use `Authorization: Bearer`.

Example:

```http
POST /api/maintenance/records
{ "vehicleId":"…","title":"Oil change","serviceDate":"2026-01-15","odometerKm":160500,
  "workPerformedBy":"INDEPENDENT_MECHANIC","providerName":"Calgary Lube","partsCost":65.5,"laborCost":40,"tax":5.28,
  "items":[{"assignmentId":"…","name":"Engine oil","completed":true,"quantity":1,"unitCost":0,"laborCost":0,"trackAsPart":false}],
  "idempotencyKey":"7b0c…" }
→ 201 { "data": { "id":"…", "idempotentReplay": false } }
```

## Endpoints

Legend: 🔒 session required · 🛡️ vehicle capability checked server-side (view/write/editVehicle/manageAccess/viewFinancials/delete).

### Auth & account
| Method & path | Notes |
|---|---|
| `POST /auth/register` | `{name,email,password,acceptTerms,timezone?}` → 202 (identical response whether or not the email exists) |
| `POST /auth/verify-email` · `/auth/resend-verification` | token / email |
| `POST /auth/login` · `/auth/logout` | sets/clears `av_session` |
| `POST /auth/forgot-password` · `/auth/reset-password` · 🔒 `/auth/change-password` | |
| `GET /auth/providers` · `GET /auth/google` · `GET /auth/google/callback` | Google enabled flag / OAuth flow |
| 🔒 `GET,PATCH,DELETE /users/me` | profile; DELETE requires password (or email for OAuth accounts) |
| 🔒 `PATCH /users/me/preferences` | units, currency, timezone, theme, notification + threshold settings |
| 🔒 `POST /users/me/photo` · `GET /users/me/export` | multipart image; JSON data export |

### Households
`GET,POST /households` · `PATCH /households/:id` · `POST /households/:id/invites` · `PATCH,DELETE /households/:id/members/:userId` · `GET,DELETE /invites/:token-or-id` (public preview by token / admin revoke) · `POST /invites/:token/accept` · `GET /billing/entitlements?householdId=`

### Vehicles 🛡️
`GET,POST /vehicles` · `GET /vehicles/templates` · `POST /vehicles/decode-vin` · `GET,PATCH,DELETE /vehicles/:id` · `GET /vehicles/:id/timeline` · `POST /vehicles/:id/ownership` · `POST /vehicles/:id/access` · `DELETE /vehicles/:id/access/:userId` · `POST /vehicles/:id/decode-vin` (suggestions + diff) · `POST /vehicles/:id/apply-decoded` (only user-selected fields) · `GET,POST /vehicles/:id/odometer` · `PATCH,DELETE /vehicles/:id/odometer/:entryId` · `POST /vehicles/:id/odometer/import` · `GET,POST /vehicles/:id/schedules` · `POST /vehicles/:id/schedules/apply-library` · `GET,POST /vehicles/:id/integrations`

Odometer `POST` body: `{date,valueKm,source?,note?,confirmCorrection?}`. A reading lower than an earlier one → `409 ODOMETER_REGRESSION` with `details.conflict`; resend with `confirmCorrection:true` (audited).

### Maintenance 🛡️
`GET /maintenance/categories` · `GET,POST /maintenance/schedules` · `GET /maintenance/schedules/library` · `POST /maintenance/schedules/templates` · `GET,PATCH,DELETE /maintenance/schedules/:id` (GET includes change history) · `GET,POST /maintenance/records` (filters: `vehicleId, kind, status, q, category, from, to, minKm, maxKm, minCost, maxCost, providerId, workPerformedBy, sort`) · `GET /maintenance/records/prefill?assignmentId=` · `GET,PATCH,DELETE /maintenance/records/:id`

### Repairs, diagnostics, parts, warranties, inspections, providers 🛡️
`GET,POST /repairs` · `GET,PATCH,DELETE /repairs/:id` · `POST /repairs/:id/convert` · `GET,POST /diagnostics` · `PATCH,DELETE /diagnostics/:id` · `GET /diagnostics/lookup?code=` · `GET /diagnostics/providers` · `GET,POST /parts` · `GET,PATCH,DELETE /parts/:id` · `POST /parts/replace` · `GET /parts/components?vehicleId=&component=` · `GET,POST /warranties` · `PATCH,DELETE /warranties/:id` · `GET,POST /inspections` · `DELETE /inspections/:id` · `GET,POST /providers` · `PATCH,DELETE /providers/:id`

### Money 🛡️ (`viewFinancials` required)
`GET,POST /expenses` · `GET,PATCH,DELETE /expenses/:id` (service/fuel-generated expenses are read-only here) · `GET,POST /expenses/budgets` · `PATCH,DELETE /expenses/budgets/:id` · `GET,POST /fuel` · `PATCH,DELETE /fuel/:id` · `GET /fuel/stats?vehicleId=`

### Reminders & notifications 🔒
`GET,POST /reminders` · `PATCH,DELETE /reminders/:id` · `GET /reminders/upcoming` · `GET,PATCH /notifications` (`PATCH {ids|all, action: read|dismiss|actioned}`) · `DELETE /notifications/:id` · `GET /notifications/push-config` · `POST,DELETE /notifications/push-subscription`

### Documents 🛡️
`GET,POST /documents` (multipart: `file` + `vehicleId, category, title?, expiresOn?, maintenanceRecordId?, repairIssueId?, expenseId?, partId?, runOcr?`) · `GET,PATCH,DELETE /documents/:id` · `GET /documents/:id/file[?download=1]` · `POST /documents/:id/ocr` · `POST /documents/:id/ocr/confirm` (creates an expense from **user-verified** values)

### Analytics, reports, search, AI 🔒
`GET /analytics/dashboard` · `GET /analytics/expenses` · `GET /analytics/components` (query `vehicleId, range=30d|90d|ytd|12m|all|custom, from, to, exclude=FUEL,INSURANCE`) · `GET /reports` · `GET /reports/:type?format=pdf|csv|xlsx|json&vehicleId&year&from&to&hideVin&hideCosts&hideProviders` (types: `service-history, annual-summary, repair-history, expense-statement, costs-by-category, cost-per-distance, parts-history, upcoming-forecast, warranty, fuel-consumption, household-expenses`) · `GET /search?q=` · `POST /ai/chat` · `GET /ai/conversations[/:id]` · `GET /ai/status`

### Integrations, admin, ops
`GET /integrations/status` · `POST /integrations/obd/ingest` (bearer ingest token) · `DELETE /integrations/:id` · 🔒(platform admin) `GET /admin/stats, /admin/users, /admin/flags` · `PATCH /admin/users/:id, /admin/flags` · `GET /health[?deep=1]` · `POST /cron/run[?job=]` (bearer `CRON_SECRET`)

Rate limits: default 240 req/min per user; login 10/15 min per IP+email; register 8/10 min per IP; forgot/resend 3–5/hour; uploads 30/10 min; report export 30/10 min; AI 30/10 min.
