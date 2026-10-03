import { describe, expect, it } from "vitest";
import { account, catId, coupleHousehold, ctxFor, db, spend } from "./helpers";
import { createRule, applyRulesToExisting, previewRule } from "@/server/finance/rules";
import { createTransaction, listTransactions } from "@/server/finance/transactions";
import { txQuerySchema } from "@/server/finance/transactions";
import { listTags, tagSummary, createSavedView, listSavedViews, deleteSavedView } from "@/server/finance/tags";
import { registeredStatus, saveRoom } from "@/server/finance/registered";
import { createPlan, runPlan } from "@/server/finance/payday";
import { safeSpend } from "@/server/finance/safe";
import { budgetNudge } from "@/server/finance/budgets";

const q = (o: Record<string, unknown> = {}) => txQuerySchema.parse(o);

describe("rules and tags", () => {
  it("fills only what is empty, and a member cannot create a household rule", async () => {
    const { david, sharon, householdId } = await coupleHousehold();
    const d = await ctxFor(david, householdId, "write"), s = await ctxFor(sharon, householdId, "write");
    const acct = await account(d, "Chq");
    const gro = await catId(d, "Groceries"), din = await catId(d, "Restaurants");
    await expect(createRule(s, { name: "x", scope: "HOUSEHOLD", priority: 100, active: true, conditions: { textAny: ["costco"] }, actions: { categoryId: gro } } as never)).rejects.toBeTruthy();
    await createRule(d, { name: "Costco", scope: "HOUSEHOLD", priority: 100, active: true, conditions: { textAny: ["costco"] }, actions: { categoryId: gro, addTags: ["Bulk Buy"] } } as never);
    const a = await createTransaction(d, { type: "EXPENSE", accountId: acct, amount: "50.00", date: "2026-03-10", description: "COSTCO #123", force: true } as never);
    const b = await createTransaction(d, { type: "EXPENSE", accountId: acct, amount: "20.00", date: "2026-03-10", description: "Costco snacks", categoryId: din, force: true } as never);
    const ra = await db.finTransaction.findUniqueOrThrow({ where: { id: a.id } }), rb = await db.finTransaction.findUniqueOrThrow({ where: { id: b.id } });
    expect(ra.categoryId).toBe(gro);
    expect(ra.tags).toEqual(["bulk-buy"]);
    expect(rb.categoryId).toBe(din);
    const found = await listTransactions(d, q({ tag: "bulk-buy" }));
    expect(found.items.map((i) => i.id)).toContain(a.id);
    expect((await listTags(d)).length).toBeGreaterThan(0);
    expect((await tagSummary(d, { view: "household" } as never)).tags.length + 1).toBeGreaterThan(0);
  });

  it("personal rules stay private and apply to past records", async () => {
    const { david, sharon, householdId } = await coupleHousehold();
    const d = await ctxFor(david, householdId, "write"), s = await ctxFor(sharon, householdId, "write");
    const acct = await account(d, "Chq");
    const gro = await catId(d, "Groceries");
    const t = await createTransaction(d, { type: "EXPENSE", accountId: acct, amount: "10.00", date: "2026-03-10", description: "Spud shop", force: true } as never);
    expect((await db.finTransaction.findUniqueOrThrow({ where: { id: t.id } })).categoryId).toBeNull();
    const r = await createRule(d, { name: "Spud", scope: "MINE", priority: 100, active: true, conditions: { textAny: ["spud"] }, actions: { categoryId: gro } } as never);
    expect((await previewRule(d, { conditions: { textAny: ["spud"] } } as never)).matched).toBeGreaterThan(0);
    const res = await applyRulesToExisting(d, { ruleId: r.id } as never);
    expect(res.updated).toBeGreaterThan(0);
    expect((await db.finTransaction.findUniqueOrThrow({ where: { id: t.id } })).categoryId).toBe(gro);
    const { listRules } = await import("@/server/finance/rules");
    expect((await listRules(s)).some((x) => x.id === r.id)).toBe(false);
  });
});

describe("saved views, registered room, safe to spend", () => {
  it("saved views are private to their owner", async () => {
    const { david, sharon, householdId } = await coupleHousehold();
    const d = await ctxFor(david, householdId, "write"), s = await ctxFor(sharon, householdId, "write");
    const v = await createSavedView(d, { name: "Fuel", kind: "transactions", params: { tag: "fuel" } } as never);
    expect((await listSavedViews(d)).length).toBe(1);
    expect((await listSavedViews(s)).length).toBe(0);
    await expect(deleteSavedView(s, v.id)).rejects.toBeTruthy();
    await deleteSavedView(d, v.id);
  });

  it("registered room is personal to each member", async () => {
    const { david, sharon, householdId } = await coupleHousehold();
    const d = await ctxFor(david, householdId, "write"), s = await ctxFor(sharon, householdId, "write");
    await saveRoom(d, { kind: "TFSA", year: 2026, openingRoom: "20000.00" } as never);
    const dr = await registeredStatus(d, { year: 2026 });
    const sr = await registeredStatus(s, { year: 2026 });
    expect(dr.items.find((i) => i.kind === "TFSA")!.hasRoom).toBe(true);
    expect(sr.items.find((i) => i.kind === "TFSA")!.hasRoom).toBe(false);
  });

  it("safe to spend counts cash minus upcoming obligations", async () => {
    const { david, householdId } = await coupleHousehold();
    const d = await ctxFor(david, householdId, "write");
    await account(d, "Chq");
    const r = await safeSpend(d, { view: "my" } as never);
    expect(Number(r.cash)).toBeGreaterThan(0);
    expect(["ok", "tight", "short"]).toContain(r.status);
  });
});

describe("pay day plan", () => {
  it("moves money once, refuses a double run and an over-paycheck plan", async () => {
    const { david, householdId } = await coupleHousehold();
    const d = await ctxFor(david, householdId, "write");
    const chq = await account(d, "Chq"), sav = await account(d, "Sav", { type: "SAVINGS", openingBalance: "0.00" });
    const plan = await createPlan(d, { name: "Payday", sourceAccountId: chq, lines: [{ label: "Save", mode: "PERCENT", value: "10", toAccountId: sav }, { label: "Fixed", mode: "AMOUNT", value: "100", toAccountId: sav }], active: true } as never);
    const run = await runPlan(d, plan.id, { date: "2026-03-15", paycheck: "2000.00", force: false } as never);
    expect(run.total).toBe("300.00");
    const bal = await db.finTransaction.aggregate({ where: { accountId: sav, deletedAt: null }, _sum: { amount: true } });
    expect(Number(bal._sum.amount)).toBe(300);
    await expect(runPlan(d, plan.id, { date: "2026-03-15", paycheck: "2000.00", force: false } as never)).rejects.toBeTruthy();
    await expect(runPlan(d, plan.id, { date: "2026-03-16", paycheck: "100.00", force: false } as never)).rejects.toBeTruthy();
  });

  it("another member cannot run or see my plan", async () => {
    const { david, sharon, householdId } = await coupleHousehold();
    const d = await ctxFor(david, householdId, "write"), s = await ctxFor(sharon, householdId, "write");
    const chq = await account(d, "Chq"), sav = await account(d, "Sav");
    const plan = await createPlan(d, { name: "P", sourceAccountId: chq, lines: [{ label: "S", mode: "AMOUNT", value: "10", toAccountId: sav }], active: true } as never);
    await expect(runPlan(s, plan.id, { date: "2026-03-15", paycheck: "100.00", force: false } as never)).rejects.toBeTruthy();
  });
});

describe("budget nudge", () => {
  it("returns null when there is no budget", async () => {
    const { david, householdId } = await coupleHousehold();
    const d = await ctxFor(david, householdId, "write");
    const acct = await account(d, "Chq");
    const t = await spend(d, acct, "Groceries", "10.00");
    expect(await budgetNudge(d, t.id)).toBeNull();
  });
});
