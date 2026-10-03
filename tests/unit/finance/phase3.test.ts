import { describe, expect, it } from "vitest";
import { keepOrReplace } from "@/server/finance/engine/keepreplace";
import { businessShare, mileageClaim } from "@/server/finance/engine/mileage";

const base = {
  years: 5,
  keep: { value: "8000", annualRepairs: "1500", repairGrowthPct: "10", annualFuel: "2400", annualInsurance: "1500", depreciationPct: "10" },
  replace: { price: "35000", annualRepairs: "300", annualFuel: "2000", annualInsurance: "2200", firstYearDepreciationPct: "20", depreciationPct: "12", downPayment: "5000", loanRatePct: "7", loanMonths: 60 },
};
describe("keep or replace", () => {
  it("adds up loss in value, running costs and interest for both choices", () => {
    const r = keepOrReplace(base);
    expect(r.yearly).toHaveLength(5);
    // year one keep: 800 depreciation + 1500 + 2400 + 1500
    expect(r.yearly[0].keep).toBe("6200.00");
    // year one replace: 7000 depreciation + 300 + 2000 + 2200 + first year interest
    expect(Number(r.yearly[0].replace)).toBeGreaterThan(11500);
    expect(Number(r.replaceMonthlyPayment)).toBeGreaterThan(550);
    expect(r.cheaper).toBe("KEEP");
  });
  it("a free zero-interest swap into a cheap, reliable car wins and has a break-even year", () => {
    const r = keepOrReplace({ ...base, keep: { ...base.keep, annualRepairs: "6000" }, replace: { ...base.replace, price: "9000", downPayment: "9000", loanRatePct: 0, loanMonths: 0 } });
    expect(r.cheaper).toBe("REPLACE");
    expect(r.breakEvenYear).not.toBeNull();
    expect(r.replaceInterest).toBe("0.00");
  });
});

describe("mileage", () => {
  it("business share is unknown, not guessed, without total distance", () => {
    expect(businessShare("100", null)).toBeNull();
    expect(businessShare("100", "0")).toBeNull();
    expect(businessShare("50", "200")!.toString()).toBe("25");
    expect(businessShare("500", "200")!.toString()).toBe("100");
  });
  it("applies the tiered per-km rate and the percent method", () => {
    const c = mileageClaim({ year: 2025, businessKm: "6000", totalKm: "12000", runningCosts: "8000" });
    expect(c.rateMethod).toBe("4260.00"); // 5000 x 0.72 + 1000 x 0.66
    expect(c.percentMethod).toBe("4000.00");
    expect(c.businessPercent).toBe("50");
    const none = mileageClaim({ year: 2025, businessKm: "100", totalKm: null, runningCosts: "8000" });
    expect(none.percentMethod).toBeNull();
    expect(mileageClaim({ year: 1999, businessKm: "10", totalKm: null, runningCosts: null }).rateMethod).toBeNull();
  });
});
