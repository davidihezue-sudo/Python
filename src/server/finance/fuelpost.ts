// A fuel fill-up can also be recorded in the ledger, tagged with the vehicle. The ledger row is that cost's one source of truth in finance;
// the vehicle module keeps its own fuel and expense records for economy statistics. They are never added together.
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import type { Actor } from "../context";
import { D } from "./engine/decimal";
import { finCtx, requireAccount } from "./access";
import { requireVehicle } from "../services/access";
import { createTransaction, deleteTransaction, txCreateSchema, txPatchSchema, updateTransaction } from "./transactions";

const describe = (station: string | null) => (station ? `Fuel at ${station}` : "Fuel");

/** Checked before the fill-up is saved, so a bad account never leaves a half-recorded entry. */
export async function checkLedgerAccount(actor: Actor, householdId: string, accountId: string, currency: string) {
  const ctx = await finCtx(actor, householdId, "write");
  const acct = await requireAccount(ctx, accountId, { write: true });
  if (acct.currency !== currency) throw new AppError("VALIDATION_ERROR", `That account is in ${acct.currency} but this fill-up is in ${currency}`, { fieldErrors: { ledgerAccountId: ["Choose an account in the same currency"] } });
}

export async function postFuelToLedger(actor: Actor, fuelId: string, accountId: string) {
  const f = await db.fuelEntry.findFirst({ where: { id: fuelId, deletedAt: null }, include: { vehicle: true } });
  if (!f) throw new AppError("NOT_FOUND", "Fuel entry not found");
  await requireVehicle(actor, f.vehicleId, "write");
  if (f.ledgerTransactionId) throw new AppError("CONFLICT", "This fill-up is already recorded in your finances");
  if (D(f.totalCost).lte(0)) throw new AppError("VALIDATION_ERROR", "A fill-up with no cost cannot be recorded as an expense");
  const ctx = await finCtx(actor, f.vehicle.householdId, "write");
  const cat = await db.finCategory.findFirst({ where: { householdId: ctx.householdId, kind: "EXPENSE", name: "Fuel", archived: false }, select: { id: true } });
  const tx = await createTransaction(ctx, txCreateSchema.parse({ type: "EXPENSE", accountId, amount: D(f.totalCost).toFixed(2), date: f.date.toISOString().slice(0, 10), description: describe(f.station), categoryId: cat?.id ?? null, vehicleId: f.vehicleId, force: true, idempotencyKey: `fuel:${f.id}` }));
  await db.fuelEntry.update({ where: { id: f.id }, data: { ledgerTransactionId: tx.id } });
  return { transactionId: tx.id };
}

/** Keeps the ledger row in step when the fill-up is edited. A reconciled row is left alone: it matches a bank statement. */
export async function syncFuelLedger(actor: Actor, fuelId: string) {
  const f = await db.fuelEntry.findUnique({ where: { id: fuelId }, include: { vehicle: { select: { householdId: true } } } });
  if (!f?.ledgerTransactionId) return { synced: false };
  const t = await db.finTransaction.findFirst({ where: { id: f.ledgerTransactionId, deletedAt: null }, select: { reconciliation: true } });
  if (!t || t.reconciliation !== "UNRECONCILED" || D(f.totalCost).lte(0)) return { synced: false };
  const ctx = await finCtx(actor, f.vehicle.householdId, "write");
  await updateTransaction(ctx, f.ledgerTransactionId, txPatchSchema.parse({ amount: D(f.totalCost).toFixed(2), date: f.date.toISOString().slice(0, 10), description: describe(f.station) }));
  return { synced: true };
}

export async function removeFuelLedger(actor: Actor, fuelId: string) {
  const f = await db.fuelEntry.findUnique({ where: { id: fuelId }, include: { vehicle: { select: { householdId: true } } } });
  if (!f?.ledgerTransactionId) return { removed: false };
  const t = await db.finTransaction.findFirst({ where: { id: f.ledgerTransactionId, deletedAt: null }, select: { reconciliation: true } });
  if (!t || t.reconciliation !== "UNRECONCILED") return { removed: false };
  const ctx = await finCtx(actor, f.vehicle.householdId, "write");
  await deleteTransaction(ctx, f.ledgerTransactionId);
  return { removed: true };
}
