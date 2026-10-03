// Keep or replace a vehicle (pure). Both choices start from the same position: the old vehicle is worth its current value today.
// Cost over the horizon = loss in value + running costs + loan interest. Nothing is hidden: every assumption is an input.
import { D, Dec, ZERO, money, type DecLike } from "./decimal";

export interface KeepInput { value: DecLike; annualRepairs: DecLike; repairGrowthPct: DecLike; annualFuel: DecLike; annualInsurance: DecLike; depreciationPct: DecLike }
export interface ReplaceInput { price: DecLike; annualRepairs: DecLike; annualFuel: DecLike; annualInsurance: DecLike; firstYearDepreciationPct: DecLike; depreciationPct: DecLike; downPayment: DecLike; loanRatePct: DecLike; loanMonths: number }
export interface KeepReplaceInput { years: number; keep: KeepInput; replace: ReplaceInput }
export interface YearRow { year: number; keep: string; replace: string }
export interface KeepReplaceResult { keepTotal: string; replaceTotal: string; difference: string; cheaper: "KEEP" | "REPLACE" | "SAME"; breakEvenYear: number | null; yearly: YearRow[]; replaceMonthlyPayment: string; replaceInterest: string; notes: string[] }

function loan(principal: Dec, aprPct: DecLike, months: number) {
  if (principal.lte(0) || months <= 0) return { payment: ZERO, balanceAt: (_m: number) => ZERO, interestAt: (_m: number) => ZERO };
  const r = D(aprPct).div(1200);
  const payment = r.isZero() ? principal.div(months) : principal.times(r).div(D(1).minus(D(1).plus(r).pow(-months)));
  const balances: Dec[] = [principal], interest: Dec[] = [ZERO];
  for (let m = 1; m <= months; m++) {
    const i = balances[m - 1].times(r);
    balances.push(Dec.max(balances[m - 1].plus(i).minus(payment), ZERO));
    interest.push(interest[m - 1].plus(i));
  }
  const clamp = (m: number) => Math.min(Math.max(m, 0), months);
  return { payment, balanceAt: (m: number) => balances[clamp(m)], interestAt: (m: number) => interest[clamp(m)] };
}

export function keepOrReplace(i: KeepReplaceInput): KeepReplaceResult {
  const n = Math.max(1, Math.min(15, Math.round(i.years)));
  const k = i.keep, r = i.replace;
  let keepValue = D(k.value), repairs = D(k.annualRepairs), cumKeep = ZERO;
  let newValue = D(r.price), cumRep = ZERO;
  const L = loan(Dec.max(D(r.price).minus(D(r.downPayment)), ZERO), r.loanRatePct, r.loanMonths);
  const yearly: YearRow[] = [];
  let breakEven: number | null = null;
  for (let y = 1; y <= n; y++) {
    const keepLoss = keepValue.times(D(k.depreciationPct).div(100));
    keepValue = keepValue.minus(keepLoss);
    cumKeep = cumKeep.plus(keepLoss).plus(repairs).plus(D(k.annualFuel)).plus(D(k.annualInsurance));
    repairs = repairs.times(D(1).plus(D(k.repairGrowthPct).div(100)));

    const repLoss = newValue.times(D(y === 1 ? r.firstYearDepreciationPct : r.depreciationPct).div(100));
    newValue = newValue.minus(repLoss);
    const interestThisYear = L.interestAt(y * 12).minus(L.interestAt((y - 1) * 12));
    cumRep = cumRep.plus(repLoss).plus(D(r.annualRepairs)).plus(D(r.annualFuel)).plus(D(r.annualInsurance)).plus(interestThisYear);
    yearly.push({ year: y, keep: money(cumKeep), replace: money(cumRep) });
    if (breakEven === null && cumRep.lte(cumKeep)) breakEven = y;
  }
  const diff = cumKeep.minus(cumRep);
  return {
    keepTotal: money(cumKeep), replaceTotal: money(cumRep), difference: money(diff.abs()), cheaper: diff.abs().lt(1) ? "SAME" : diff.gt(0) ? "REPLACE" : "KEEP",
    breakEvenYear: breakEven, yearly, replaceMonthlyPayment: money(L.payment), replaceInterest: money(L.interestAt(Math.min(n * 12, r.loanMonths))),
    notes: [
      "Both options start from the same position: the old vehicle is worth its current value today, so selling it and buying the new one is compared with keeping it.",
      "Cost is the loss in value plus repairs, fuel, insurance and loan interest over the years chosen. It does not include the time and stress of a breakdown, or the convenience of a new vehicle.",
      "Repairs are assumed to grow each year for the vehicle you keep. Real repair bills are uneven, so treat this as a guide.",
    ],
  };
}
