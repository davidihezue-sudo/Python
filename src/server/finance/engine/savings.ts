// Savings goals, emergency fund planning and goal status.
import { D, Dec, ZERO, max0, sum, type Dec as DecT, type DecLike } from "./decimal";
import { addMonths, monthsBetween, type IsoDate } from "./dates";

export type GoalStatusKind = "COMPLETED" | "ON_TRACK" | "BEHIND" | "NO_PLAN";

export interface GoalProjection {
  target: DecT;
  current: DecT;
  remaining: DecT;
  percentComplete: DecT; // capped to 100 for display, 0 when the target is zero
  requiredMonthly: DecT | null; // needed to hit the target date; null without a target date
  monthsToTarget: DecT | null;
  plannedMonthly: DecT;
  estimatedCompletion: IsoDate | null; // at the planned contribution
  estimatedMonthsAtPlan: number | null;
  status: GoalStatusKind;
  shortfallMonthly: DecT | null; // how much more per month is needed to stay on track
}

/**
 * remaining = target - current
 * requiredMonthly = remaining / months until the target date (a past date requires the whole remainder now)
 * estimatedCompletion = today + ceil(remaining / plannedMonthly) months
 * Status: COMPLETED when current >= target; ON_TRACK when the plan completes on or before the target date (or the plan
 * meets the required contribution); BEHIND when it does not; NO_PLAN when nothing is being contributed.
 */
export function projectGoal(p: { target: DecLike; current: DecLike; monthly: DecLike; targetDate?: IsoDate | null; today: IsoDate }): GoalProjection {
  const target = D(p.target),
    current = D(p.current),
    plan = D(p.monthly);
  const remaining = max0(target.minus(current));
  const pctComplete = target.lte(0) ? ZERO : Dec.min(current.div(target).times(100), new Dec(100)).toDecimalPlaces(2);
  let required: DecT | null = null,
    months: DecT | null = null;
  if (p.targetDate) {
    months = monthsBetween(p.today, p.targetDate);
    required = remaining.isZero() ? ZERO : months.lte(0) ? remaining : remaining.div(Dec.max(months, new Dec("0.0001"))).toDecimalPlaces(2, Dec.ROUND_UP);
  }
  let est: IsoDate | null = null;
  let estMonths: number | null = null;
  if (remaining.isZero()) {
    est = p.today;
    estMonths = 0;
  } else if (plan.gt(0)) {
    estMonths = remaining.div(plan).ceil().toNumber();
    est = addMonths(p.today, estMonths);
  }
  let status: GoalStatusKind;
  if (remaining.isZero()) status = "COMPLETED";
  else if (plan.lte(0)) status = "NO_PLAN";
  else if (!p.targetDate) status = "ON_TRACK";
  else status = est !== null && est <= p.targetDate ? "ON_TRACK" : "BEHIND";
  return { target, current, remaining, percentComplete: pctComplete, requiredMonthly: required, monthsToTarget: months, plannedMonthly: plan, estimatedCompletion: est, estimatedMonthsAtPlan: estMonths, status, shortfallMonthly: required && status === "BEHIND" ? Dec.max(required.minus(plan), ZERO) : null };
}

/** Progress for a goal that tracks a debt being repaid: progress = (starting balance - outstanding) / starting balance. */
export function projectDebtGoal(p: { startingBalance: DecLike; outstanding: DecLike; targetDate?: IsoDate | null; monthlyPayment: DecLike; today: IsoDate }): GoalProjection {
  const start = D(p.startingBalance);
  const paid = max0(start.minus(D(p.outstanding)));
  return projectGoal({ target: start, current: paid, monthly: p.monthlyPayment, targetDate: p.targetDate, today: p.today });
}

export interface EmergencyPlan {
  essentialMonthly: DecT;
  currentSavings: DecT;
  coverageMonths: DecT | null;
  targets: { months: number; amount: DecT; remaining: DecT; requiredMonthly: DecT | null; reached: boolean }[];
}
export function planEmergencyFund(p: { essentialMonthly: DecLike; currentSavings: DecLike; targetMonths: number[]; planMonths?: number }): EmergencyPlan {
  const ess = D(p.essentialMonthly),
    cur = D(p.currentSavings);
  return {
    essentialMonthly: ess,
    currentSavings: cur,
    coverageMonths: ess.isZero() ? null : cur.div(ess).toDecimalPlaces(2),
    targets: p.targetMonths.map((m) => {
      const amount = ess.times(m);
      const rem = max0(amount.minus(cur));
      return { months: m, amount, remaining: rem, requiredMonthly: p.planMonths && p.planMonths > 0 ? rem.div(p.planMonths).toDecimalPlaces(2, Dec.ROUND_UP) : null, reached: rem.isZero() };
    }),
  };
}

export interface IncomeLossRunway {
  essentialMonthly: DecT;
  remainingIncomeMonthly: DecT;
  monthlyShortfall: DecT;
  runwayMonths: DecT | null; // null means the remaining income covers essentials (no depletion)
  coversEssentials: boolean;
}
/** How long savings last when one income stops: shortfall = essentials - remaining net income; runway = savings / shortfall. */
export function incomeLossRunway(p: { essentialMonthly: DecLike; remainingIncomeMonthly: DecLike; availableSavings: DecLike; extraMonthlyCosts?: DecLike }): IncomeLossRunway {
  const ess = D(p.essentialMonthly).plus(D(p.extraMonthlyCosts));
  const inc = D(p.remainingIncomeMonthly);
  const shortfall = ess.minus(inc);
  if (shortfall.lte(0)) return { essentialMonthly: ess, remainingIncomeMonthly: inc, monthlyShortfall: ZERO, runwayMonths: null, coversEssentials: true };
  return { essentialMonthly: ess, remainingIncomeMonthly: inc, monthlyShortfall: shortfall, runwayMonths: D(p.availableSavings).div(shortfall).toDecimalPlaces(1), coversEssentials: false };
}

export { sum };
