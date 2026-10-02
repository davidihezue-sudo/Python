// Access rule for documents attached to finance records: a document is exactly as visible as the record it is attached to.
// Kept separate (no imports from the vehicle document service) so both services can use it without a cycle.
import { db } from "@/lib/db";
import { forbidden, notFound } from "@/lib/errors";
import { canEdit, canSee, type FinCtx, type Shareable } from "./access";

export const FIN_ENTITIES = ["transaction", "income", "insurance", "debt", "asset", "investment", "tax", "bill", "subscription"] as const;
export type FinEntity = (typeof FIN_ENTITIES)[number];

/** Loads the parent record's sharing fields (null when it does not exist in this household). */
export async function parentSharing(householdId: string, entity: string, entityId: string): Promise<Shareable | null> {
  const w = { id: entityId, householdId, deletedAt: null };
  switch (entity) {
    case "transaction": return db.finTransaction.findFirst({ where: w, select: { ownerMemberId: true, visibility: true, sharedWithMemberIds: true } });
    case "income": return db.incomeSource.findFirst({ where: w, select: { ownerMemberId: true, visibility: true, sharedWithMemberIds: true } });
    case "insurance": return db.insurancePolicy.findFirst({ where: w, select: { ownerMemberId: true, visibility: true, sharedWithMemberIds: true } });
    case "debt": return db.debt.findFirst({ where: w, select: { ownerMemberId: true, visibility: true, sharedWithMemberIds: true } });
    case "asset": return db.asset.findFirst({ where: w, select: { ownerMemberId: true, visibility: true, sharedWithMemberIds: true } });
    case "tax": return db.taxRecord.findFirst({ where: w, select: { ownerMemberId: true, visibility: true, sharedWithMemberIds: true } });
    case "bill": return db.bill.findFirst({ where: w, select: { ownerMemberId: true, visibility: true, sharedWithMemberIds: true } });
    case "subscription": return db.recurringSubscription.findFirst({ where: w, select: { ownerMemberId: true, visibility: true, sharedWithMemberIds: true } });
    case "investment": {
      const p = await db.investmentProfile.findFirst({ where: { id: entityId, householdId }, include: { account: { select: { ownerMemberId: true, visibility: true, sharedWithMemberIds: true, deletedAt: true } } } });
      return p && !p.account.deletedAt ? p.account : null;
    }
    default: return null;
  }
}

export async function assertFinanceDocAccess(ctx: FinCtx, doc: { householdId: string; finEntity: string | null; finEntityId: string | null }, write = false) {
  if (!doc.finEntity || !doc.finEntityId) return;
  const s = await parentSharing(doc.householdId, doc.finEntity, doc.finEntityId);
  if (!s || !canSee(ctx, s)) throw notFound("Document"); // hidden records never reveal that a document exists
  if (write && !canEdit(ctx, s)) throw forbidden();
}
