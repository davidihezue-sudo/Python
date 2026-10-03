// Retirement and financial independence projection (pure). Everything is worked in today's dollars: the return is converted to a real return, so the answer is not inflated by future prices.
import { D, Dec, ZERO, money, type DecLike } from "./decimal";

export interface RetirementInput {
  currentAge: number; retireAge: number; lifeAge: number;
  savings: DecLike; monthlyContribution: DecLike; returnPct: DecLike; inflationPct: DecLike;
  /** yearly spending wanted in retirement, in today's dollars */
  annualSpending: DecLike;
  /** yearly pension income such as CPP and OAS, in today's dollars, and the age it starts */
  benefitIncome?: DecLike; benefitAge?: number;
  /** safe withdrawal rate used for the independence number, default 4 */
  withdrawalPct?: DecLike;
}
export interface RetirementResult {
  fiNumber: string; atRetirement: string; gap: string; fundedPercent: string; onTrack: boolean;
  /** the age the money would run out, or null if it lasts to the planning age */
  depletionAge: number | null;
  requiredMonthly: string | null;
  realReturnPct: string;
  series: { age: number; balance: string }[];
  notes: string[];
}

export const realMonthlyRate = (returnPct: DecLike, inflationPct: DecLike): Dec => {
  const r = D(returnPct).div(100).plus(1), i = D(inflationPct).div(100).plus(1);
  return Dec.pow(r.div(i), D(1).div(12)).minus(1);
};

function accumulate(start: Dec, monthly: Dec, rm: Dec, months: number, series?: { age: number; balance: string }[], startAge?: number): Dec {
  let b = start;
  for (let m = 1; m <= months; m++) {
    b = b.times(rm.plus(1)).plus(monthly);
    if (series && startAge !== undefined && m % 12 === 0) series.push({ age: startAge + m / 12, balance: money(b) });
  }
  return b;
}

export function projectRetirement(i: RetirementInput): RetirementResult {
  const rm = realMonthlyRate(i.returnPct, i.inflationPct);
  const wd = D(i.withdrawalPct ?? 4);
  const spend = D(i.annualSpending), benefit = D(i.benefitIncome ?? 0);
  const benefitAge = i.benefitAge ?? i.retireAge;
  const accMonths = Math.max(0, (i.retireAge - i.currentAge) * 12);
  const series: { age: number; balance: string }[] = [{ age: i.currentAge, balance: money(i.savings) }];
  const atRet = accumulate(D(i.savings), D(i.monthlyContribution), rm, accMonths, series, i.currentAge);

  const netNeed = benefitAge <= i.retireAge ? Dec.max(spend.minus(benefit), ZERO) : spend;
  const fi = wd.gt(0) ? netNeed.div(wd).times(100) : ZERO;

  // Drawdown: spend every month, pension income arrives from its start age.
  let b = atRet, depletion: number | null = null;
  for (let m = 1; m <= Math.max(0, (i.lifeAge - i.retireAge) * 12); m++) {
    const age = i.retireAge + (m - 1) / 12;
    const need = spend.minus(age >= benefitAge ? benefit : ZERO);
    b = b.times(rm.plus(1)).minus(Dec.max(need, ZERO).div(12));
    if (b.lt(0)) { depletion = Math.floor(i.retireAge + m / 12); b = ZERO; for (; m <= (i.lifeAge - i.retireAge) * 12; m++) if (m % 12 === 0) series.push({ age: i.retireAge + m / 12, balance: "0.00" }); break; }
    if (m % 12 === 0) series.push({ age: i.retireAge + m / 12, balance: money(b) });
  }

  // Monthly saving needed to reach the independence number by the retirement age (binary search on a monotone function).
  let required: string | null = null;
  if (fi.gt(0) && accMonths > 0) {
    if (accumulate(D(i.savings), ZERO, rm, accMonths).gte(fi)) required = "0.00";
    else {
      let lo = ZERO, hi = D(1_000_000);
      for (let n = 0; n < 60; n++) { const mid = lo.plus(hi).div(2); if (accumulate(D(i.savings), mid, rm, accMonths).gte(fi)) hi = mid; else lo = mid; }
      required = money(hi);
    }
  }
  const gap = fi.minus(atRet);
  const notes = [
    "All amounts are in today's dollars. The return you enter is reduced by inflation, so the answer is not inflated by future prices.",
    `The independence number is yearly spending after pension income divided by a ${wd.toString()} percent withdrawal rate.`,
    "This is a planning aid with steady returns. Real markets move around, so treat it as a range, not a promise.",
  ];
  if (benefitAge > i.retireAge && benefit.gt(0)) notes.push(`Pension income starts at ${benefitAge}, so it is not counted in the independence number but is used in the drawdown.`);
  return {
    fiNumber: money(fi), atRetirement: money(atRet), gap: money(gap.gt(0) ? gap : ZERO),
    fundedPercent: fi.gt(0) ? atRet.div(fi).times(100).toDecimalPlaces(1).toString() : "0",
    onTrack: depletion === null, depletionAge: depletion, requiredMonthly: required, realReturnPct: rm.plus(1).pow(12).minus(1).times(100).toDecimalPlaces(2).toString(), series, notes,
  };
}
