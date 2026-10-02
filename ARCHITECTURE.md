# Architecture

## Layers

```
src/app/                 Next.js routes. (app)/ pages, api/ route handlers
src/components/finance/  Finance UI kit, provider, forms, assistant
src/server/finance/
  engine/                Pure calculation code (no database, no I/O). Unit tested
  access.ts              Visibility and permission rules, the only place that decides who sees what
  *.ts                   Services: validate, authorise, read and write through Prisma
  router.ts              Typed route table behind /api/finance/[householdId]/...
src/server/jobs/         Scheduled jobs (alerts, recurring posting, cleanup, email)
prisma/                  Schema, migrations, seeds
```

Everything under `engine/` is a function of its inputs. The services load rows, call the engine and format results. This is why the calculations can be tested exhaustively without a database.

## Request flow

`/api/finance/[...path]` resolves the session, loads the household and the member, builds a `FinCtx` (actor, member, role, visible account set) and dispatches through the route table. Each route declares its method, path, zod schemas, required capability (`write` or `admin`), rate limit and handler. Same-origin and rate limit checks are applied by the shared `route()` wrapper.

## Money

All amounts are `Decimal(19,4)` in PostgreSQL and `decimal.js` values in code (precision 40, round half up). Floats are never used for money. The API serialises money as strings with two decimals. Negative zero is removed.

## Ledger rules

- Amounts are signed from the account's perspective. Liability accounts carry negative balances.
- Balance = opening balance + posted, non-deleted rows.
- A transfer is two rows sharing a `transferGroupId` and is neutral for income and expense. Credit card payments are transfers; the spending was counted when it happened.
- Refunds and reimbursements reduce the expense category they point at. Settlements and adjustments are neutral. Planned rows are expected only.
- Database checks enforce the sign of each type, transfer pairing, joint account rules, and a deferred constraint trigger requires split allocations to sum exactly to the transaction amount.

## Ownership and allocation

Every record carries separate fields: owner, payer (empty means paid from a joint account), entered by, last modified by. Allocation says whose expense it is: the owner, a member, the household, or a split by percent or fixed amounts. An expense exists once; allocations only divide it. Reports count it once.

## Contribution analysis

Shares are computed on the whole shared pool for display and on the member-paid pool for positions. Positions net to zero. Settlements shift positions but are never expenses. Arrangements: independent, shared equally, income based (net income, never gross), fixed, custom.

## Forecast and scenarios

The forecast is a daily simulation from a baseline built only from records the actor can see: balances, scheduled income, bills, subscriptions, debt payments, goals and the trailing average of unscheduled spending. Growth assumptions default to zero and every run lists its assumptions. A scenario is applied to a cloned baseline and never writes real records.

## Client

TanStack Query keys are `["fin", householdId, path, params]`. Every mutation invalidates `["fin", householdId]`, so dashboards, balances and reports refresh together. Amounts show a sign and an arrow, never colour alone. Tables become stacked cards on phones.
