import { describe, expect, it } from "vitest";
import { D } from "@/server/finance/engine/decimal";
import { evaluateBudget, nextPeriod, paceForecast, periodBoundsFor, previousPeriodOf } from "@/server/finance/engine/budget";
import { incomeLossRunway, planEmergencyFund, projectDebtGoal, projectGoal } from "@/server/finance/engine/savings";
import { compareNetWorth, computeNetWorth, netWorthHistory } from "@/server/finance/engine/networth";
import { noFx, makeFx } from "@/server/finance/engine/fx";
import type { LedgerAccount, LedgerTx } from "@/server/finance/engine/ledger";
import { runForecast, type Baseline } from "@/server/finance/engine/forecast";
import { applyAssumptions, runScenario } from "@/server/finance/engine/scenario";

describe("budget", () => {
  it("computes budgeted, actual, remaining, percent, states and totals", () => {
    const r = evaluateBudget({
      lines: [{ categoryId: "groc", amount: 800 }, { categoryId: "ent", amount: 200 }, { categoryId: "util", amount: 350, warnAtPct: 80 }, { categoryId: "zero", amount: 0 }],
      actualByLine: new Map([["groc", D(680)], ["ent", D(250)], ["util", D(300)], ["zero", D(10)]]),
      unbudgetedActual: 55,
      from: "2026-03-01", to: "2026-03-31", today: "2026-03-31",
    });
    const by = Object.fromEntries(r.lines.map((l) => [l.categoryId, l]));
    expect(by.groc.remaining.toFixed(2)).toBe("120.00");
    expect(by.groc.percentUsed!.toFixed(2)).toBe("85.00");
    expect(by.groc.state).toBe("approaching");
    expect(by.ent.state).toBe("over");
    expect(by.ent.remaining.toFixed(2)).toBe("-50.00");
    expect(by.util.state).toBe("approaching");
    expect(by.zero.state).toBe("unfunded");
    expect(by.zero.percentUsed).toBeNull();
    expect(r.totals.budgeted.toFixed(2)).toBe("1350.00");
    expect(r.totals.actual.toFixed(2)).toBe("1240.00");
    expect(r.unbudgeted.toFixed(2)).toBe("55.00");
  });
  it("applies rollover carry (positive or negative) only to rollover lines", () => {
    const r = evaluateBudget({ lines: [{ categoryId: "a", amount: 100, rollover: true }, { categoryId: "b", amount: 100 }], actualByLine: new Map([["a", D(150)], ["b", D(50)]]), carryByLine: new Map([["a", D(75)], ["b", D(75)]]), unbudgetedActual: 0, from: "2026-03-01", to: "2026-03-31", today: "2026-04-05" });
    expect(r.lines[0].available.toFixed(2)).toBe("175.00");
    expect(r.lines[0].remaining.toFixed(2)).toBe("25.00");
    expect(r.lines[1].available.toFixed(2)).toBe("100.00");
  });
  it("forecasts spending at the current pace", () => {
    expect(paceForecast(310, "2026-03-01", "2026-03-31", "2026-03-10").toFixed(2)).toBe("961.00");
    expect(paceForecast(310, "2026-03-01", "2026-03-31", "2026-04-01").toFixed(2)).toBe("310.00");
  });
  it("derives period bounds", () => {
    expect(periodBoundsFor("MONTHLY", "2028-02-10")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
    expect(periodBoundsFor("WEEKLY", "2026-03-04")).toEqual({ from: "2026-03-02", to: "2026-03-08" });
    expect(periodBoundsFor("ANNUAL", "2026-06-01")).toEqual({ from: "2026-01-01", to: "2026-12-31" });
    expect(nextPeriod("MONTHLY", "2026-01-01", "2026-01-31")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(previousPeriodOf("MONTHLY", "2026-03-01", "2026-03-31")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(nextPeriod("CUSTOM", "2026-01-01", "2026-01-10")).toEqual({ from: "2026-01-11", to: "2026-01-20" });
  });
});

describe("savings goals", () => {
  it("calculates remaining, percent, required monthly and estimated completion", () => {
    const g = projectGoal({ target: 10000, current: 2500, monthly: 500, targetDate: "2027-01-01", today: "2026-01-01" });
    expect(g.remaining.toFixed(2)).toBe("7500.00");
    expect(g.percentComplete.toFixed(2)).toBe("25.00");
    expect(g.requiredMonthly!.toFixed(2)).toBe("625.00");
    expect(g.estimatedCompletion).toBe("2027-04-01");
    expect(g.status).toBe("BEHIND");
    expect(g.shortfallMonthly!.toFixed(2)).toBe("125.00");
  });
  it("increasing the contribution moves the date earlier and flips status", () => {
    const a = projectGoal({ target: 10000, current: 2500, monthly: 500, targetDate: "2027-01-01", today: "2026-01-01" });
    const b = projectGoal({ target: 10000, current: 2500, monthly: 700, targetDate: "2027-01-01", today: "2026-01-01" });
    expect(b.estimatedCompletion! < a.estimatedCompletion!).toBe(true);
    expect(b.status).toBe("ON_TRACK");
  });
  it("handles completed, no plan, past deadline and zero target", () => {
    expect(projectGoal({ target: 1000, current: 1200, monthly: 0, today: "2026-01-01" }).status).toBe("COMPLETED");
    expect(projectGoal({ target: 1000, current: 100, monthly: 0, targetDate: "2027-01-01", today: "2026-01-01" }).status).toBe("NO_PLAN");
    const late = projectGoal({ target: 1000, current: 100, monthly: 50, targetDate: "2025-12-01", today: "2026-01-01" });
    expect(late.requiredMonthly!.toFixed(2)).toBe("900.00");
    expect(late.status).toBe("BEHIND");
    expect(projectGoal({ target: 0, current: 0, monthly: 0, today: "2026-01-01" }).percentComplete.isZero()).toBe(true);
  });
  it("tracks debt payoff goals by amount repaid", () => {
    const g = projectDebtGoal({ startingBalance: 10000, outstanding: 7000, monthlyPayment: 300, targetDate: "2027-01-01", today: "2026-01-01" });
    expect(g.current.toFixed(2)).toBe("3000.00");
    expect(g.percentComplete.toFixed(2)).toBe("30.00");
  });
});

describe("emergency fund", () => {
  it("plans targets, coverage and required contributions", () => {
    const p = planEmergencyFund({ essentialMonthly: 4000, currentSavings: 10000, targetMonths: [3, 6], planMonths: 10 });
    expect(p.coverageMonths!.toFixed(2)).toBe("2.50");
    expect(p.targets[0].amount.toFixed(2)).toBe("12000.00");
    expect(p.targets[0].remaining.toFixed(2)).toBe("2000.00");
    expect(p.targets[1].requiredMonthly!.toFixed(2)).toBe("1400.00");
    expect(planEmergencyFund({ essentialMonthly: 0, currentSavings: 1, targetMonths: [3] }).coverageMonths).toBeNull();
  });
  it("income loss runway", () => {
    const r = incomeLossRunway({ essentialMonthly: 4000, remainingIncomeMonthly: 2500, availableSavings: 9000 });
    expect(r.monthlyShortfall.toFixed(2)).toBe("1500.00");
    expect(r.runwayMonths!.toFixed(1)).toBe("6.0");
    expect(incomeLossRunway({ essentialMonthly: 2000, remainingIncomeMonthly: 2500, availableSavings: 100 }).coversEssentials).toBe(true);
  });
});

describe("net worth", () => {
  const accounts: (LedgerAccount & { name: string; valuations?: { date: string; value: string }[] })[] = [
    { id: "chq", name: "Chequing", type: "CHEQUING", currency: "CAD", openingBalance: "2000.00", openingDate: "2026-01-01" },
    { id: "sav", name: "Savings", type: "SAVINGS", currency: "CAD", openingBalance: "10000.00", openingDate: "2026-01-01" },
    { id: "cc", name: "Visa", type: "CREDIT_CARD", currency: "CAD", openingBalance: "-1500.00", openingDate: "2026-01-01" },
    { id: "mtg", name: "Mortgage", type: "MORTGAGE", currency: "CAD", openingBalance: "-300000.00", openingDate: "2026-01-01" },
    { id: "rrsp", name: "RRSP", type: "INVESTMENT", currency: "CAD", openingBalance: "20000.00", openingDate: "2026-01-01", valuations: [{ date: "2026-01-31", value: "21000.00" }, { date: "2026-03-31", value: "23500.00" }] },
  ];
  const assets = [{ id: "home", name: "Home", kind: "PROPERTY", currency: "CAD", currentValue: "450000.00", valuationDate: "2026-02-01", valuations: [{ date: "2026-02-01", value: "450000.00" }, { date: "2026-03-15", value: "455000.00" }] }, { id: "car", name: "Car", kind: "VEHICLE", currency: "CAD", currentValue: "18000.00", valuationDate: "2026-02-01" }];
  const txs: LedgerTx[] = [
    { id: "1", accountId: "chq", type: "INCOME", amount: "3000.00", currency: "CAD", date: "2026-02-10" },
    { id: "2", accountId: "cc", type: "EXPENSE", amount: "-400.00", currency: "CAD", date: "2026-02-12" },
    { id: "3", accountId: "chq", type: "TRANSFER", amount: "-400.00", currency: "CAD", date: "2026-02-20", transferGroupId: "g" },
    { id: "4", accountId: "cc", type: "TRANSFER", amount: "400.00", currency: "CAD", date: "2026-02-20", transferGroupId: "g" },
  ];
  it("assets minus liabilities, each item counted once, investments use their valuation not the ledger", () => {
    const nw = computeNetWorth({ accounts, txs, assets, baseCurrency: "CAD", fx: noFx(), asOf: "2026-04-01" });
    // assets: chq 4600 + sav 10000 + rrsp valuation 23500 + home 455000 + car 18000
    expect(nw.assets.toFixed(2)).toBe("511100.00");
    // liabilities: card 1500 (the 400 purchase and the 400 payment cancel) + mortgage 300000
    expect(nw.liabilities.toFixed(2)).toBe("301500.00");
    expect(nw.netWorth.toFixed(2)).toBe("209600.00");
    expect(nw.lines.filter((l) => l.id === "rrsp")).toHaveLength(1);
    expect(nw.lines.find((l) => l.id === "rrsp")!.source).toBe("valuation");
  });
  it("a credit card payment does not change net worth", () => {
    const before = computeNetWorth({ accounts, txs: txs.slice(0, 2), assets, baseCurrency: "CAD", fx: noFx(), asOf: "2026-04-01" });
    const after = computeNetWorth({ accounts, txs, assets, baseCurrency: "CAD", fx: noFx(), asOf: "2026-04-01" });
    expect(after.netWorth.eq(before.netWorth)).toBe(true);
  });
  it("overdrafts become liabilities and credit balances become assets", () => {
    const nw = computeNetWorth({ accounts: [{ id: "a", name: "Overdrawn", type: "CHEQUING", currency: "CAD", openingBalance: "-50.00", openingDate: "2026-01-01" }, { id: "b", name: "Card credit", type: "CREDIT_CARD", currency: "CAD", openingBalance: "20.00", openingDate: "2026-01-01" }], txs: [], assets: [], baseCurrency: "CAD", fx: noFx(), asOf: "2026-02-01" });
    expect(nw.liabilities.toFixed(2)).toBe("50.00");
    expect(nw.assets.toFixed(2)).toBe("20.00");
  });
  it("builds month-end history using valuations as of each date and compares periods", () => {
    const h = netWorthHistory({ accounts, txs, assets, baseCurrency: "CAD", fx: noFx(), endDate: "2026-04-01", months: 4 });
    expect(h.map((p) => p.month)).toEqual(["2026-01", "2026-02", "2026-03", "2026-04"]);
    // January: chequing 2000 + savings 10000 + RRSP valuation 21000 (no property valued yet) - card 1500 - mortgage 300000
    expect(h[0].netWorth.toFixed(2)).toBe("-268500.00");
    expect(h[3].changeFromPrevious!.eq(h[3].netWorth.minus(h[2].netWorth))).toBe(true);
    expect(compareNetWorth(h[3].netWorth, h[0].netWorth)!.change.eq(h[3].netWorth.minus(h[0].netWorth))).toBe(true);
    expect(compareNetWorth(10, null)).toBeNull();
  });
  it("converts foreign currency assets with a stored rate and reports unconvertible ones instead of guessing", () => {
    const usd = [{ id: "u", name: "US account", type: "SAVINGS", currency: "USD", openingBalance: "1000.00", openingDate: "2026-01-01" }];
    const missing = computeNetWorth({ accounts: usd, txs: [], assets: [], baseCurrency: "CAD", fx: noFx(), asOf: "2026-02-01" });
    expect(missing.assets.isZero()).toBe(true);
    expect(missing.unconverted).toEqual(["US account"]);
    const ok = computeNetWorth({ accounts: usd, txs: [], assets: [], baseCurrency: "CAD", fx: makeFx([{ base: "USD", quote: "CAD", rate: "1.35", asOf: "2026-01-15" }]), asOf: "2026-02-01" });
    expect(ok.assets.toFixed(2)).toBe("1350.00");
  });
});

const baseline = (over: Partial<Baseline> = {}): Baseline => ({
  asOf: "2026-01-31", currency: "CAD", liquid: 3000, savings: 5000, investments: 10000, otherAssets: 0, assets: [],
  incomes: [{ id: "i1", name: "Salary A", memberId: "A", net: 2500, frequency: "SEMI_MONTHLY", anchor: "2026-02-15" }, { id: "i2", name: "Salary B", memberId: "B", net: 2000, frequency: "MONTHLY", anchor: "2026-02-01" }],
  outflows: [{ id: "rent", name: "Rent", kind: "BILL", amount: 1800, frequency: "MONTHLY", anchor: "2026-02-01", essential: true }, { id: "net", name: "Internet", kind: "SUBSCRIPTION", amount: 80, frequency: "MONTHLY", anchor: "2026-02-10" }],
  debts: [{ id: "d1", name: "Car loan", balance: 6000, aprPercent: 6, compoundingPerYear: 12, payment: 300, frequency: "MONTHLY", nextDue: "2026-02-20" }],
  goals: [{ id: "g1", name: "Emergency", monthly: 400, remaining: null }],
  oneOffs: [], variableMonthly: 1000, irregularIncomeMonthly: 0,
  assumptions: { savingsInterestPct: 0, investmentReturnPct: 0, assetGrowthPct: 0, variableSpendingMonthsBasis: 3, notes: [] },
  ...over,
});

describe("forecast", () => {
  it("projects income, expenses, debt, savings and net worth month by month", () => {
    const f = runForecast(baseline(), { months: 3 });
    expect(f.months).toHaveLength(3);
    const feb = f.months[0];
    // income: 2 x 2500 + 2000 = 7000; expenses: 1800 + 80 + 1000 variable + interest 30 = 2910
    expect(feb.income.toFixed(2)).toBe("7000.00");
    expect(feb.interest.toFixed(2)).toBe("30.00");
    expect(feb.expenses.toFixed(2)).toBe("2910.00");
    expect(feb.netCashFlow.toFixed(2)).toBe("4090.00");
    expect(feb.debtPrincipalPaid.toFixed(2)).toBe("270.00");
    expect(feb.savingsContributions.toFixed(2)).toBe("400.00");
    // cash: 3000 + 4090 - 270 - 400
    expect(feb.endLiquid.toFixed(2)).toBe("6420.00");
    expect(feb.endSavings.toFixed(2)).toBe("5400.00");
    expect(feb.endDebt.toFixed(2)).toBe("5730.00");
    expect(f.end.netWorth.minus(f.start.netWorth).toFixed(2)).toBe(f.totals.netCashFlow.toFixed(2)); // transfers move value, income minus expenses changes net worth
    expect(f.assumptions.length).toBeGreaterThan(5);
    expect(f.assumptions.join(" ")).toMatch(/not a guaranteed outcome/);
  });
  it("irregular income only enters through the trailing average, and is clearly listed", () => {
    const f = runForecast(baseline({ incomes: [], irregularIncomeMonthly: 600, variableMonthly: 0, outflows: [], debts: [], goals: [] }), { months: 2 });
    expect(f.totals.income.toFixed(2)).toBe("1200.00");
    expect(f.assumptions.join(" ")).toMatch(/Irregular income/);
  });
  it("flags a projected shortfall and the lowest balance", () => {
    const f = runForecast(baseline({ liquid: 500, incomes: [], goals: [] }), { months: 2 });
    expect(f.firstShortfallDate).not.toBeNull();
    expect(f.warnings[0]).toMatch(/falls below zero/);
    expect(f.lowestLiquid.amount.isNegative()).toBe(true);
  });
  it("supports 30 and 90 day horizons with partial months", () => {
    const f = runForecast(baseline(), { days: 30 });
    expect(f.to).toBe("2026-03-02");
    expect(f.daily).toHaveLength(30);
    expect(f.months[f.months.length - 1].partial).toBe(true);
  });
  it("stops contributions at the goal target and finds the debt free date", () => {
    const f = runForecast(baseline({ goals: [{ id: "g1", name: "x", monthly: 400, remaining: 600 }], debts: [{ id: "d1", name: "Loan", balance: 500, aprPercent: 0, compoundingPerYear: 12, payment: 300, frequency: "MONTHLY", nextDue: "2026-02-20" }] }), { months: 6 });
    expect(f.totals.savingsContributions.toFixed(2)).toBe("600.00");
    expect(f.debtFreeDate).toBe("2026-03-20");
  });
  it("applies growth assumptions only when the user sets them", () => {
    const flat = runForecast(baseline(), { months: 12 });
    const grow = runForecast(baseline({ assumptions: { savingsInterestPct: 0, investmentReturnPct: 6, assetGrowthPct: 0, variableSpendingMonthsBasis: 3, notes: [] } }), { months: 12 });
    expect(flat.months[11].endInvestments.toFixed(2)).toBe("10000.00");
    expect(grow.months[11].endInvestments.gt(10500)).toBe(true);
  });
  it("warns when a debt payment cannot cover interest", () => {
    const f = runForecast(baseline({ debts: [{ id: "d", name: "Card", balance: 20000, aprPercent: 24, compoundingPerYear: 12, payment: 100, frequency: "MONTHLY", nextDue: "2026-02-10" }] }), { months: 3 });
    expect(f.warnings.join(" ")).toMatch(/does not cover its interest/);
  });
});

describe("what-if scenarios", () => {
  const b = baseline();
  it("never mutates the baseline or the real data it was built from", () => {
    const frozen = JSON.stringify(b, (_k, v) => (typeof v === "object" && v && "toFixed" in v ? v.toString() : v));
    runScenario(b, [{ type: "JOB_LOSS", target: { memberId: "B" } }, { type: "ONE_TIME_EXPENSE", amount: 5000, month: 2 }, { type: "HOME_PURCHASE", price: 500000, downPayment: 100000, aprPercent: 5, amortisationYears: 25 }], { months: 12 });
    expect(JSON.stringify(b, (_k, v) => (typeof v === "object" && v && "toFixed" in v ? v.toString() : v))).toBe(frozen);
  });
  it("job loss reduces income and net worth; difference is reported against the current position", () => {
    const r = runScenario(b, [{ type: "JOB_LOSS", target: { memberId: "B" } }], { months: 6 });
    expect(r.simulated.totals.income.lt(r.current.totals.income)).toBe(true);
    expect(r.current.totals.income.minus(r.simulated.totals.income).toFixed(2)).toBe("12000.00");
    expect(r.difference.netWorth.toFixed(2)).toBe("-12000.00");
    expect(r.difference.monthlyCashFlow.toFixed(2)).toBe("-2000.00");
  });
  it("a limited job loss stops income only for the chosen months", () => {
    const r = runScenario(b, [{ type: "JOB_LOSS", target: { incomeId: "i2" }, startMonth: 0, durationMonths: 2 }], { months: 6 });
    expect(r.current.totals.income.minus(r.simulated.totals.income).toFixed(2)).toBe("4000.00");
  });
  it("a raise, a bonus and extra income each increase income", () => {
    expect(runScenario(b, [{ type: "INCOME_CHANGE", target: { memberId: "A" }, mode: "PCT", value: 10 }], { months: 3 }).difference.netWorth.toFixed(2)).toBe("1500.00");
    expect(runScenario(b, [{ type: "BONUS", amount: 3000, month: 1 }], { months: 3 }).difference.netWorth.toFixed(2)).toBe("3000.00");
    expect(runScenario(b, [{ type: "ADD_INCOME", monthlyAmount: 500, startMonth: 0 }], { months: 3 }).difference.netWorth.toFixed(2)).toBe("1500.00");
  });
  it("reducing discretionary spending by a fixed amount saves exactly that amount", () => {
    const r = runScenario(b, [{ type: "REDUCE_DISCRETIONARY", mode: "AMOUNT", value: 150, startMonth: 0 }], { months: 12 });
    expect(r.difference.netWorth.toFixed(0)).toBe("1800");
  });
  it("rent increase and a one-time expense reduce net worth by the right amounts", () => {
    const r = runScenario(b, [{ type: "EXPENSE_CHANGE", target: { outflowId: "rent" }, mode: "AMOUNT", value: 200 }], { months: 6 });
    expect(r.difference.netWorth.toFixed(2)).toBe("-1200.00");
    expect(runScenario(b, [{ type: "ONE_TIME_EXPENSE", amount: 4000, month: 1 }], { months: 6 }).difference.netWorth.toFixed(2)).toBe("-4000.00");
  });
  it("extra debt payments cut debt and interest; savings changes move cash into savings without changing net worth", () => {
    const r = runScenario(b, [{ type: "EXTRA_DEBT_PAYMENT", debtId: "d1", extraMonthly: 400 }], { months: 12 });
    expect(r.difference.debt.isNegative()).toBe(true);
    expect(r.difference.interest.isNegative()).toBe(true);
    const s = runScenario(b, [{ type: "SAVINGS_CHANGE", goalId: "g1", extraMonthly: 300 }], { months: 6 });
    expect(s.difference.savings.toFixed(2)).toBe("1800.00");
    expect(s.difference.netWorth.toFixed(2)).toBe("0.00");
  });
  it("paying off a debt in full turns cash into lower debt, with only interest saved", () => {
    const r = runScenario(b, [{ type: "DEBT_PAYOFF", debtId: "d1", month: 1, fundFromSavingsFirst: false }], { months: 6 });
    expect(r.simulated.end.debt.isZero()).toBe(true);
    expect(r.difference.netWorth.gt(0)).toBe(true);
  });
  it("a home purchase creates a mortgage, an asset and new housing costs", () => {
    const r = runScenario(b, [{ type: "HOME_PURCHASE", price: 500000, downPayment: 100000, aprPercent: 5, amortisationYears: 25, propertyTaxAnnual: 3600, month: 1 }], { months: 12 });
    expect(r.simulated.end.debt.gt(r.current.end.debt.plus(350000))).toBe(true);
    expect(r.notes[0]).toMatch(/Buy a home/);
    expect(r.simulated.months[11].endOtherAssets.gte(500000)).toBe(true);
  });
  it("applyAssumptions returns plain language notes and leaves its input untouched", () => {
    const { notes } = applyAssumptions(b, [{ type: "REDUCE_DISCRETIONARY", mode: "PCT", value: 20 }]);
    expect(notes[0]).toMatch(/20%/);
    expect(b.variableMods).toBeUndefined();
  });
});

import { analyseContributions } from "@/server/finance/engine/contribution";
import { apportion, resolveAllocations, splitByPercent, splitByAmount, AllocationError } from "@/server/finance/engine/allocation";
import { D as Dd } from "@/server/finance/engine/decimal";

describe("allocation engine", () => {
  it("apportions cents exactly (largest remainder) so nothing is lost or invented", () => {
    const parts = apportion("100.00", [1, 1, 1]);
    expect(parts.map((p) => p.toFixed(2))).toEqual(["33.34", "33.33", "33.33"]);
    expect(parts.reduce((a, b) => a.plus(b), Dd(0)).toFixed(2)).toBe("100.00");
    expect(apportion("0.01", [1, 1]).reduce((a, b) => a.plus(b), Dd(0)).toFixed(2)).toBe("0.01");
    expect(apportion("-50.00", [3, 1]).map((p) => p.toFixed(2))).toEqual(["-37.50", "-12.50"]);
  });
  it("percent splits must total 100 and amount splits must total the expense", () => {
    expect(() => splitByPercent(500, [{ memberId: "a", percent: 60 }, { memberId: "b", percent: 30 }])).toThrow(AllocationError);
    expect(splitByPercent(500, [{ memberId: "a", percent: "62.5" }, { memberId: "b", percent: "37.5" }]).map((x) => x.amount.toFixed(2))).toEqual(["312.50", "187.50"]);
    expect(() => splitByAmount(500, [{ memberId: "a", amount: 300 }, { memberId: "b", amount: 100 }])).toThrow(AllocationError);
    expect(splitByAmount(500, [{ memberId: "a", amount: 300 }, { memberId: null, amount: 200 }]).length).toBe(2);
  });
  it("resolves owner, member, household and split modes", () => {
    expect(resolveAllocations({ amount: 90, mode: "OWNER", ownerId: "a" })).toMatchObject([{ memberId: "a" }]);
    expect(resolveAllocations({ amount: 90, mode: "HOUSEHOLD", ownerId: "a" })[0].memberId).toBeNull();
    expect(resolveAllocations({ amount: 90, mode: "MEMBER", ownerId: "a", allocatedMemberId: "b" })[0].memberId).toBe("b");
    expect(() => resolveAllocations({ amount: 90, mode: "SPLIT", ownerId: "a", splits: [{ memberId: "a" }] })).toThrow();
    expect(() => resolveAllocations({ amount: 90, mode: "SPLIT", ownerId: "a", splits: [{ memberId: "a", percent: 50 }, { memberId: "b", amount: 45 }] })).toThrow();
  });
});

describe("contribution analysis", () => {
  const members = [{ id: "d", name: "David" }, { id: "s", name: "Sharon" }];
  const exp = (id: string, amount: number, payerId: string | null, alloc: { memberId: string | null; amount: number }[]) => ({ id, amount, payerId, allocations: alloc.map((a) => ({ memberId: a.memberId, amount: Dd(a.amount) })) });
  it("separates who paid from who it is allocated to; positions net to zero", () => {
    const r = analyseContributions({ members, months: 1, settlements: [], arrangement: { kind: "SHARED_EQUAL", participants: ["d", "s"] }, expenses: [exp("1", 2000, "d", [{ memberId: null, amount: 2000 }]), exp("2", 120, "s", [{ memberId: "s", amount: 120 }]), exp("3", 500, "s", [{ memberId: null, amount: 500 }])] });
    expect(r.pool.toFixed(2)).toBe("2500.00");
    expect(r.members.reduce((a, m) => a.plus(m.netPosition), Dd(0)).toFixed(2)).toBe("0.00");
    const d = r.members[0], s = r.members[1];
    expect(d.netPosition.toFixed(2)).toBe("750.00"); // paid 2000, owes 1250
    expect(s.netPosition.toFixed(2)).toBe("-750.00"); // paid 620, owes 1250 + 120 personal = 1370
    expect(r.suggestedSettlements[0].amount.toFixed(2)).toBe("750.00");
  });
  it("costs paid from joint accounts do not create positions between members", () => {
    const r = analyseContributions({ members, months: 1, settlements: [], arrangement: { kind: "SHARED_EQUAL", participants: ["d", "s"] }, expenses: [exp("1", 1000, null, [{ memberId: null, amount: 1000 }])] });
    expect(r.paidFromJointAccounts.toFixed(2)).toBe("1000.00");
    expect(r.members.every((m) => m.netPosition.isZero())).toBe(true);
    expect(r.notes.join(" ")).toMatch(/joint accounts/);
  });
  it("settlements clear positions and are not expenses", () => {
    const r = analyseContributions({ members, months: 1, settlements: [{ fromMemberId: "s", toMemberId: "d", amount: 250 }], arrangement: { kind: "SHARED_EQUAL", participants: ["d", "s"] }, expenses: [exp("1", 500, "d", [{ memberId: null, amount: 500 }])] });
    expect(r.members.every((m) => m.netPosition.isZero())).toBe(true);
    expect(r.total.toFixed(2)).toBe("500.00");
  });
  it("income based, fixed and custom arrangements", () => {
    const base = { members, months: 1, settlements: [], expenses: [exp("1", 1000, "d", [{ memberId: null, amount: 1000 }])] };
    const inc = analyseContributions({ ...base, netMonthly: { d: 6000, s: 4000 }, arrangement: { kind: "INCOME_BASED", participants: ["d", "s"], percentOfNet: 40 } });
    expect(inc.members.map((m) => m.shareOfPool.toFixed(2))).toEqual(["600.00", "400.00"]);
    expect(inc.members[0].target!.toFixed(2)).toBe("2400.00");
    const fixed = analyseContributions({ ...base, arrangement: { kind: "FIXED", participants: ["d", "s"], fixedMonthly: { d: 700, s: 300 } } });
    expect(fixed.members[0].target!.toFixed(2)).toBe("700.00");
    const custom = analyseContributions({ ...base, arrangement: { kind: "CUSTOM", participants: ["d", "s"], customShares: { d: 25, s: 75 } } });
    expect(custom.members.map((m) => m.shareOfPool.toFixed(2))).toEqual(["250.00", "750.00"]);
    const indep = analyseContributions({ ...base, arrangement: { kind: "INDEPENDENT", participants: ["d", "s"] } });
    expect(indep.members.every((m) => m.netPosition.isZero())).toBe(true);
    const missing = analyseContributions({ ...base, netMonthly: { d: 6000, s: null }, arrangement: { kind: "INCOME_BASED", participants: ["d", "s"] } });
    expect(missing.members.map((m) => m.shareOfPool.toFixed(2))).toEqual(["500.00", "500.00"]);
    expect(missing.notes.join(" ")).toMatch(/split equally/);
  });
});
