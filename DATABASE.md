# Database

PostgreSQL 16 through Prisma. Migrations are committed SQL in `prisma/migrations` (`init`, then `finance_hub`, which also contains the integrity SQL below). Apply with `npx prisma migrate deploy`.

## Finance tables

| Table | Purpose |
| --- | --- |
| Household, HouseholdMember, HouseholdInvite | Household, members (roles ADMIN, MEMBER, READ_ONLY), email invitations (hashed single use tokens, 7 day expiry) |
| MemberPrivacy | Each member's own default sharing per record type |
| FinAccount | Accounts. `ownerMemberId` is null for joint accounts, which are always HOUSEHOLD visibility |
| FinCategory, FinMerchant | Two level category tree per household, merchant memory for default categories |
| FinTransaction | One row per ledger entry: signed amount, type, owner, payer, creator, last editor, allocation mode, visibility, selected members, transfer group, import batch |
| TransactionAllocation | Split rows for SPLIT allocation (member or household, amount) |
| ContributionRule, Settlement | Contribution arrangement per household and period, member to member settlements |
| IncomeSource, IncomeChange | Gross and net amounts kept in separate columns, frequency, history of changes |
| RecurringRule, Bill, BillPayment, RecurringSubscription, InsurancePolicy | Scheduled and recurring items |
| Debt, DebtPayment | Debts linked to a liability account, payments split into principal and interest |
| SavingsGoal, GoalContribution | Goals and contributions |
| InvestmentProfile, InvestmentEntry, InvestmentValuation, Asset, AssetValuation | Investments and assets with dated valuations |
| TaxRecord, TaxRuleSet | Tax records and rule sets stored as JSON data per country, region and year |
| FinBudget, FinBudgetLine | Budgets and lines |
| FinScenario, CalendarEvent, ImportBatch, FxRate, FinAlertSetting | Saved scenarios and plans, custom events, import tracking, manual exchange rates, per member alert preferences |
| AuditLog | Who changed what and when, with before and after |
| Document | Files; `finEntity` and `finEntityId` link a file to a finance record and it inherits that record's visibility |

All money columns are `Decimal(19,4)`. Dates for ledger entries are `DATE` (no time zone drift).

## Integrity enforced by the database

Raw SQL in the `finance_hub` migration:

- Sign rules: income and refunds positive, expenses negative, per type, and no zero amounts except adjustments.
- Transfers need a transfer group id, and only transfers have one.
- A joint account cannot have an owner and must be HOUSEHOLD visibility.
- Allocation rows must be positive.
- A deferred constraint trigger requires that the allocation rows of a SPLIT transaction sum exactly to the transaction amount at commit.

## Seeds

- `npm run db:seed`: reference data (categories and library schedules for the vehicle module).
- `npm run db:seed:demo`: development demo household with two real logins. Refuses to run when `NODE_ENV=production`.
- Per household, default categories are created when the household is created. Seeded tax rule estimates (federal, AB, ON, BC, 2025) are available as defaults and can be overridden per household.
