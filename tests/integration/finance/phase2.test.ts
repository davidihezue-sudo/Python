import { describe, expect, it } from "vitest";
import { account, catId, coupleHousehold, ctxFor, db, spend } from "./helpers";
import { createGoal, goalSchema } from "@/server/finance/goals";
import { createSubscription, subscriptionSchema } from "@/server/finance/bills";
import { createTransaction } from "@/server/finance/transactions";
import { emailMonthlyReview, getReviewSettings, monthlyReview, retirementDefaults, sendDueMonthlyReviews, sinkingFunds, subscriptionWatch, updateReviewSettings, yearInReview } from "@/server/finance/insight";

const IN = (c: any, acct: string, amount: string, date: string, desc = "Pay") => createTransaction(c, { type: "INCOME", accountId: acct, amount, date, description: desc, categoryId: undefined, force: true } as never);

describe("sinking funds", () => {
  it("turns a dated goal into a monthly amount", async () => {
    const { david, householdId } = await coupleHousehold();
    const d = await ctxFor(david, householdId, "write");
    const acct = await account(d, "Sav", { type: "SAVINGS" });
    const next = `${Number(d.today.slice(0, 4)) + 1}${d.today.slice(4)}`;
    await createGoal(d, goalSchema.parse({ name: "Car insurance", kind: "CUSTOM", tracking: "CONTRIBUTIONS", targetAmount: "1200.00", targetDate: next, monthlyContribution: "50.00", accountId: acct }));
    const r = await sinkingFunds(d, { view: "all" });
    expect(r.items).toHaveLength(1);
    expect(r.items[0].monthsLeft).toBeGreaterThanOrEqual(12);
    expect(Number(r.items[0].perMonth)).toBeGreaterThan(0);
    expect(r.items[0].status).toBe("behind");
  });
});

describe("subscription watch", () => {
  it("finds a ledger price rise, a duplicate, and an unlisted regular charge, using only visible records", async () => {
    const { david, sharon, householdId } = await coupleHousehold();
    const d = await ctxFor(david, householdId, "write"), s = await ctxFor(sharon, householdId, "write");
    const acct = await account(d, "Chq");
    const sAcct = await account(s, "Sharon chq", { visibility: "PERSONAL" });
    const base = { nextBillingDate: "2026-12-01", frequency: "MONTHLY", category: "Streaming", visibility: "HOUSEHOLD" };
    await createSubscription(d, subscriptionSchema.parse({ name: "Streamflix", amount: "12.00", ...base }));
    await createSubscription(d, subscriptionSchema.parse({ name: "Streamflix Premium", provider: "Streamflix", amount: "20.00", ...base }));
    const chargeOn = (c: any, a: string, desc: string, amt: string, date: string, extra = {}) => createTransaction(c, { type: "EXPENSE", accountId: a, amount: amt, date, description: desc, force: true, ...extra } as never);
    for (const [m, amt] of [["01", "12.00"], ["02", "12.00"], ["03", "14.00"]]) await chargeOn(d, acct, "Streamflix", amt, `${new Date().getUTCFullYear()}-${m}-05`, { merchant: "Streamflix" });
    for (const m of ["01", "02", "03"]) await chargeOn(d, acct, "Tunebox", "9.99", `${new Date().getUTCFullYear()}-${m}-07`, { merchant: "Tunebox" });
    for (const m of ["01", "02", "03"]) await chargeOn(s, sAcct, "SecretApp", "30.00", `${new Date().getUTCFullYear()}-${m}-09`, { merchant: "SecretApp", visibility: "PERSONAL" });
    const w = await subscriptionWatch(d, { view: "all" });
    expect(w.duplicates).toHaveLength(1);
    expect(w.increases.some((i) => i.name === "Streamflix" && i.to === "14.00")).toBe(true);
    expect(w.untracked.map((u) => u.merchant)).toContain("Tunebox");
    expect(w.untracked.map((u) => u.merchant)).not.toContain("SecretApp");
  });
});

describe("year in review and monthly review", () => {
  it("household view excludes a partner's personal records", async () => {
    const { david, sharon, householdId } = await coupleHousehold();
    const d = await ctxFor(david, householdId, "write"), s = await ctxFor(sharon, householdId, "write");
    const year = Number(d.today.slice(0, 4));
    const acct = await account(d, "Joint chq", { visibility: "HOUSEHOLD" });
    const sAcct = await account(s, "Sharon private", { visibility: "PERSONAL" });
    await IN(d, acct, "3000.00", `${year}-01-15`);
    await spend(d, acct, "Groceries", "100.00", {}, `${year}-01-20`);
    await spend(s, sAcct, "Groceries", "900.00", { visibility: "PERSONAL" }, `${year}-01-21`);
    const r = await yearInReview(d, { view: "household", year });
    expect(r.totals.expenses).toBe("100.00");
    const mine = await yearInReview(s, { view: "my", year });
    expect(mine.totals.expenses).toBe("900.00");
    expect(r.highlights.length).toBeGreaterThan(0);
    const m = await monthlyReview(d, { view: "my", month: `${year}-01` });
    expect(m.totals.expenses).toBe("100.00");
    expect(m.topCategories[0].name).toBe("Groceries");
  });

  it("emails only to the signed-in member and the opt-in job sends once per month", async () => {
    const { david, sharon, householdId } = await coupleHousehold();
    const d = await ctxFor(david, householdId, "write");
    const r = await emailMonthlyReview(d, { view: "my" } as never);
    expect(r.sentTo).toBe("david@example.com");
    expect(await db.emailOutbox.count({ where: { toEmail: "david@example.com", subject: { contains: "money review" } } })).toBe(1);
    expect((await getReviewSettings(d)).monthlyReview).toBe(false);
    await updateReviewSettings(d, { monthlyReview: true });
    const firstOfNext = new Date(`${d.today.slice(0, 7)}-02T12:00:00Z`);
    const a = await sendDueMonthlyReviews(firstOfNext);
    expect(a.sent).toBeGreaterThanOrEqual(1);
    const b = await sendDueMonthlyReviews(firstOfNext);
    expect(b.sent).toBe(0);
    expect(await db.emailOutbox.count({ where: { toEmail: "sharon@example.com", subject: { contains: "money review" } } })).toBe(0);
    void sharon;
    expect((await sendDueMonthlyReviews(new Date(`${d.today.slice(0, 7)}-20T12:00:00Z`))).sent).toBe(0);
  });

  it("retirement defaults count only the member's own investments", async () => {
    const { david, householdId } = await coupleHousehold();
    const d = await ctxFor(david, householdId, "write");
    expect((await retirementDefaults(d)).savings).toBe("0.00");
  });
});
void catId;
