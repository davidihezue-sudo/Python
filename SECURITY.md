# Security

## Architecture

* **Authorisation is server-side and centralised.** Every vehicle-scoped service call goes through `requireVehicle()`/`accessibleVehicles()`; the frontend merely hides controls. Missing access returns `404` (no existence leak); insufficient permission returns `403`. An automated **IDOR battery** (`tests/integration/households.test.ts`) exercises ~50 read/write/cross-link operations as an unrelated user and the e2e suite repeats the key ones over HTTP.
* **Financial privacy.** `viewFinancials` is a separate capability: costs are redacted from records, issues, parts, fuel, vehicle stats, dashboards, analytics, reports, search results, documents (invoices/receipts) and the data export for members without it.
* **Platform administrators** get aggregate counts, user management (enable/disable) and feature flags only; they have no implicit access to vehicles, costs or documents (tested).

## Authentication

bcrypt (cost 12), password policy (≥10 chars, common-password check, letters + number/symbol), constant-time-ish handling of unknown accounts (dummy hash), enumeration-safe responses for register/forgot/resend, single-use hashed tokens (verify 24 h, reset 1 h), reset revokes all sessions, password change revokes other sessions. Sessions: 256-bit random token, SHA-256 hash stored, `HttpOnly; SameSite=Lax; Secure` (production), sliding 30-day expiry, destroyed on logout/disable. Google OAuth uses authorization-code + PKCE + HMAC-signed state with a matching cookie; only verified Google emails are linked.

## Request protection

* **CSRF**: SameSite=Lax cookies **plus** Origin/Sec-Fetch-Site validation on every state-changing request (`lib/http.ts`). Machine endpoints (`/api/cron/run`, `/api/integrations/obd/ingest`) accept only bearer tokens (constant-time compare; OBD tokens stored hashed).
* **Rate limiting**: per-user/IP on every route (default 240/min), strict limits on login (10 / 15 min per IP+email), register, forgot/resend, upload, report export, AI. Memory store by default; `RATE_LIMIT_STORE=postgres` shares counters across instances.
* **Input validation**: zod on every body/query (shared with the forms); bodies capped at 1 MB; unknown fields stripped.
* **SQL injection**: Prisma parameterised queries; the only raw SQL (rate limiter) uses tagged templates.
* **XSS**: React escaping; no `dangerouslySetInnerHTML`; assistant output rendered by a minimal safe renderer; strict **CSP with per-request nonce** (`script-src 'self' 'nonce-…' 'strict-dynamic'`), `frame-ancestors 'none'`, `object-src 'none'`, HSTS, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`.
* **Errors**: centralised mapping; 500s return a generic message + request id (no stack/SQL); details are logged with secrets redacted (`pino` redaction of passwords/tokens/cookies).

## File upload security

Magic-byte sniffing (client MIME type and extension are ignored; extension must match content), allow-list PDF/JPEG/PNG/WEBP (no SVG/HTML), size limit (`MAX_UPLOAD_MB`, default 10), random storage keys, SHA-256 recorded, downloads only via an authorised route (`private` cache, `nosniff`, CSP `sandbox` for images), financial categories gated by `viewFinancials`, soft-delete then purge job. Spreadsheet exports neutralise formula injection (`= + - @` prefixed with `'`).

## Secrets

Only environment variables; `.env` is git-ignored; `.env.example` has placeholders. Production refuses to boot with the template `AUTH_SECRET`. Integration credentials are **never stored in the database** — `IntegrationCredentialReference` holds only a name/reference. API keys never reach the browser. No BMW (or other OEM) credentials are ever requested.

## Audit logging

`AuditLog` records who/what/when with before/after for: schedule changes, odometer corrections, records, expenses, issues (incl. status transitions), parts, access grants/revocations, invites, household changes, preference changes, report exports, account events, admin actions. Passwords/tokens are stripped from payloads.

## Privacy (Canada)

Data minimisation (no tracking, no third-party scripts, system fonts), explicit consent text at registration, one-click **JSON data export** (`/api/users/me/export`), **account deletion** (cascade-deletes sole-member households and stored files; shared households are handed to another admin), sharing defaults that strip VIN/plate/costs/provider names from exported reports at source, retention clean-up job (expired sessions/tokens, dismissed notifications, purged documents). Not legal advice — review against PIPEDA / provincial rules (e.g. Alberta PIPA) and your own policies before launch.

## Known limitations / hardening to consider

* In-memory rate limiting is per instance (use the Postgres store behind multiple instances; add an edge WAF for volumetric abuse).
* `X-Forwarded-For` is trusted for IPs; deploy behind a proxy that overwrites it.
* No MFA yet (architecture permits adding TOTP/WebAuthn at `auth.ts`).
* Local-disk storage is unencrypted at rest; use S3 SSE/KMS or disk encryption in production.
* Dependency audit: run `npm audit` in CI and keep Next/Prisma patched.
