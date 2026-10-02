// Home affordability and mortgage planning. Estimates only: this is not a lender approval.
import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { D, money, ZERO, type Dec } from "./engine/decimal";
import { CANADA_MORTGAGE_RULES, debtServiceRatios, maxAffordablePrice, planMortgage, qualifyingRate, type MortgageResult } from "./engine/mortgage";
import { projectGoal } from "./engine/savings";
import { addMonths } from "./engine/dates";
import { text } from "./common";
import { requireWriter, type FinCtx } from "./access";
import { incomeSummary } from "./income";
import { listDebts } from "./debts";
import { listAccounts } from "./accounts";

const n = z.union([z.string(), z.number()]);
export const mortgageSchema = z.object({
  price: n, downPayment: n, aprPercent: n, amortisationYears: z.number().int().min(1).max(40).default(25), termYears: z.number().int().min(1).max(10).default(5), frequency: z.enum(["MONTHLY", "SEMI_MONTHLY", "BIWEEKLY", "WEEKLY"]).default("MONTHLY"), accelerated: z.boolean().default(false),
  propertyTaxAnnual: n.default(0), insuranceAnnual: n.default(0), heatingMonthly: n.default(0), condoFeesMonthly: n.default(0), closingCostsPct: n.default(1.5), closingCostsOverride: n.nullish(), cashAvailable: n.nullish(),
  grossAnnualIncome: n.optional(), otherDebtMonthly: n.optional(), compoundingPerYear: z.number().int().min(1).max(12).optional(),
});
export const mortgageCompareSchema = z.object({ scenarios: z.array(z.object({ name: text(60), input: mortgageSchema })).min(1).max(6) });

function wireMortgage(r: MortgageResult, ratios: ReturnType<typeof debtServiceRatios> | null, stress: { monthly: Dec; rate: Dec } | null) {
  const m = (d: Dec) => money(d);
  return {
    price: m(r.price), downPayment: m(r.downPayment), downPaymentPercent: r.downPaymentPct.toString(), minimumDownPayment: m(r.minimumDownPayment), meetsMinimumDownPayment: r.meetsMinimumDownPayment, insuranceRequired: r.insuranceRequired, insurable: r.insurable, insurancePremium: m(r.insurancePremium),
    mortgagePrincipal: m(r.principal), basePrincipal: m(r.basePrincipal), payment: m(r.payment), paymentsPerYear: r.paymentsPerYear, monthlyEquivalent: m(r.monthlyEquivalent), housingCostMonthly: m(r.housingCostMonthly), closingCosts: m(r.closingCosts), cashRequired: m(r.cashRequired), cashRemaining: r.cashRemaining ? m(r.cashRemaining) : null,
    totalInterestOverAmortisation: m(r.totalInterestOverAmortisation), totalInterestOverTerm: m(r.totalInterestOverTerm), balanceAtEndOfTerm: m(r.balanceAtEndOfTerm), yearly: r.yearly.map((y) => ({ year: y.year, opening: m(y.openingBalance), principalPaid: m(y.principalPaid), interestPaid: m(y.interestPaid), closing: m(y.closingBalance) })), warnings: r.warnings,
    ratios: ratios ? { gds: ratios.gds?.toString() ?? null, tds: ratios.tds?.toString() ?? null, gdsLimit: ratios.gdsLimit, tdsLimit: ratios.tdsLimit, withinLimits: ratios.withinLimits } : null, stressTest: stress ? { qualifyingRatePercent: stress.rate.toString(), qualifyingMonthlyPayment: m(stress.monthly) } : null,
  };
}
export function mortgageCalc(i: z.infer<typeof mortgageSchema>) {
  const rules = { ...CANADA_MORTGAGE_RULES, ...(i.compoundingPerYear ? { compoundingPerYear: i.compoundingPerYear } : {}) };
  const base = { price: i.price, downPayment: i.downPayment, aprPercent: i.aprPercent, amortisationYears: i.amortisationYears, termYears: i.termYears, frequency: i.frequency, accelerated: i.accelerated, propertyTaxAnnual: i.propertyTaxAnnual, insuranceAnnual: i.insuranceAnnual, heatingMonthly: i.heatingMonthly, condoFeesMonthly: i.condoFeesMonthly, closingCostsPct: i.closingCostsPct, closingCostsOverride: i.closingCostsOverride ?? undefined, cashAvailable: i.cashAvailable ?? undefined, rules };
  const r = planMortgage(base);
  let ratios = null, stress = null;
  if (i.grossAnnualIncome !== undefined && D(i.grossAnnualIncome).gt(0)) {
    const q = qualifyingRate(i.aprPercent, rules);
    const s = planMortgage({ ...base, aprPercent: q, frequency: "MONTHLY", accelerated: false });
    stress = { monthly: s.monthlyEquivalent, rate: q };
    ratios = debtServiceRatios({ grossAnnualIncome: i.grossAnnualIncome, mortgageMonthly: s.monthlyEquivalent, propertyTaxAnnual: i.propertyTaxAnnual, heatingMonthly: i.heatingMonthly, condoFeesMonthly: i.condoFeesMonthly, otherDebtMonthly: i.otherDebtMonthly, rules });
  }
  return { ...wireMortgage(r, ratios, stress), disclaimer: "An estimate for planning. It is not a mortgage approval or a lender affordability assessment. Lenders apply their own rules, rates, fees and credit checks.", assumptions: ["Canadian fixed rate mortgages are assumed to compound semi-annually unless you change the compounding.", "Closing costs use the percentage you enter because land transfer tax and legal fees vary by province.", `Mortgage insurance premiums, minimum down payments and debt service limits follow configurable defaults (GDS ${CANADA_MORTGAGE_RULES.maxGds}%, TDS ${CANADA_MORTGAGE_RULES.maxTds}%) and may differ from a lender's.`, "The stress test uses the higher of the contract rate plus two percentage points and 5.25 percent."] };
}
export function mortgageCompare(input: z.infer<typeof mortgageCompareSchema>) {
  return input.scenarios.map((s) => ({ name: s.name, result: mortgageCalc(s.input) }));
}

export const affordabilitySchema = z.object({ grossAnnualIncome: n, downPayment: n, aprPercent: n, amortisationYears: z.number().int().min(5).max(40).default(25), propertyTaxAnnual: n.default(0), heatingMonthly: n.default(0), condoFeesMonthly: n.default(0), otherDebtMonthly: n.default(0), insuranceAnnual: n.default(0) });
export function affordability(i: z.infer<typeof affordabilitySchema>) {
  const r = maxAffordablePrice({ downPayment: i.downPayment, aprPercent: i.aprPercent, amortisationYears: i.amortisationYears, propertyTaxAnnual: i.propertyTaxAnnual, heatingMonthly: i.heatingMonthly, condoFeesMonthly: i.condoFeesMonthly, otherDebtMonthly: i.otherDebtMonthly, insuranceAnnual: i.insuranceAnnual, grossAnnualIncome: i.grossAnnualIncome });
  return { maxPrice: money(r.price), qualifyingRatePercent: r.qualifyingRatePercent.toString(), ratios: r.ratios.gds ? { gds: r.ratios.gds.toString(), tds: r.ratios.tds?.toString() ?? null, withinLimits: r.ratios.withinLimits } : null, estimate: wireMortgage(r.result, null, null), disclaimer: "An estimate of the price that fits common debt service limits at the stress test rate. A lender decides what you can actually borrow." };
}

export const downPaymentSchema = z.object({ price: n, targetPercent: n.default(20), currentSavings: n, monthlySaving: n, targetDate: z.string().optional() });
export function downPaymentPlan(i: z.infer<typeof downPaymentSchema>, today: string) {
  const target = D(i.price).times(D(i.targetPercent)).div(100);
  const p = projectGoal({ target, current: i.currentSavings, monthly: i.monthlySaving, targetDate: i.targetDate ?? null, today });
  return { targetDownPayment: money(target), currentSavings: money(i.currentSavings), remaining: money(p.remaining), percentComplete: p.percentComplete.toString(), requiredMonthly: p.requiredMonthly ? money(p.requiredMonthly) : null, estimatedDate: p.estimatedCompletion, status: p.status, minimumForPrice: money(CANADA_MORTGAGE_RULES.downPaymentBands.length ? D(minimumFor(i.price)) : ZERO) };
}
import { minimumDownPayment } from "./engine/mortgage";
const minimumFor = (price: string | number) => minimumDownPayment(price).toString();

/** Values used to prefill the planner from the household's real, permitted records. */
export async function plannerDefaults(ctx: FinCtx, view: "my" | "household") {
  const [inc, debts, accts] = await Promise.all([incomeSummary(ctx, view), listDebts(ctx, view), listAccounts(ctx, view)]);
  const nonMortgage = debts.items.filter((d) => d.active && d.type !== "MORTGAGE").reduce((a, d) => a.plus(D(d.monthlyPayment)), ZERO);
  const cash = accts.items.filter((a) => (a.isLiquid || a.type === "SAVINGS" || a.type === "HIGH_INTEREST_SAVINGS") && !a.isLiability && a.status === "ACTIVE").reduce((a, x) => a.plus(D(x.currentBalance)), ZERO);
  return { view, currency: ctx.base, grossAnnualIncome: inc.combinedAnnualGross, monthlyDebtPayments: money(nonMortgage), availableCash: money(cash), note: "Prefilled from records visible in this view. Change any value to explore." };
}

export const savedMortgageSchema = z.object({ name: text(80), input: mortgageSchema });
export async function listMortgageScenarios(ctx: FinCtx) {
  const rows = await db.finScenario.findMany({ where: { householdId: ctx.householdId, createdById: ctx.actor.id, kind: "MORTGAGE" }, orderBy: { updatedAt: "desc" } });
  return rows.map((r) => ({ id: r.id, name: r.name, input: r.assumptions }));
}
export async function saveMortgageScenario(ctx: FinCtx, input: z.infer<typeof savedMortgageSchema>) {
  requireWriter(ctx);
  const r = await db.finScenario.create({ data: { householdId: ctx.householdId, createdById: ctx.actor.id, kind: "MORTGAGE", name: input.name, assumptions: input.input as never } });
  return { id: r.id };
}
export async function deleteMortgageScenario(ctx: FinCtx, sid: string) {
  const r = await db.finScenario.findFirst({ where: { id: sid, householdId: ctx.householdId, createdById: ctx.actor.id, kind: "MORTGAGE" } });
  if (!r) throw new AppError("NOT_FOUND", "Scenario not found");
  await db.finScenario.delete({ where: { id: r.id } });
  return { ok: true };
}
export { addMonths };
