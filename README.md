# Family Finance Hub

A household finance platform for families and shared households. Every member has their own login and records their own money. The household combines what is shared, automatically, without ever exposing what is private.

Built for Canadian households (CAD, provinces, RRSP, TFSA, FHSA, RESP, CPP, EI, GST/HST, mortgages), but region, currency, tax rules and categories are configuration, not code.

## What it does

| Area | Features |
| --- | --- |
| Multi-user | Own login per member, invitations by email, roles (Administrator, Member, Read only), My Finances, Household Finances and Member Comparison views |
| Privacy | Per-record visibility: Personal, Household or Selected members, enforced on the server. Administrators cannot read other members' personal records |
| Ledger | Accounts (chequing, savings, cash, credit card, line of credit, mortgage, loan, investment, RRSP, TFSA, FHSA, RESP, joint), transactions, transfers, refunds, reimbursements, split and allocated expenses, audit trail |
| Contributions | Arrangements: independent, shared equally, income based, fixed amounts, custom. Who paid, who owes, settlements, no double counting |
| Budgets | Monthly, weekly or annual, personal or household, rollover, forecast, alerts, compare periods |
| Income | Gross and net kept separate, pay frequency, changes over time, payment log |
| Bills and recurring | Bills, subscriptions, insurance, recurring rules with auto posting, calendar |
| Debt | Credit cards, lines of credit, loans, mortgages, amortisation, snowball, avalanche and custom payoff strategies |
| Savings and wealth | Goals, emergency fund, investments, assets, net worth history |
| Planning | Day by day cash flow forecast, what-if scenarios, mortgage and affordability planner (semi-annual compounding, stress test, CMHC bands, GDS and TDS), down payment planner |
| Tax | Records per year and member, estimates from rules stored as data, household overrides |
| Reports | 14 report types in PDF, Excel and CSV |
| Data | CSV import with column mapping, duplicate detection and undo, exports, documents and receipts |
| Assistant | Deterministic finance assistant that reads only what you are allowed to see. No external AI is required |
| Alerts | In-app notifications and email for due bills, budgets, low balances, renewals, unusual spending |

### Vehicles (the AutoVault module, integrated)

Vehicle maintenance, service history, repairs, parts, fuel and reminders live in the same app and the same households. They connect to the finance side like this:

- **Tag any expense with a vehicle** in the transaction form (fuel, insurance, repairs, parking). The ledger remains the single source of money, so a cost is counted once and follows the same Personal, Household and Selected members visibility rules.
- **Running costs page** (Vehicles, Running costs): cost per vehicle by category and month, cost per kilometre or mile from odometer readings, next maintenance item and open repair issues.
- **Money calendar and dashboard** show maintenance due dates and insurance, registration and inspection renewals next to bills and pay days.
- **Net worth and insurance**: link a vehicle asset or an auto policy to the vehicle.
- **Reports and assistant**: a "Vehicle running costs" report, and questions such as "What did our cars cost this year?" or "What maintenance is due?".
- **Access** to a vehicle still uses the vehicle permission levels. You cannot tag a vehicle you cannot see, and a vehicle whose financials are hidden from you shows no costs.

Costs entered in the older vehicle Expense records are not added to the ledger figures, so nothing is double counted. Use the ledger for money.

## Stack

Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS, TanStack Query, Recharts, Prisma 6, PostgreSQL 16, decimal.js for money, zod, Vitest, Playwright. IBM Plex Sans for text, Instrument Serif for display headings only, tabular numerals for every amount.

## Quick start

```bash
cp .env.example .env            # set DATABASE_URL and AUTH_SECRET
npm install
npx prisma migrate deploy       # applies all migrations
npm run db:seed                 # reference data
npm run db:seed:demo            # optional demo household (development only)
npm run dev                     # http://localhost:3000
```

With Docker: `docker compose up --build` starts PostgreSQL, the web app and the worker.

### Demo accounts (development only, created by `npm run db:seed:demo`)

| Account | Password | Role |
| --- | --- | --- |
| david@familyfinance.local | DemoPass123! | Administrator of the "Demo household" |
| sharon@familyfinance.local | DemoPass123! | Member with their own login and private records |
| admin@familyfinance.local | DemoPass123! | Platform administrator |

Demo data is labelled "Demo" throughout the interface and is removed with Household, Data, Remove demo data. You can also load a demo household from the onboarding wizard on any account.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run typecheck` | TypeScript |
| `npm run lint` | ESLint |
| `npm run test:unit` | Pure calculation and utility tests (no database) |
| `npm run test:integration` | Permissions, privacy, allocations, demo data against PostgreSQL |
| `npm run test:e2e` | Browser tests |
| `npm run build` / `npm start` | Production build and server |
| `npm run worker` | Background jobs (alerts, recurring posting, cleanup, email) |
| `npm run backup` | PostgreSQL dump to `./backups` (see DEPLOYMENT.md) |

## Environment

See `.env.example`. Required: `DATABASE_URL`, `AUTH_SECRET`. Everything else is optional.

External services that need credentials (none are required for core features):

- SMTP (`SMTP_*`) for invitation, verification and alert email. Without it, mail is stored in the `EmailOutbox` table and visible at `/dev/outbox` in development.
- Google sign-in (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`).
- S3 compatible storage (`S3_*`) for documents. Local disk is the default.
- Web push (`VAPID_*`).
- Anthropic API key, only for the older vehicle assistant. The finance assistant is deterministic and needs no key.
- Live exchange rates, bank feeds and market prices are not integrated. Exchange rates are entered by hand; accounts are updated by entry or CSV import.

## Documentation

[ARCHITECTURE.md](ARCHITECTURE.md), [DATABASE.md](DATABASE.md), [API.md](API.md), [SECURITY.md](SECURITY.md), [DEPLOYMENT.md](DEPLOYMENT.md), [USER_GUIDE.md](USER_GUIDE.md).

## Known limitations

- No bank connections. Data comes from manual entry and CSV import.
- Tax estimates are planning aids built from seeded 2025 federal, Alberta, Ontario and British Columbia estimates plus whatever an administrator loads. They are not tax advice.
- Multi-currency uses manually entered rates. Net worth converts to the household currency at the latest rate on or before each date.
- Investment returns are as entered; there are no market data feeds.
- Scenarios and forecasts are projections from recorded data and stated assumptions, not predictions.
