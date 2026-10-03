import { describe, expect, it } from "vitest";
import { projectRetirement, realMonthlyRate } from "@/server/finance/engine/retirement";
import { planResp, yearGrant } from "@/server/finance/engine/resp";
import { sinkingNeed } from "@/server/finance/engine/sinking";
import { findDuplicates, findUntracked, priceChange } from "@/server/finance/engine/subwatch";

const base = { currentAge: 35, retireAge: 65, lifeAge: 95, savings: "50000", monthlyContribution: "1000", returnPct: "6", inflationPct: "2", annualSpending: "50000", benefitIncome: "20000", benefitAge: 65 };

describe("retirement", () => {
  it("converts to a real monthly return", () => {
    expect(Number(realMonthlyRate("6", "2").times(12).toFixed(3))).toBeCloseTo(0.0392, 2);
    expect(realMonthlyRate("2", "2").toNumber()).toBeCloseTo(0, 12);
  });
  it("with no growth the money is simply saved", () => {
    const r = projectRetirement({ ...base, returnPct: "0", inflationPct: "0", savings: "0", monthlyContribution: "1000", retireAge: 36 });
    expect(r.atRetirement).toBe("12000.00");
  });
  it("finds the independence number and says when money runs out", () => {
    const r = projectRetirement(base);
    expect(r.fiNumber).toBe("750000.00");
    const poor = projectRetirement({ ...base, savings: "0", monthlyContribution: "100" });
    expect(poor.onTrack).toBe(false);
    expect(poor.depletionAge).toBeGreaterThan(65);
    expect(poor.depletionAge).toBeLessThan(95);
  });
  it("the required monthly saving actually reaches the number", () => {
    const r = projectRetirement(base);
    const again = projectRetirement({ ...base, monthlyContribution: r.requiredMonthly! });
    expect(Number(again.atRetirement)).toBeGreaterThanOrEqual(Number(again.fiNumber) - 1);
  });
});

describe("RESP", () => {
  it("matches 20 percent up to the yearly cap", () => {
    expect(yearGrant("2500", 0, "7200").grant.toString()).toBe("500");
    expect(yearGrant("1000", 0, "7200").grant.toString()).toBe("200");
    expect(yearGrant("5000", 0, "7200").grant.toString()).toBe("500");
    expect(yearGrant("5000", 3, "7200").grant.toString()).toBe("1000");
    expect(yearGrant("5000", 3, "300").grant.toString()).toBe("300");
  });
  it("never goes past the lifetime grant and shows the grant missed", () => {
    const r = planResp({ childAge: 0, balance: "0", annualContribution: "1000", returnPct: "5", grantsReceived: "0" });
    expect(Number(r.totalGrants)).toBeLessThanOrEqual(7200);
    expect(Number(r.grantMissed)).toBeGreaterThan(0);
    const max = planResp({ childAge: 0, balance: "0", annualContribution: "2500", returnPct: "5", grantsReceived: "0" });
    expect(Number(max.totalGrants)).toBe(7200);
    expect(max.grantMissed).toBe("0.00");
  });
});

describe("sinking funds", () => {
  it("splits what is left across the months remaining", () => {
    const r = sinkingNeed({ target: "1200", saved: "200", dueDate: "2027-01-01", today: "2026-07-01" });
    expect(r.monthsLeft).toBe(7);
    expect(r.remaining).toBe("1000.00");
    expect(Number(r.perMonth) * r.monthsLeft).toBeGreaterThanOrEqual(1000);
    expect(r.status).toBe("behind");
    expect(sinkingNeed({ target: "1200", saved: "1200", dueDate: "2027-01-01", today: "2026-07-01" }).status).toBe("funded");
    expect(sinkingNeed({ target: "100", saved: "0", dueDate: "2026-01-01", today: "2026-07-01" }).status).toBe("overdue");
  });
});

describe("subscription watch", () => {
  it("flags duplicates", () => {
    const d = findDuplicates([{ id: "1", name: "Netflix", amount: 10, active: true }, { id: "2", name: "Netflix Premium", provider: "Netflix", amount: 15, active: true }, { id: "3", name: "Gym", amount: 40, active: true }, { id: "4", name: "Netflix", amount: 10, active: false }]);
    expect(d).toHaveLength(1);
    expect(d[0].ids).toEqual(["1", "2"]);
  });
  it("detects a price rise but not noise", () => {
    expect(priceChange([{ date: "2026-01-01", amount: "10.00" }, { date: "2026-02-01", amount: "10.00" }, { date: "2026-03-01", amount: "12.00" }])).toMatchObject({ from: "10.00", to: "12.00", percent: "20", yearlyImpact: "24.00" });
    expect(priceChange([{ date: "2026-01-01", amount: "10.00" }, { date: "2026-02-01", amount: "10.00" }, { date: "2026-03-01", amount: "10.00" }])).toBeNull();
    expect(priceChange([{ date: "2026-01-01", amount: "10.00" }, { date: "2026-02-01", amount: "10.05" }])).toBeNull();
  });
  it("finds regular charges that are not on the list", () => {
    const ch = (m: string) => ({ date: `2026-${m}-05`, amount: "9.99" });
    const u = findUntracked([{ merchant: "Spotify", charges: [ch("01"), ch("02"), ch("03")] }, { merchant: "Costco", charges: [ch("01"), { date: "2026-01-09", amount: "180" }] }, { merchant: "Netflix", charges: [ch("01"), ch("02"), ch("03")] }], [{ id: "1", name: "Netflix", amount: 10, active: true }]);
    expect(u.map((x) => x.merchant)).toEqual(["Spotify"]);
  });
});
