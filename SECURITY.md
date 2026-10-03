# Security and privacy

## Privacy model

Each record (account, transaction, income source, bill, goal, asset, tax record, and so on) has a visibility:

- **Personal**: only its owner. Household administrators have no automatic access.
- **Household**: every member, and included in household totals.
- **Selected members**: the owner plus the members listed.

Rules, all enforced on the server in `src/server/finance/access.ts`:

1. Joint accounts have no owner and are always Household.
2. A transaction can never be more visible than its account.
3. Documents inherit the visibility of the record they are attached to.
4. Roles (Administrator, Member, Read only) govern writing and household settings, not reading.
5. List endpoints filter in the database query (`visWhere`); single-record endpoints check `canSee` and return not found, not forbidden, so existence is not revealed.
6. The Household view contains only shared records. Aggregates, dashboards, reports, exports, the forecast, scenarios and the assistant all read through the same visibility filter, so a total never includes a figure the viewer could not open.
7. Scenarios and saved plans are private to their creator.
8. Changes are written to an audit trail with who and when. History is filtered by the same rules.

## Accounts and sessions

Passwords hashed with bcrypt, common passwords rejected, sessions are random tokens stored hashed in an HttpOnly, SameSite cookie, login and sensitive endpoints are rate limited, unverified emails cannot sign in when verification is required. Invitation tokens are single use, expire, and are stored hashed.

## Request safety

Same-origin enforcement on state-changing requests, zod validation on every body and query, body size limits, parameterised queries through Prisma only, output escaping by React, uploads limited by type and size and served through an authorised route, security headers in `next.config.mjs`.

## Data

Export your own data as JSON at any time. Demo data is flagged and removable. Back up PostgreSQL and the storage directory (see DEPLOYMENT.md).

## Reporting issues

Do not open a public issue for a vulnerability. Contact the maintainer privately.


## Limited roles, expiry and API tokens

- **Child:** record visibility excludes household-shared records for a child: only their own records and records shared with them by name are returned, enforced in the shared visibility helpers (`canSee`, `visWhere`). A child cannot assign records to adults and cannot make records personal. Only a short list of API areas is reachable.
- **Accountant:** never able to write. Only tax-related areas are reachable, and only GET (plus posting comments).
- **Expiry:** `accessExpiresAt` is checked when the finance context is built and in the vehicle and household access helpers. Expired members also disappear from the household list.
- **API tokens:** hashed at rest, read-only, one household, GET only, revocable, expiring. They never reach the token management endpoints.
- Both limited roles are covered by isolation tests in `tests/integration/finance/phase4.test.ts`.
