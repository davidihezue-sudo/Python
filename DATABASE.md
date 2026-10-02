# Database

PostgreSQL 16, Prisma 6 (`prisma/schema.prisma`, migrations in `prisma/migrations`). Apply with `npx prisma migrate deploy`.

## Conventions

* **IDs** `cuid` strings. **Timestamps** `timestamptz` (`createdAt`, `updatedAt`); **calendar dates** `date`.
* **Money** `Decimal(12,2)` with an explicit `currency` column; arithmetic in application code uses integer cents (`lib/money.ts`) — no floating-point drift.
* **Odometer** `Decimal(10,1)` **kilometres**; volume stored as litres (`quantityL`) with the entered value/unit retained.
* **Soft deletion** (`deletedAt`) on user-authored records (vehicles, records, expenses, issues, parts, documents, schedules…) so history, audit and exports stay coherent; hard deletion only on account deletion/purge.
* **Cascade**: deleting a household or vehicle cascades to owned data; shared reference data (`MaintenanceCategory`, system `MaintenanceSchedule`) is never cascaded.

## Entity overview

```
User ─┬─ Account (OAuth)          Household ─┬─ HouseholdMember (role ADMIN/MEMBER) ─ User
      ├─ Session                             ├─ HouseholdInvite
      ├─ VerificationToken                   ├─ Vehicle ─┬─ VehicleSpecification (decoded data, confirmedFields)
      ├─ UserPreference                      │           ├─ VehicleOwnership (timeline)
      ├─ PushSubscription                    │           ├─ VehicleAccess (level + canViewFinancials) ─ User
      ├─ Notification                        │           ├─ OdometerEntry
      └─ AIConversation ─ AIMessage          │           ├─ MaintenanceScheduleAssignment ─ MaintenanceSchedule (template) ─ MaintenanceCategory
                                             │           ├─ MaintenanceRecord ─ MaintenanceRecordItem (→ assignment)
                                             │           ├─ RepairIssue ─ DiagnosticCode
                                             │           ├─ Part ─ InstalledPart (installation periods)
                                             │           ├─ Expense · FuelEntry · Reminder · Inspection · Warranty
                                             │           ├─ Document (links to record/issue/expense/part/inspection/warranty)
                                             │           └─ Integration ─ IntegrationCredentialReference (references only, never secrets)
                                             ├─ ServiceProvider · Budget · Subscription
Platform: AuditLog · FeatureFlag · EmailOutbox · JobRun · RateLimitBucket
```

All 32 requested models exist (`Account`, `Session`, `HouseholdMember`, `VehicleSpecification`, `VehicleOwnership`, `MaintenanceScheduleAssignment`, `MaintenanceRecordItem`, `InstalledPart`, `Warranty`, `Inspection`, `Budget`, `Integration`, `IntegrationCredentialReference`, `AIConversation`, `AIMessage`, …).

## Important constraints

| Constraint | Purpose |
|---|---|
| `User.email` unique | one account per address |
| `HouseholdMember(householdId,userId)` unique; `VehicleAccess(vehicleId,userId)` unique | one membership/grant each |
| `MaintenanceScheduleAssignment(vehicleId,scheduleId)` unique | a library rule is applied to a vehicle once |
| `Notification(userId,dedupeKey)` unique | **no duplicate notifications** |
| `MaintenanceRecord.idempotencyKey`, `Expense.idempotencyKey`, `FuelEntry.idempotencyKey` unique | safe offline replay |
| `Expense.fuelEntryId` unique; one expense per record (enforced in service) | no double counting |
| `ServiceProvider(householdId,name)` unique | provider de-duplication |
| `Session.tokenHash`, `VerificationToken.tokenHash`, `HouseholdInvite.tokenHash` unique | only hashes are stored |
| `Document.fileKey` unique | storage key integrity |

Application-level integrity (inside transactions): odometer monotonicity, duplicate-service detection (same vehicle+date+title+odometer), cross-vehicle reference checks (an item may only reference its own vehicle's schedule), at-least-one-owner/admin rules.

## Indexing strategy

Composite indexes follow the access paths: `OdometerEntry(vehicleId,date)` and `(vehicleId,valueKm)`; `MaintenanceRecord(vehicleId,serviceDate)` / `(vehicleId,kind,status)`; `Expense(vehicleId,date)` / `(vehicleId,category)`; `Notification(userId,readAt,dismissedAt)`; `FuelEntry(vehicleId,date)`; `Document(householdId,category)`; `AuditLog(entity,entityId)` / `(vehicleId,createdAt)`; `Vehicle(householdId,deletedAt)` and `(vin)`; `MaintenanceScheduleAssignment(vehicleId,enabled)` / `(status)`.

## Migrations

* `prisma migrate dev --name <change>` while developing; commit the generated SQL.
* `prisma migrate deploy` in CI/production (the Docker entrypoint does this on start).
* `npm run db:seed` upserts reference data (categories, 68 suggested rules, feature flags) and is safe to run repeatedly — run it after every deploy.
* `npm run db:seed:demo` creates **development-only** demo data (flagged `isDemo`); it refuses to run with `NODE_ENV=production`.

## Backup & restore

See [DEPLOYMENT.md](DEPLOYMENT.md#backup-and-restore).
