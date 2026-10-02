// Tax estimation. All rates, brackets and thresholds are DATA (TaxRuleSet rows), not code, so a jurisdiction or year can be
// updated without touching this module. Results are planning estimates and are never an official tax calculation.
import { D, Dec, ZERO, max0, sum, type Dec as DecT, type DecLike } from "./decimal";

export interface Bracket {
  upTo: number | null; // null = no upper limit
  rate: number; // percent
}
export interface IncomeTaxRules {
  name: string; // e.g. "Federal" or "Alberta"
  brackets: Bracket[];
  basicPersonalAmount: number;
  creditRate: number; // lowest bracket rate used for non-refundable credits (percent)
  donation?: { firstTier: number; firstTierRate: number; rate: number };
  medical?: { thresholdPct: number; thresholdMax: number };
}
export interface PayrollRules {
  cpp: { rate: number; exemption: number; maxPensionable: number; additionalRate?: number; additionalMax?: number };
  ei: { rate: number; maxInsurable: number };
}
export interface TaxRuleData {
  kind: "INCOME_TAX";
  currency: string;
  income: IncomeTaxRules;
  payroll?: PayrollRules; // federal rule sets only
  notes?: string[];
}

export interface TaxInputs {
  employmentIncome: DecLike;
  selfEmploymentIncome?: DecLike;
  otherIncome?: DecLike;
  rrspContributions?: DecLike;
  fhsaContributions?: DecLike;
  pensionContributions?: DecLike;
  employmentExpenses?: DecLike;
  otherDeductions?: DecLike;
  donations?: DecLike;
  medicalExpenses?: DecLike;
  tuition?: DecLike;
  taxDeducted: DecLike; // tax actually withheld at source (from pay stubs / slips)
}
export interface TaxEstimate {
  totalIncome: DecT;
  totalDeductions: DecT;
  taxableIncome: DecT;
  federal: { taxBeforeCredits: DecT; credits: DecT; tax: DecT };
  provincial: { taxBeforeCredits: DecT; credits: DecT; tax: DecT } | null;
  payrollEstimate: { cpp: DecT; ei: DecT } | null;
  estimatedTax: DecT;
  taxDeducted: DecT;
  estimatedRefund: DecT; // positive when tax deducted exceeds estimated tax
  estimatedOwing: DecT; // positive when estimated tax exceeds tax deducted
  averageRate: DecT | null;
  marginalRate: DecT | null;
  warnings: string[];
}

/** Progressive tax: each rate applies only to the slice of income inside its bracket. */
export function bracketTax(taxable: DecLike, brackets: Bracket[]): DecT {
  const t = max0(taxable);
  let prev = ZERO,
    total = ZERO;
  for (const b of brackets) {
    const upper = b.upTo === null ? t : Dec.min(t, b.upTo);
    if (upper.gt(prev)) total = total.plus(upper.minus(prev).times(b.rate).div(100));
    prev = upper;
    if (b.upTo === null || t.lte(b.upTo)) break;
  }
  return total.toDecimalPlaces(2);
}
export function marginalRate(taxable: DecLike, brackets: Bracket[]): DecT {
  const t = D(taxable);
  for (const b of brackets) if (b.upTo === null || t.lte(b.upTo)) return D(b.rate);
  return D(brackets[brackets.length - 1]?.rate ?? 0);
}

function credits(rules: IncomeTaxRules, i: { donations: DecT; medical: DecT; tuition: DecT; payrollCredit: DecT; netIncome: DecT }): DecT {
  const rate = D(rules.creditRate).div(100);
  let c = D(rules.basicPersonalAmount).times(rate);
  c = c.plus(i.payrollCredit.times(rate));
  c = c.plus(i.tuition.times(rate));
  if (rules.donation && i.donations.gt(0)) {
    const first = Dec.min(i.donations, rules.donation.firstTier);
    c = c.plus(first.times(rules.donation.firstTierRate).div(100)).plus(max0(i.donations.minus(rules.donation.firstTier)).times(rules.donation.rate).div(100));
  }
  if (rules.medical && i.medical.gt(0)) {
    const threshold = Dec.min(i.netIncome.times(rules.medical.thresholdPct).div(100), rules.medical.thresholdMax);
    c = c.plus(max0(i.medical.minus(threshold)).times(rate));
  }
  return c.toDecimalPlaces(2);
}

export function payrollEstimate(employment: DecLike, p: PayrollRules): { cpp: DecT; ei: DecT } {
  const e = D(employment);
  const base = Dec.max(Dec.min(e, p.cpp.maxPensionable).minus(p.cpp.exemption), ZERO).times(p.cpp.rate).div(100);
  const second = p.cpp.additionalRate && p.cpp.additionalMax ? Dec.max(Dec.min(e, p.cpp.additionalMax).minus(p.cpp.maxPensionable), ZERO).times(p.cpp.additionalRate).div(100) : ZERO;
  return { cpp: base.plus(second).toDecimalPlaces(2), ei: Dec.min(e, p.ei.maxInsurable).times(p.ei.rate).div(100).toDecimalPlaces(2) };
}

export function estimateTax(i: TaxInputs, federal: TaxRuleData, provincial: TaxRuleData | null): TaxEstimate {
  const warnings: string[] = [];
  const employment = D(i.employmentIncome),
    self = D(i.selfEmploymentIncome),
    other = D(i.otherIncome);
  const totalIncome = employment.plus(self).plus(other);
  const deductions = sum([i.rrspContributions, i.fhsaContributions, i.pensionContributions, i.employmentExpenses, i.otherDeductions]);
  const taxable = max0(totalIncome.minus(deductions));
  const payroll = federal.payroll ? payrollEstimate(employment, federal.payroll) : null;
  const payrollCredit = payroll ? payroll.cpp.plus(payroll.ei) : ZERO;
  if (self.gt(0)) warnings.push("Self-employment income is included in taxable income, but the self-employed share of CPP and business expenses are not modelled.");
  warnings.push("The CPP and EI credit is estimated from employment income using the configured payroll limits. Use your T4 amounts for an accurate figure.");
  const ci = { donations: D(i.donations), medical: D(i.medicalExpenses), tuition: D(i.tuition), payrollCredit, netIncome: taxable };
  const fedBefore = bracketTax(taxable, federal.income.brackets);
  const fedCredits = credits(federal.income, ci);
  const fed = { taxBeforeCredits: fedBefore, credits: fedCredits, tax: max0(fedBefore.minus(fedCredits)) };
  let prov: TaxEstimate["provincial"] = null;
  if (provincial) {
    const pBefore = bracketTax(taxable, provincial.income.brackets);
    const pCredits = credits(provincial.income, { ...ci, donations: provincial.income.donation ? ci.donations : ZERO });
    prov = { taxBeforeCredits: pBefore, credits: pCredits, tax: max0(pBefore.minus(pCredits)) };
  } else warnings.push("No provincial or state rules are loaded for this household, so only federal tax is estimated.");
  const est = fed.tax.plus(prov?.tax ?? 0);
  const deducted = D(i.taxDeducted);
  const diff = deducted.minus(est);
  const marginal = marginalRate(taxable, federal.income.brackets).plus(provincial ? marginalRate(taxable, provincial.income.brackets) : 0);
  return {
    totalIncome,
    totalDeductions: deductions,
    taxableIncome: taxable,
    federal: fed,
    provincial: prov,
    payrollEstimate: payroll,
    estimatedTax: est,
    taxDeducted: deducted,
    estimatedRefund: diff.gt(0) ? diff : ZERO,
    estimatedOwing: diff.lt(0) ? diff.negated() : ZERO,
    averageRate: totalIncome.isZero() ? null : est.div(totalIncome).times(100).toDecimalPlaces(2),
    marginalRate: marginal,
    warnings,
  };
}

/** Picks the rule set for a year, falling back to the latest earlier year (reported to the user). */
export function pickRuleYear<T extends { year: number }>(sets: T[], year: number): { set: T | null; fellBackFrom: number | null } {
  const exact = sets.find((s) => s.year === year);
  if (exact) return { set: exact, fellBackFrom: null };
  const earlier = sets.filter((s) => s.year < year).sort((a, b) => b.year - a.year)[0];
  return earlier ? { set: earlier, fellBackFrom: year } : { set: null, fellBackFrom: null };
}

// Seeded planning defaults. They are editable data (see /settings tax rules) and MUST be verified against the tax authority.
export const SEEDED_TAX_RULES: { country: string; region: string; year: number; source: string; data: TaxRuleData }[] = [
  {
    country: "CA", region: "", year: 2025, source: "Seeded estimate from published 2025 federal parameters (blended 14.5 percent lowest rate). Verify at canada.ca.",
    data: {
      kind: "INCOME_TAX", currency: "CAD",
      income: { name: "Federal", brackets: [{ upTo: 57375, rate: 14.5 }, { upTo: 114750, rate: 20.5 }, { upTo: 177882, rate: 26 }, { upTo: 253414, rate: 29 }, { upTo: null, rate: 33 }], basicPersonalAmount: 16129, creditRate: 14.5, donation: { firstTier: 200, firstTierRate: 14.5, rate: 29 }, medical: { thresholdPct: 3, thresholdMax: 2834 } },
      payroll: { cpp: { rate: 5.95, exemption: 3500, maxPensionable: 71300, additionalRate: 4, additionalMax: 81200 }, ei: { rate: 1.64, maxInsurable: 65700 } },
      notes: ["Donation credits above the first tier use 29 percent (33 percent on the part of donations that falls in the top bracket is not modelled)."],
    },
  },
  {
    country: "CA", region: "AB", year: 2025, source: "Seeded estimate from published 2025 Alberta parameters. Verify at alberta.ca.",
    data: { kind: "INCOME_TAX", currency: "CAD", income: { name: "Alberta", brackets: [{ upTo: 60000, rate: 8 }, { upTo: 151234, rate: 10 }, { upTo: 181481, rate: 12 }, { upTo: 241974, rate: 13 }, { upTo: 362961, rate: 14 }, { upTo: null, rate: 15 }], basicPersonalAmount: 22323, creditRate: 8 } },
  },
  {
    country: "CA", region: "ON", year: 2025, source: "Seeded estimate from published 2025 Ontario parameters (surtax and health premium not modelled). Verify at ontario.ca.",
    data: { kind: "INCOME_TAX", currency: "CAD", income: { name: "Ontario", brackets: [{ upTo: 52886, rate: 5.05 }, { upTo: 105775, rate: 9.15 }, { upTo: 150000, rate: 11.16 }, { upTo: 220000, rate: 12.16 }, { upTo: null, rate: 13.16 }], basicPersonalAmount: 12747, creditRate: 5.05 }, notes: ["Ontario surtax and the Ontario Health Premium are not modelled."] },
  },
  {
    country: "CA", region: "BC", year: 2025, source: "Seeded estimate from published 2025 British Columbia parameters. Verify at gov.bc.ca.",
    data: { kind: "INCOME_TAX", currency: "CAD", income: { name: "British Columbia", brackets: [{ upTo: 49279, rate: 5.06 }, { upTo: 98560, rate: 7.7 }, { upTo: 113158, rate: 10.5 }, { upTo: 137407, rate: 12.29 }, { upTo: 186306, rate: 14.7 }, { upTo: 259829, rate: 16.8 }, { upTo: null, rate: 20.5 }], basicPersonalAmount: 12932, creditRate: 5.06 } },
  },
];
