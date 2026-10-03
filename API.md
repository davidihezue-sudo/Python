# API

Base path `/api/finance/{householdId}`. JSON in and out. Success returns `{ "data": ... }`. Errors return `{ "error": { "code", "message", "details" } }` with the usual status codes (400 validation, 401, 403, 404, 409, 429). Money values are strings with two decimals. Authentication is the session cookie; state changing requests must be same origin.

Capabilities: **read** (any member), **write** (Administrator or Member), **admin** (Administrator only). Reads are always filtered by record visibility; a record you cannot see returns 404.

Query parameter `view` is `my`, `household` (or `all` where noted). Dates are `YYYY-MM-DD`.

| Group | Endpoints |
| --- | --- |
| Household | `GET /profile`, `PATCH /profile` (admin), `GET /members`, `PATCH /members/:id`, `PUT /sharing`, `DELETE /demo` (admin) |
| Accounts | `GET,POST /accounts`, `GET,PATCH,DELETE /accounts/:id`, `POST /accounts/:id/balance`, `POST /accounts/:id/reconcile`, `GET /accounts/:id/verify` |
| Categories | `GET,POST /categories`, `PATCH,DELETE /categories/:id`, `GET /merchants` |
| Transactions | `GET,POST /transactions`, `POST /transactions/bulk`, `POST /transfers`, `GET,PATCH,DELETE /transactions/:id`, `POST /transactions/:id/duplicate` |
| Income | `GET,POST /income`, `GET /income/summary`, `PATCH,DELETE /income/:id`, `POST /income/:id/changes`, `POST /income/:id/payments` |
| Bills and recurring | `/bills`, `/subscriptions`, `/insurance`, `/recurring` (list, create, patch, delete), `POST /bills/:id/pay`, `POST /subscriptions/:id/charge`, `POST /recurring/:id/post` |
| Debt | `GET,POST /debts`, `GET /debts/strategies`, `GET,PATCH,DELETE /debts/:id`, `GET /debts/:id/schedule`, `POST /debts/:id/payments` |
| Savings and wealth | `/goals`, `GET /emergency`, `/investments`, `/assets`, `GET /networth` |
| Budgets | `GET,POST /budgets`, `GET /budgets/compare`, `GET,PATCH,DELETE /budgets/:id`, `POST /budgets/:id/duplicate` |
| Planning | `GET /forecast`, `POST /scenarios/run`, `/scenarios`, `POST /planner/mortgage`, `/planner/mortgage/compare`, `/planner/affordability`, `/planner/down-payment`, `/planner/saved` |
| Contributions | `GET /contributions`, `POST /contributions/preview`, `/contributions/rules`, `/settlements`, `GET /comparison` |
| Tax | `/tax/records`, `GET /tax/summary?year=`, `GET,PUT /tax/rules` (PUT admin) |
| Vehicles | `GET /vehicles/options`, `GET /vehicles/overview?view=&from=&to=` (costs from tagged ledger rows plus maintenance status). Transactions accept `vehicleId` and `GET /transactions?vehicleId=` filters by it |
| Money tools | `/rules` (GET, POST, PATCH, DELETE), `POST /rules/preview`, `POST /rules/apply`, `GET /tags`, `GET /tags/summary`, `/saved-views` (private to the member), `GET /safe-to-spend?view=&buffer=`, `GET,PUT /registered-room?year=` (the caller's own room only), `GET /registered-room/rrsp-helper`, `/payday-plans` (owner only) and `POST /payday-plans/:id/run`. `POST /transactions` also returns `nudge` when the entry brings a budget to 80 percent or more. |
| Planning and insight | `GET /retirement/defaults`, `POST /retirement/project`, `POST /resp/plan` (stateless calculators), `GET /sinking-funds`, `GET /subscriptions/watch`, `GET /year-in-review?year=&view=`, `GET /monthly-review?month=&view=`, `POST /monthly-review/email` (to the caller only), `GET,PUT /monthly-review/settings` (opt-in) |
| Vehicle tools | `GET,POST /mileage/trips`, `DELETE /mileage/trips/:id`, `GET /mileage/report?year=`, `POST /vehicles/keep-or-replace` (stateless), `GET /vehicles/:id/replace-defaults`, `POST /fuel/:id/post-to-ledger`. `POST /api/fuel` accepts `ledgerAccountId` to also record the fill-up as a vehicle-tagged ledger expense. |
| Insight | `GET /dashboard`, `GET /analytics`, `GET /calendar`, `/calendar/events`, `GET /alerts`, `POST /alerts/refresh`, `/alert-settings` |
| Reports and data | `GET /reports`, `GET /reports/run?type=&format=pdf|xlsx|csv|json`, `GET /export/:entity`, `GET /export-all`, `/import/preview`, `/import/analyze`, `/import/commit`, `/import/batches`, `POST /import/batches/:id/undo` |
| Documents | `GET,POST /documents` (multipart), `DELETE /documents/:id`; download through `/api/documents/:id/file` |
| Assistant, history, FX | `POST /assistant`, `GET /assistant/examples`, `GET /history/:entity/:id`, `/fx` |

Global (no household id): `GET /api/finance/context`, `POST /api/finance/households`, `POST /api/finance/demo`.

Household membership and invitations use `/api/households`, `/api/households/:id/invites` and `/api/households/:id/members/:userId`. Notifications use `/api/notifications`.

## Transaction body (create)

```json
{ "type": "EXPENSE", "accountId": "...", "amount": "86.40", "date": "2026-10-01",
  "description": "Groceries", "categoryId": "...",
  "payer": "<memberId or HOUSEHOLD>",
  "allocation": { "mode": "SPLIT", "splits": [ { "memberId": "...", "percent": 60 }, { "memberId": null, "percent": 40 } ] },
  "visibility": "HOUSEHOLD" }
```

`memberId: null` in a split means the household. Modes are OWNER, MEMBER (with `memberId`), HOUSEHOLD and SPLIT. Percentages must sum to 100 and fixed amounts must sum to the transaction total, otherwise the API returns 400.
