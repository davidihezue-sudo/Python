import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createBill, createRecurring, listBills, postDueRecurring, updateBill, billSchema, recurringSchema } from "@/server/finance/bills";
import { createTransaction } from "@/server/finance/transactions";
import { account, catId, coupleHousehold, ctxFor } from "./helpers";

describe("recurring payments", () => {
  it("a rule created from an entered transaction does not post that first one twice and then follows the schedule", async () => {
    const { david, householdId } = await coupleHousehold();
    const ctx = await ctxFor(david, householdId, "write");
    const acct = await account(ctx, "Chequing");
    const category = await catId(ctx, "Groceries");
    const rule = await createRecurring(ctx, recurringSchema.parse({ type: "EXPENSE", description: "Rent", amount: "1200.00", accountId: acct, categoryId: category, frequency: "MONTHLY", startDate: "2026-07-15", autoPost: true, lastPostedOn: "2026-07-15" }));
    await createTransaction(ctx, { type: "EXPENSE", accountId: acct, amount: "1200.00", date: "2026-07-15", description: "Rent", categoryId: category, recurringRuleId: rule.id } as never);
    const res = await postDueRecurring(ctx, rule.id, "2026-10-02");
    expect(res.posted).toBe(2); // 15 Aug and 15 Sep, not the 15 Jul that was already entered
    const rows = await db.finTransaction.findMany({ where: { recurringRuleId: rule.id, deletedAt: null }, orderBy: { date: "asc" } });
    expect(rows.map((r) => r.date.toISOString().slice(0, 10))).toEqual(["2026-07-15", "2026-08-15", "2026-09-15"]);
    expect((await postDueRecurring(ctx, rule.id, "2026-10-02")).posted).toBe(0); // safe to repeat
  });

  it("a one-time bill can be made recurring and then keeps producing upcoming occurrences", async () => {
    const { david, householdId } = await coupleHousehold();
    const ctx = await ctxFor(david, householdId, "write");
    const b = await createBill(ctx, billSchema.parse({ name: "Annual fee", amount: "99.00", frequency: "ONE_TIME", dueDate: ctx.today, kind: "OTHER" }));
    await updateBill(ctx, b.id, { frequency: "MONTHLY", endDate: null } as never);
    const row = (await listBills(ctx, "all")).find((x) => x.id === b.id);
    expect(row?.frequency).toBe("MONTHLY");
  });
});
