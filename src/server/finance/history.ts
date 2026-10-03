// Change history for the signed-in member. It lists their own actions, and for administrators the household's membership and settings changes.
// It deliberately carries no before/after values, so it can never reveal the content of someone else's private records.
import { z } from "zod";
import { db } from "@/lib/db";
import type { FinCtx } from "./access";

export const historyQuery = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50), before: z.string().datetime().optional() });
const HOUSEHOLD_LEVEL = ["Household", "HouseholdMember", "HouseholdInvite", "MemberPrivacy"];
const LABEL: Record<string, string> = { FinTransaction: "Transaction", FinAccount: "Account", IncomeSource: "Income", Bill: "Bill", Debt: "Debt", SavingsGoal: "Goal", Asset: "Asset", InsurancePolicy: "Insurance", RecurringSubscription: "Subscription", FinBudget: "Budget", TaxRecord: "Tax record", Document: "Document", WishItem: "Wish", ApiToken: "API token", LegacyPlan: "Emergency page", PaydayPlan: "Pay day plan", FinRule: "Rule", RegisteredRoom: "Registered room", HouseholdMember: "Member", HouseholdInvite: "Invitation", Household: "Household settings", MemberPrivacy: "Sharing defaults", FuelEntry: "Fuel", MileageTrip: "Mileage trip" };

export async function changeHistory(ctx: FinCtx, q: z.infer<typeof historyQuery>) {
  const rows = await db.auditLog.findMany({
    where: { householdId: ctx.householdId, ...(q.before ? { createdAt: { lt: new Date(q.before) } } : {}), OR: [{ userId: ctx.actor.id }, ...(ctx.isAdmin ? [{ entity: { in: HOUSEHOLD_LEVEL } }] : [])] },
    orderBy: { createdAt: "desc" }, take: q.limit + 1, include: { user: { select: { name: true } } },
  });
  const more = rows.length > q.limit;
  return { items: rows.slice(0, q.limit).map((r) => ({ id: r.id, at: r.createdAt.toISOString(), what: LABEL[r.entity] ?? r.entity, action: r.action.replace(/[-_]/g, " "), by: r.userId === ctx.actor.id ? "You" : (r.user?.name ?? "System") })), next: more ? rows[q.limit - 1].createdAt.toISOString() : null, scope: ctx.isAdmin ? "Your own actions, and membership and settings changes in this household." : "Your own actions in this household." };
}
