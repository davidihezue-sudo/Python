import { describe, expect, it } from "vitest";
import { amortise, levelPayment, periodicRate, simulateStrategy, splitPayment } from "@/server/finance/engine/debt";
import { CANADA_MORTGAGE_RULES, debtServiceRatios, insurancePremiumPct, maxAffordablePrice, minimumDownPayment, planMortgage, qualifyingRate } from "@/server/finance/engine/mortgage";
import { sum } from "@/server/finance/engine/decimal";

describe("loan maths", () => {
  it("matches the standard level payment (200k, 6%, 30 years, monthly) of 1199.10", () => {
    const r = periodicRate(6, 12, 12);
    expect(r.toFixed(6)).toBe("0.005000");
    expect(levelPayment(200000, r, 360).toFixed(2)).toBe("1199.10");
  });
  it("zero interest divides evenly", () => {
    expect(levelPayment(1200, 0, 12).toFixed(2)).toBe("100.00");
    const a = amortise({ balance: 1200, aprPercent: 0, payment: 100 });
    expect(a.periods).toBe(12);
    expect(a.totalInterest.isZero()).toBe(true);
  });
  it("amortisation closes to exactly zero and totals reconcile", () => {
    const pay = levelPayment(25000, periodicRate(7.5, 12, 12), 60);
    const a = amortise({ balance: 25000, aprPercent: 7.5, payment: pay, startDate: "2026-01-15" });
    expect(a.paidOff).toBe(true);
    expect(a.periods).toBe(60);
    expect(a.rows[a.rows.length - 1].closing.isZero()).toBe(true);
    expect(sum(a.rows.map((r) => r.principal)).toFixed(2)).toBe("25000.00");
    expect(a.totalPaid.minus(a.totalInterest).toFixed(2)).toBe("25000.00");
    expect(a.rows[0].date).toBe("2026-01-15");
    expect(a.payoffDate).toBe("2030-12-15");
    // every row obeys opening - principal = closing
    for (const r of a.rows) expect(r.opening.minus(r.principal).eq(r.closing)).toBe(true);
  });
  it("flags a payment that does not cover interest instead of looping forever", () => {
    const a = amortise({ balance: 10000, aprPercent: 24, payment: 100 });
    expect(a.paidOff).toBe(false);
    expect(a.reason).toMatch(/does not cover the interest/);
  });
  it("extra payments shorten the term and reduce interest", () => {
    const base = amortise({ balance: 10000, aprPercent: 12, payment: 300 });
    const extra = amortise({ balance: 10000, aprPercent: 12, payment: 300, extra: 200 });
    expect(extra.periods).toBeLessThan(base.periods);
    expect(extra.totalInterest.lt(base.totalInterest)).toBe(true);
  });
  it("splits a payment into interest and principal and caps at the balance", () => {
    const s = splitPayment({ balance: 10000, aprPercent: 12, total: 500 });
    expect(s.interest.toFixed(2)).toBe("100.00");
    expect(s.principal.toFixed(2)).toBe("400.00");
    const last = splitPayment({ balance: 50, aprPercent: 12, total: 500 });
    expect(last.principal.toFixed(2)).toBe("50.00");
    expect(splitPayment({ balance: 10000, aprPercent: 12, total: 40 }).principal.toFixed(2)).toBe("0.00");
  });
  it("Canadian semi-annual compounding gives a lower monthly rate than monthly compounding", () => {
    expect(periodicRate(5, 2, 12).lt(periodicRate(5, 12, 12))).toBe(true);
  });
  it("a balance already at zero is trivially paid off", () => {
    expect(amortise({ balance: 0, aprPercent: 5, payment: 100 }).paidOff).toBe(true);
  });
});

describe("repayment strategies", () => {
  const debts = [
    { id: "card", name: "Credit card", balance: 4000, aprPercent: 21.99, minimumPayment: 100 },
    { id: "loan", name: "Personal loan", balance: 3000, aprPercent: 9.5, minimumPayment: 120 },
    { id: "loc", name: "Line of credit", balance: 1500, aprPercent: 8, minimumPayment: 60 },
  ];
  it("avalanche never pays more interest than snowball; both finish", () => {
    const av = simulateStrategy({ debts, strategy: "AVALANCHE", extraMonthly: 200, startDate: "2026-01-01" });
    const sn = simulateStrategy({ debts, strategy: "SNOWBALL", extraMonthly: 200, startDate: "2026-01-01" });
    expect(av.completed && sn.completed).toBe(true);
    expect(av.totalInterest.lte(sn.totalInterest)).toBe(true);
    expect(av.payoffOrder[0].id).toBe("card");
    expect(sn.payoffOrder[0].id).toBe("loc");
    expect(av.debtFreeDate).toBeTruthy();
  });
  it("paying extra always beats minimums only", () => {
    const none = simulateStrategy({ debts, strategy: "AVALANCHE", extraMonthly: 0 });
    const more = simulateStrategy({ debts, strategy: "AVALANCHE", extraMonthly: 300 });
    expect(more.months).toBeLessThan(none.months);
    expect(more.totalInterest.lt(none.totalInterest)).toBe(true);
  });
  it("custom order is respected", () => {
    const c = simulateStrategy({ debts, strategy: "CUSTOM", customOrder: ["loan", "card", "loc"], extraMonthly: 400 });
    expect(c.payoffOrder[0].id).toBe("loan");
  });
  it("conserves money: total paid = principal + interest", () => {
    const r = simulateStrategy({ debts, strategy: "AVALANCHE", extraMonthly: 150 });
    expect(r.totalPaid.minus(r.totalInterest).toFixed(2)).toBe("8500.00");
  });
  it("reports when payments are missing", () => {
    const r = simulateStrategy({ debts: [{ id: "x", name: "x", balance: 100, aprPercent: 10, minimumPayment: 0 }], strategy: "AVALANCHE" });
    expect(r.completed).toBe(false);
  });
});

describe("mortgage planner", () => {
  it("applies banded minimum down payments", () => {
    expect(minimumDownPayment(400000).toFixed(2)).toBe("20000.00");
    expect(minimumDownPayment(600000).toFixed(2)).toBe("35000.00");
    expect(minimumDownPayment(1500000).toFixed(2)).toBe("300000.00");
  });
  it("insurance premium bands and extended amortisation surcharge", () => {
    expect(insurancePremiumPct(95, 25)!.toFixed(2)).toBe("4.00");
    expect(insurancePremiumPct(95, 30)!.toFixed(2)).toBe("4.20");
    expect(insurancePremiumPct(80, 25)!.isZero()).toBe(true);
    expect(insurancePremiumPct(96, 25)).toBeNull();
  });
  it("capitalises mortgage insurance for a 5 percent down payment", () => {
    const m = planMortgage({ price: 500000, downPayment: 25000, aprPercent: 5, amortisationYears: 25 });
    expect(m.basePrincipal.toFixed(2)).toBe("475000.00");
    expect(m.insuranceRequired).toBe(true);
    expect(m.insurancePremium.toFixed(2)).toBe("19000.00");
    expect(m.principal.toFixed(2)).toBe("494000.00");
    expect(m.closingCosts.toFixed(2)).toBe("7500.00");
    expect(m.cashRequired.toFixed(2)).toBe("32500.00");
  });
  it("no insurance with 20 percent down; payment, interest and balances reconcile", () => {
    const m = planMortgage({ price: 600000, downPayment: 120000, aprPercent: 5, amortisationYears: 25, termYears: 5, propertyTaxAnnual: 3600, insuranceAnnual: 1200, heatingMonthly: 150, condoFeesMonthly: 0, cashAvailable: 140000 });
    expect(m.insuranceRequired).toBe(false);
    expect(m.principal.toFixed(2)).toBe("480000.00");
    expect(m.payment.gt(2500) && m.payment.lt(2900)).toBe(true);
    expect(m.housingCostMonthly.minus(m.monthlyEquivalent).toFixed(2)).toBe("550.00");
    const principalPaid = sum(m.yearly.map((y) => y.principalPaid));
    expect(principalPaid.toFixed(0)).toBe("480000");
    expect(m.cashRemaining!.toFixed(2)).toBe((140000 - 120000 - 9000).toFixed(2));
    expect(m.balanceAtEndOfTerm.lt(m.principal)).toBe(true);
    expect(m.totalInterestOverAmortisation.gt(m.totalInterestOverTerm)).toBe(true);
  });
  it("warns when the down payment is below the minimum and when the deal cannot be insured", () => {
    const low = planMortgage({ price: 500000, downPayment: 10000, aprPercent: 5, amortisationYears: 25 });
    expect(low.meetsMinimumDownPayment).toBe(false);
    expect(low.warnings.length).toBeGreaterThan(0);
    const big = planMortgage({ price: 1600000, downPayment: 100000, aprPercent: 5, amortisationYears: 25 });
    expect(big.insurable).toBe(false);
  });
  it("accelerated biweekly is half the monthly payment", () => {
    const monthly = planMortgage({ price: 500000, downPayment: 100000, aprPercent: 5, amortisationYears: 25 });
    const acc = planMortgage({ price: 500000, downPayment: 100000, aprPercent: 5, amortisationYears: 25, frequency: "BIWEEKLY", accelerated: true });
    expect(acc.payment.toFixed(2)).toBe(monthly.payment.div(2).toDecimalPlaces(2).toFixed(2));
  });
  it("computes GDS and TDS and the stress test rate", () => {
    const r = debtServiceRatios({ grossAnnualIncome: 120000, mortgageMonthly: 2800, propertyTaxAnnual: 3600, heatingMonthly: 150, condoFeesMonthly: 400, otherDebtMonthly: 500 });
    expect(r.gds!.toFixed(2)).toBe("34.50");
    expect(r.tds!.toFixed(2)).toBe("39.50");
    expect(r.withinLimits).toBe(true);
    expect(qualifyingRate(4).toFixed(2)).toBe("6.00");
    expect(qualifyingRate(2).toFixed(2)).toBe("5.25");
    expect(debtServiceRatios({ grossAnnualIncome: 0, mortgageMonthly: 1 }).gds).toBeNull();
  });
  it("finds a maximum price whose stress tested ratios are within limits", () => {
    const r = maxAffordablePrice({ downPayment: 100000, aprPercent: 5, amortisationYears: 25, grossAnnualIncome: 150000, propertyTaxAnnual: 4000, heatingMonthly: 150, otherDebtMonthly: 300 });
    expect(r.price.gt(300000)).toBe(true);
    expect(r.ratios.withinLimits).toBe(true);
    expect(r.qualifyingRatePercent.toFixed(2)).toBe("7.00");
  });
  void CANADA_MORTGAGE_RULES;
});
