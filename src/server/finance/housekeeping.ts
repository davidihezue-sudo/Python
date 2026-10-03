// Starting over. Two deliberate, separate tools:
//  * clearMyRecords: removes everything the signed-in member OWNS. Joint accounts, other members' records and household settings are never touched.
//  * deleteHousehold: removes a whole household, but only when nobody else belongs to it, so one person can never wipe another member's records.
import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { storage } from "@/lib/storage";
import { audit } from "../services/audit";
import { requireWriter, type FinCtx } from "./access";

export const clearMySchema = z.object({ confirm: z.literal("CLEAR") });
export const deleteHouseholdSchema = z.object({ confirm: z.string().min(1).max(120) });

async function removeDocuments(householdId: string, byEntity: Record<string, string[]>) {
  for (const [entity, ids] of Object.entries(byEntity)) {
    if (!ids.length) continue;
    const docs = await db.document.findMany({ where: { householdId, finEntity: entity, finEntityId: { in: ids } }, select: { id: true, fileKey: true } });
    for (const d of docs) await storage().delete(d.fileKey).catch(() => undefined);
    if (docs.length) await db.document.deleteMany({ where: { id: { in: docs.map((d) => d.id) } } });
  }
}

/** Permanently deletes every record owned by the signed-in member in this household. */
export async function clearMyRecords(ctx: FinCtx) {
  requireWriter(ctx);
  const me = ctx.me.id;
  const hh = ctx.householdId;
  const counts: Record<string, number> = {};
  const gone: Record<string, string[]> = {};

  await db.$transaction(async (tx) => {
    const myAccounts = (await tx.finAccount.findMany({ where: { householdId: hh, ownerMemberId: me }, select: { id: true } })).map((a) => a.id);
    // A transfer is two legs. If either leg is mine, both go, so no account is left with half a transfer.
    const groups = (await tx.finTransaction.findMany({ where: { householdId: hh, transferGroupId: { not: null }, OR: [{ ownerMemberId: me }, { accountId: { in: myAccounts } }] }, select: { transferGroupId: true } })).map((t) => t.transferGroupId as string);
    const txWhere = { householdId: hh, OR: [{ ownerMemberId: me }, { accountId: { in: myAccounts } }, ...(groups.length ? [{ transferGroupId: { in: [...new Set(groups)] } }] : [])] };
    gone.transaction = (await tx.finTransaction.findMany({ where: txWhere, select: { id: true } })).map((t) => t.id);
    counts.transactions = (await tx.finTransaction.deleteMany({ where: txWhere })).count;

    const mine = { householdId: hh, ownerMemberId: me };
    const collect = async (entity: string, rows: Promise<{ id: string }[]>) => { gone[entity] = (await rows).map((r) => r.id); };
    await collect("income", tx.incomeSource.findMany({ where: mine, select: { id: true } }));
    await collect("bill", tx.bill.findMany({ where: mine, select: { id: true } }));
    await collect("subscription", tx.recurringSubscription.findMany({ where: mine, select: { id: true } }));
    await collect("insurance", tx.insurancePolicy.findMany({ where: mine, select: { id: true } }));
    await collect("debt", tx.debt.findMany({ where: mine, select: { id: true } }));
    await collect("asset", tx.asset.findMany({ where: mine, select: { id: true } }));
    await collect("tax", tx.taxRecord.findMany({ where: mine, select: { id: true } }));
    await collect("investment", tx.investmentProfile.findMany({ where: { householdId: hh, accountId: { in: myAccounts } }, select: { id: true } }));

    counts.income = (await tx.incomeSource.deleteMany({ where: mine })).count;
    counts.recurring = (await tx.recurringRule.deleteMany({ where: mine })).count;
    counts.bills = (await tx.bill.deleteMany({ where: mine })).count;
    counts.subscriptions = (await tx.recurringSubscription.deleteMany({ where: mine })).count;
    counts.insurance = (await tx.insurancePolicy.deleteMany({ where: mine })).count;
    counts.debts = (await tx.debt.deleteMany({ where: mine })).count;
    counts.goals = (await tx.savingsGoal.deleteMany({ where: mine })).count;
    counts.assets = (await tx.asset.deleteMany({ where: mine })).count;
    counts.tax = (await tx.taxRecord.deleteMany({ where: mine })).count;
    counts.budgets = (await tx.finBudget.deleteMany({ where: mine })).count;
    counts.events = (await tx.calendarEvent.deleteMany({ where: mine })).count;
    counts.scenarios = (await tx.finScenario.deleteMany({ where: { householdId: hh, createdById: ctx.actor.id } })).count;
    counts.imports = (await tx.importBatch.deleteMany({ where: { householdId: hh, createdById: ctx.actor.id } })).count;
    await tx.investmentProfile.deleteMany({ where: { householdId: hh, accountId: { in: myAccounts } } });
    counts.accounts = (await tx.finAccount.deleteMany({ where: { id: { in: myAccounts } } })).count;
    await audit(tx, ctx.actor, { entity: "Household", entityId: hh, action: "clear-my-records", householdId: hh, after: counts });
  }, { timeout: 60_000 });

  await removeDocuments(hh, gone);
  return { ok: true, removed: counts };
}

/** Deletes the whole household (finance records, vehicles, members' membership). Only possible when you are the only member. */
export async function deleteHousehold(ctx: FinCtx, input: z.infer<typeof deleteHouseholdSchema>) {
  if (!ctx.isAdmin) throw new AppError("FORBIDDEN", "Only a household administrator can delete the household");
  if (ctx.members.length > 1) throw new AppError("CONFLICT", "Other people still belong to this household. Ask them to leave first, or use Clear my records to remove only what you own.");
  if (input.confirm.trim() !== ctx.household.name) throw new AppError("VALIDATION_ERROR", "Type the household name exactly to confirm");
  const docs = await db.document.findMany({ where: { householdId: ctx.householdId }, select: { fileKey: true } });
  await db.$transaction(async (tx) => {
    await tx.document.deleteMany({ where: { householdId: ctx.householdId } });
    await tx.household.delete({ where: { id: ctx.householdId } });
    await audit(tx, ctx.actor, { entity: "Household", entityId: ctx.householdId, action: "delete", after: { name: ctx.household.name } });
  }, { timeout: 60_000 });
  for (const d of docs) await storage().delete(d.fileKey).catch(() => undefined);
  return { ok: true };
}
