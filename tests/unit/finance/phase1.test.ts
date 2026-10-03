import { describe, expect, it } from "vitest";
import { applyRules, normaliseTags, ruleMatches, type RuleLite } from "@/server/finance/engine/rules";
import { safeToSpend } from "@/server/finance/engine/safespend";
import { registeredRoom, rrspLimitFromIncome } from "@/server/finance/engine/registered";
import { resolvePayday } from "@/server/finance/engine/payday";

const tx = { description: "COSTCO WHOLESALE #123", amount: "-182.40", type: "EXPENSE", accountId: "a1" };
const rule = (id: string, over: Partial<RuleLite>): RuleLite => ({ id, scope: "MINE", priority: 100, conditions: { textAny: ["costco"] }, actions: { categoryId: "groceries" }, ...over });

describe("rules", () => {
  it("matches words case-insensitively and by amount, account and type", () => {
    expect(ruleMatches({ textAny: ["costco"] }, tx)).toBe(true);
    expect(ruleMatches({ textAny: ["walmart", "costco"] }, tx)).toBe(true);
    expect(ruleMatches({ textAll: ["costco", "wholesale"] }, tx)).toBe(true);
    expect(ruleMatches({ textAll: ["costco", "gas"] }, tx)).toBe(false);
    expect(ruleMatches({ textAny: ["costco"], minAmount: "200" }, tx)).toBe(false);
    expect(ruleMatches({ textAny: ["costco"], minAmount: "100", maxAmount: "200" }, tx)).toBe(true);
    expect(ruleMatches({ textAny: ["costco"], accountId: "other" }, tx)).toBe(false);
    expect(ruleMatches({ textAny: ["costco"], type: "INCOME" }, tx)).toBe(false);
  });
  it("a rule with no conditions never matches", () => {
    expect(ruleMatches({}, tx)).toBe(false);
    expect(ruleMatches({ textAny: [] }, tx)).toBe(false);
    expect(ruleMatches({ textAny: ["  "] }, tx)).toBe(false);
  });
  it("personal rules beat household rules, lower priority numbers beat higher, and tags combine", () => {
    const out = applyRules([
      rule("h", { scope: "HOUSEHOLD", priority: 1, actions: { categoryId: "household-cat", addTags: ["shared"] } }),
      rule("m2", { priority: 50, actions: { categoryId: "second", addTags: ["Bulk Buy"] } }),
      rule("m1", { priority: 10, actions: { categoryId: "first", vehicleId: "veh" } }),
    ], tx);
    expect(out.categoryId).toBe("first");
    expect(out.vehicleId).toBe("veh");
    expect(out.tags).toEqual(["bulk-buy", "shared"]);
    expect(out.matched).toEqual(["m1", "m2", "h"]);
  });
  it("does nothing when nothing matches", () => {
    const out = applyRules([rule("x", { conditions: { textAny: ["shell"] } })], tx);
    expect(out).toEqual({ tags: [], matched: [] });
  });
  it("normalises tags", () => {
    expect(normaliseTags(["  Road Trip ", "road trip", "TAX!", "", "a".repeat(40)])).toEqual(["road-trip", "tax", "a".repeat(30)]);
    expect(normaliseTags(Array.from({ length: 20 }, (_, i) => `t${i}`))).toHaveLength(10);
  });
});

describe("safe to spend", () => {
  const base = { today: "2026-10-03", horizonEnd: "2026-10-14" };
  it("subtracts what is committed before the next pay day and spreads the rest over the days left", () => {
    const r = safeToSpend({ ...base, cash: "1500.00", committed: [{ date: "2026-10-05", amount: "330.00", label: "Property tax" }, { date: "2026-10-12", amount: "112.00", label: "Electricity" }, { date: "2026-10-20", amount: "999.00", label: "after pay day" }] });
    expect(r.committed).toBe("442.00");
    expect(r.safe).toBe("1058.00");
    expect(r.days).toBe(12);
    expect(r.perDay).toBe("88.17");
    expect(r.status).toBe("ok");
    expect(r.items.map((i) => i.label)).toEqual(["Property tax", "Electricity"]);
  });
  it("goes short when commitments exceed cash and keeps a buffer untouched", () => {
    expect(safeToSpend({ ...base, cash: "300.00", committed: [{ date: "2026-10-04", amount: "400", label: "Rent" }] }).status).toBe("short");
    expect(safeToSpend({ ...base, cash: "1000.00", committed: [], buffer: "200.00" }).safe).toBe("800.00");
  });
  it("never divides by zero on pay day", () => {
    const r = safeToSpend({ today: "2026-10-03", horizonEnd: "2026-10-03", cash: "50.00", committed: [] });
    expect(r.days).toBe(1);
    expect(r.perDay).toBe("50.00");
  });
});

describe("registered account room", () => {
  it("tracks contributions against the room the person entered", () => {
    const r = registeredRoom({ kind: "TFSA", openingRoom: "7000", contributed: "2500", withdrawn: "0" });
    expect(r.remaining).toBe("4500.00");
    expect(r.status).toBe("ok");
    expect(r.percentUsed).toBe("35.7");
  });
  it("warns near the limit and flags an excess with the 1 percent monthly tax", () => {
    expect(registeredRoom({ kind: "TFSA", openingRoom: "7000", contributed: "6500", withdrawn: "0" }).status).toBe("near");
    const over = registeredRoom({ kind: "TFSA", openingRoom: "7000", contributed: "8000", withdrawn: "0" });
    expect(over.status).toBe("over");
    expect(over.overBy).toBe("1000.00");
    expect(over.estimatedMonthlyTax).toBe("10.00");
  });
  it("tolerates an RRSP excess up to 2000 dollars and taxes only the part beyond it", () => {
    const ok = registeredRoom({ kind: "RRSP", openingRoom: "10000", contributed: "11500", withdrawn: "0" });
    expect(ok.status).toBe("near");
    expect(ok.estimatedMonthlyTax).toBe("0.00");
    const bad = registeredRoom({ kind: "RRSP", openingRoom: "10000", contributed: "13000", withdrawn: "0" });
    expect(bad.status).toBe("over");
    expect(bad.estimatedMonthlyTax).toBe("10.00");
  });
  it("adds TFSA withdrawals back next year, not this year", () => {
    const r = registeredRoom({ kind: "TFSA", openingRoom: "5000", contributed: "1000", withdrawn: "3000" });
    expect(r.remaining).toBe("4000.00");
    expect(r.restoresNextYear).toBe("3000.00");
  });
  it("estimates the RRSP limit from income, capped at the dollar limit", () => {
    expect(rrspLimitFromIncome("100000", 2025)).toBe("18000.00");
    expect(rrspLimitFromIncome("500000", 2025)).toBe("32490.00");
    expect(rrspLimitFromIncome("100000", 1999)).toBeNull();
  });
});

describe("pay day plan", () => {
  it("resolves amounts and percentages and reports the leftover", () => {
    const r = resolvePayday("2000.00", [{ label: "Rent fund", mode: "AMOUNT", value: "800" }, { label: "TFSA", mode: "PERCENT", value: "10" }, { label: "Holiday", mode: "AMOUNT", value: "100.50" }]);
    expect(r.lines.map((l) => l.amount)).toEqual(["800.00", "200.00", "100.50"]);
    expect(r.total).toBe("1100.50");
    expect(r.leftover).toBe("899.50");
    expect(r.over).toBe(false);
  });
  it("flags a plan that is bigger than the paycheck", () => {
    const r = resolvePayday("500.00", [{ label: "A", mode: "AMOUNT", value: "400" }, { label: "B", mode: "PERCENT", value: "50" }]);
    expect(r.over).toBe(true);
    expect(r.leftover).toBe("-150.00");
  });
  it("rounds percentages to the cent", () => {
    const r = resolvePayday("1000.00", [{ label: "x", mode: "PERCENT", value: "33.333" }]);
    expect(r.lines[0].amount).toBe("333.33");
  });
});
