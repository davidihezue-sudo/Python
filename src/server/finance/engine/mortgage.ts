// Home affordability and mortgage planning. Defaults reflect Canadian rules as understood at the time of writing and are
// configurable inputs: they are estimates for planning, not a lender approval.
import { D, Dec, ZERO, ONE, sum, type Dec as DecT, type DecLike } from "./decimal";
import { amortise, levelPayment, periodicRate } from "./debt";
import { PER_YEAR, type Frequency } from "./frequency";

const R2 = (v: DecLike) => D(v).toDecimalPlaces(2, Dec.ROUND_HALF_UP);

export interface MortgageRules {
  /** Compounding periods per year for the quoted rate (Canada: 2 for fixed mortgages). */
  compoundingPerYear: number;
  /** Minimum down payment bands: percentage of the price up to `upTo`, then the next band. */
  downPaymentBands: { upTo: number | null; pct: number }[];
  /** Above this price a 20 percent minimum down payment applies and insurance is unavailable. */
  insuredPriceLimit: number;
  /** Default mortgage insurance premium by loan to value ceiling (percent of the base loan). */
  insurancePremiums: { ltvUpTo: number; pct: number }[];
  extendedAmortisationSurcharge: number; // percent, added for amortisations longer than 25 years
  stressTestFloor: number; // percent
  stressTestBuffer: number; // percent added to the contract rate
  maxGds: number; // percent
  maxTds: number; // percent
}

export const CANADA_MORTGAGE_RULES: MortgageRules = {
  compoundingPerYear: 2,
  downPaymentBands: [
    { upTo: 500_000, pct: 5 },
    { upTo: 1_500_000, pct: 10 },
    { upTo: null, pct: 20 },
  ],
  insuredPriceLimit: 1_500_000,
  insurancePremiums: [
    { ltvUpTo: 65, pct: 0.6 },
    { ltvUpTo: 75, pct: 1.7 },
    { ltvUpTo: 80, pct: 2.4 },
    { ltvUpTo: 85, pct: 2.8 },
    { ltvUpTo: 90, pct: 3.1 },
    { ltvUpTo: 95, pct: 4.0 },
  ],
  extendedAmortisationSurcharge: 0.2,
  stressTestFloor: 5.25,
  stressTestBuffer: 2,
  maxGds: 39,
  maxTds: 44,
};

/** Minimum down payment for a price under banded rules (e.g. 5 percent of the first 500k plus 10 percent of the rest). */
export function minimumDownPayment(price: DecLike, rules: MortgageRules = CANADA_MORTGAGE_RULES): DecT {
  const p = D(price);
  if (p.gte(rules.insuredPriceLimit)) return p.times(0.2);
  let remaining = p,
    prev = ZERO,
    total = ZERO;
  for (const band of rules.downPaymentBands) {
    const ceiling = band.upTo === null ? p : Dec.min(p, band.upTo);
    const slice = Dec.max(ceiling.minus(prev), ZERO);
    total = total.plus(slice.times(band.pct).div(100));
    prev = ceiling;
    remaining = p.minus(ceiling);
    if (remaining.lte(0)) break;
  }
  return R2(total);
}

export function insurancePremiumPct(ltvPercent: DecLike, amortisationYears: number, rules: MortgageRules = CANADA_MORTGAGE_RULES): DecT | null {
  const ltv = D(ltvPercent);
  if (ltv.lte(80)) return ZERO; // conventional mortgage, no mandatory insurance
  const band = rules.insurancePremiums.find((b) => ltv.lte(b.ltvUpTo));
  if (!band) return null; // above 95 percent LTV is not insurable
  return D(band.pct).plus(amortisationYears > 25 ? rules.extendedAmortisationSurcharge : 0);
}

export interface MortgageInput {
  price: DecLike;
  downPayment: DecLike;
  aprPercent: DecLike;
  amortisationYears: number;
  termYears?: number;
  frequency?: Frequency;
  /** "Accelerated" frequencies pay monthly/12*... : accelerated biweekly = monthly payment / 2, paid 26 times a year. */
  accelerated?: boolean;
  propertyTaxAnnual?: DecLike;
  insuranceAnnual?: DecLike; // home insurance
  heatingMonthly?: DecLike;
  condoFeesMonthly?: DecLike;
  closingCostsPct?: DecLike; // of the price; user supplied because land transfer tax varies by province
  closingCostsOverride?: DecLike;
  cashAvailable?: DecLike;
  insureIfRequired?: boolean;
  rules?: MortgageRules;
}
export interface YearBalance {
  year: number;
  openingBalance: DecT;
  principalPaid: DecT;
  interestPaid: DecT;
  closingBalance: DecT;
}
export interface MortgageResult {
  price: DecT;
  downPayment: DecT;
  downPaymentPct: DecT;
  minimumDownPayment: DecT;
  meetsMinimumDownPayment: boolean;
  insuranceRequired: boolean;
  insurable: boolean;
  insurancePremium: DecT;
  principal: DecT; // amount actually borrowed, including a capitalised insurance premium
  basePrincipal: DecT;
  payment: DecT; // per payment at the chosen frequency
  monthlyEquivalent: DecT;
  paymentsPerYear: number;
  housingCostMonthly: DecT; // mortgage + tax + heat + condo + insurance
  closingCosts: DecT;
  cashRequired: DecT;
  cashRemaining: DecT | null;
  totalInterestOverAmortisation: DecT;
  totalInterestOverTerm: DecT;
  balanceAtEndOfTerm: DecT;
  yearly: YearBalance[];
  warnings: string[];
}

export function planMortgage(i: MortgageInput): MortgageResult {
  const rules = i.rules ?? CANADA_MORTGAGE_RULES;
  const warnings: string[] = [];
  const price = D(i.price),
    down = D(i.downPayment);
  const basePrincipal = Dec.max(price.minus(down), ZERO);
  const downPct = price.isZero() ? ZERO : down.div(price).times(100);
  const minDown = minimumDownPayment(price, rules);
  const meetsMin = down.gte(minDown);
  if (!meetsMin) warnings.push(`The minimum down payment for this price is about ${R2(minDown).toFixed(2)} under the configured rules.`);
  const ltv = price.isZero() ? ZERO : basePrincipal.div(price).times(100);
  const premiumPct = down.lt(price) ? insurancePremiumPct(ltv, i.amortisationYears, rules) : ZERO;
  const insurable = premiumPct !== null && price.lte(rules.insuredPriceLimit);
  const insuranceRequired = ltv.gt(80);
  let premium = ZERO;
  if (insuranceRequired) {
    if (!insurable) warnings.push("This price and down payment combination cannot be insured under the configured rules. A larger down payment (at least 20 percent) would be needed.");
    else if (i.insureIfRequired !== false) premium = R2(basePrincipal.times(premiumPct as DecT).div(100));
  }
  if (insuranceRequired && i.amortisationYears > 30) warnings.push("Insured mortgages are limited to 30 year amortisations.");
  const principal = basePrincipal.plus(premium);

  const freq: Frequency = i.frequency ?? "MONTHLY";
  const ppy = PER_YEAR[freq] ?? 12;
  const rate = periodicRate(i.aprPercent, rules.compoundingPerYear, ppy);
  const n = Math.round(i.amortisationYears * ppy);
  let payment: DecT;
  if (i.accelerated && (freq === "BIWEEKLY" || freq === "WEEKLY")) {
    const monthlyRate = periodicRate(i.aprPercent, rules.compoundingPerYear, 12);
    const monthlyPay = levelPayment(principal, monthlyRate, Math.round(i.amortisationYears * 12));
    payment = R2(monthlyPay.div(freq === "BIWEEKLY" ? 2 : 4));
  } else payment = levelPayment(principal, rate, n);
  const monthlyEquivalent = payment.times(ppy).div(12);

  const sched = amortise({ balance: principal, aprPercent: i.aprPercent, compoundingPerYear: rules.compoundingPerYear, frequency: freq, payment, maxPeriods: n + 5 });
  const termPeriods = Math.round((i.termYears ?? 5) * ppy);
  const termRows = sched.rows.slice(0, termPeriods);
  const yearly: YearBalance[] = [];
  for (let y = 0; y * ppy < sched.rows.length; y++) {
    const rows = sched.rows.slice(y * ppy, (y + 1) * ppy);
    if (!rows.length) break;
    yearly.push({ year: y + 1, openingBalance: rows[0].opening, principalPaid: sum(rows.map((r) => r.principal)), interestPaid: sum(rows.map((r) => r.interest)), closingBalance: rows[rows.length - 1].closing });
  }

  const tax = D(i.propertyTaxAnnual).div(12),
    ins = D(i.insuranceAnnual).div(12);
  const housing = monthlyEquivalent.plus(tax).plus(ins).plus(D(i.heatingMonthly)).plus(D(i.condoFeesMonthly));
  const closing = i.closingCostsOverride !== undefined && i.closingCostsOverride !== null ? D(i.closingCostsOverride) : price.times(D(i.closingCostsPct ?? 1.5)).div(100);
  const cashRequired = down.plus(closing);
  const cashAvail = i.cashAvailable === undefined || i.cashAvailable === null ? null : D(i.cashAvailable);
  return {
    price,
    downPayment: down,
    downPaymentPct: downPct.toDecimalPlaces(2),
    minimumDownPayment: minDown,
    meetsMinimumDownPayment: meetsMin,
    insuranceRequired,
    insurable,
    insurancePremium: premium,
    principal,
    basePrincipal,
    payment,
    monthlyEquivalent: R2(monthlyEquivalent),
    paymentsPerYear: ppy,
    housingCostMonthly: R2(housing),
    closingCosts: R2(closing),
    cashRequired: R2(cashRequired),
    cashRemaining: cashAvail === null ? null : R2(cashAvail.minus(cashRequired)),
    totalInterestOverAmortisation: sched.totalInterest,
    totalInterestOverTerm: sum(termRows.map((r) => r.interest)),
    balanceAtEndOfTerm: termRows.length ? termRows[termRows.length - 1].closing : principal,
    yearly,
    warnings,
  };
}

export interface DebtServiceInput {
  grossAnnualIncome: DecLike;
  mortgageMonthly: DecLike; // evaluated at the qualifying (stress tested) rate by the caller when needed
  propertyTaxAnnual?: DecLike;
  heatingMonthly?: DecLike;
  condoFeesMonthly?: DecLike; // typically 50 percent counts for GDS
  otherDebtMonthly?: DecLike;
  rules?: MortgageRules;
}
export interface DebtServiceResult {
  gds: DecT | null;
  tds: DecT | null;
  gdsLimit: number;
  tdsLimit: number;
  withinLimits: boolean | null;
}
/** GDS = (mortgage + property tax + heat + 50 percent of condo fees) / gross monthly income. TDS adds all other debt payments. */
export function debtServiceRatios(i: DebtServiceInput): DebtServiceResult {
  const rules = i.rules ?? CANADA_MORTGAGE_RULES;
  const income = D(i.grossAnnualIncome).div(12);
  if (income.lte(0)) return { gds: null, tds: null, gdsLimit: rules.maxGds, tdsLimit: rules.maxTds, withinLimits: null };
  const housing = D(i.mortgageMonthly).plus(D(i.propertyTaxAnnual).div(12)).plus(D(i.heatingMonthly)).plus(D(i.condoFeesMonthly).div(2));
  const gds = housing.div(income).times(100).toDecimalPlaces(2);
  const tds = housing.plus(D(i.otherDebtMonthly)).div(income).times(100).toDecimalPlaces(2);
  return { gds, tds, gdsLimit: rules.maxGds, tdsLimit: rules.maxTds, withinLimits: gds.lte(rules.maxGds) && tds.lte(rules.maxTds) };
}

/** Qualifying rate used for the stress test: the higher of the contract rate plus the buffer and the floor. */
export function qualifyingRate(contractPercent: DecLike, rules: MortgageRules = CANADA_MORTGAGE_RULES): DecT {
  return Dec.max(D(contractPercent).plus(rules.stressTestBuffer), rules.stressTestFloor);
}

/** Largest price whose stress-tested ratios stay within the limits for the given down payment (binary search). */
export function maxAffordablePrice(i: Omit<MortgageInput, "price"> & { grossAnnualIncome: DecLike; otherDebtMonthly?: DecLike }): { price: DecT; result: MortgageResult; ratios: DebtServiceResult; qualifyingRatePercent: DecT } {
  const rules = i.rules ?? CANADA_MORTGAGE_RULES;
  const qRate = qualifyingRate(i.aprPercent, rules);
  const down = D(i.downPayment);
  let lo = down,
    hi = down.plus(D(i.grossAnnualIncome).times(12));
  const test = (price: DecT) => {
    const stress = planMortgage({ ...i, price, aprPercent: qRate, rules });
    const ratios = debtServiceRatios({ grossAnnualIncome: i.grossAnnualIncome, mortgageMonthly: stress.monthlyEquivalent, propertyTaxAnnual: i.propertyTaxAnnual, heatingMonthly: i.heatingMonthly, condoFeesMonthly: i.condoFeesMonthly, otherDebtMonthly: i.otherDebtMonthly, rules });
    return { ok: !!ratios.withinLimits && stress.meetsMinimumDownPayment, ratios };
  };
  for (let k = 0; k < 60; k++) {
    const mid = lo.plus(hi).div(2);
    if (test(mid).ok) lo = mid;
    else hi = mid;
  }
  const price = R2(lo.div(1000).floor().times(1000));
  const result = planMortgage({ ...i, price });
  return { price, result, ratios: test(price).ratios, qualifyingRatePercent: qRate };
}

export { Dec, ZERO, ONE };
