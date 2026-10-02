import { addDays, addInterval, diffDays, humanizeDays, type IsoDate } from "@/lib/dates";
import { formatDistance, type DistanceUnit } from "@/lib/units";

export type TriggerType = "MILEAGE" | "TIME" | "MILEAGE_OR_TIME" | "MILEAGE_AND_TIME" | "CONDITION" | "INSPECTION" | "ONE_TIME" | "RECURRING";
export type ScheduleStatus = "UP_TO_DATE" | "UPCOMING" | "DUE_SOON" | "DUE_NOW" | "OVERDUE" | "INSPECTION_REQUIRED" | "UNKNOWN_HISTORY";
export type SourceType = "MANUFACTURER" | "SUGGESTED" | "USER_DEFINED";
export type EstimateBasis = "USER_SCHEDULE" | "MANUFACTURER" | "HISTORICAL_DRIVING" | "GENERAL_SUGGESTION";
export type Condition = "GOOD" | "FAIR" | "POOR" | "CRITICAL";

export interface Thresholds {
  upcomingKm: number;
  upcomingDays: number;
  dueSoonKm: number;
  dueSoonDays: number;
  graceKm: number;
  graceDays: number;
}
export const DEFAULT_THRESHOLDS: Thresholds = { upcomingKm: 3000, upcomingDays: 90, dueSoonKm: 1000, dueSoonDays: 30, graceKm: 500, graceDays: 7 };

export interface RuleInput {
  triggerType: TriggerType;
  intervalKm?: number | null;
  intervalMonths?: number | null;
  intervalDays?: number | null;
  anchorDate?: IsoDate | null;
  oneTimeDueDate?: IsoDate | null;
  oneTimeDueKm?: number | null;
  sourceType?: SourceType;
  dueSoonKm?: number | null;
  dueSoonDays?: number | null;
  /** last completion derived from records + manual baseline */
  lastCompletedAt?: IsoDate | null;
  lastCompletedKm?: number | null;
  lastCondition?: Condition | string | null;
  lastInspectedAt?: IsoDate | null;
}

export interface EvalContext {
  currentKm: number | null;
  /** date of the latest odometer reading (for projections) */
  currentKmDate?: IsoDate | null;
  today: IsoDate;
  avgDailyKm: number | null;
  thresholds: Thresholds;
}

export interface Evaluation {
  status: ScheduleStatus;
  nextDueKm: number | null;
  nextDueDate: IsoDate | null;
  remainingKm: number | null;
  remainingDays: number | null;
  /** Date the mileage threshold is projected to be reached at the historical driving rate */
  estimatedKmDueDate: IsoDate | null;
  estimatedMonthsToKm: number | null;
  /** Best single estimate of when this becomes due */
  effectiveDueDate: IsoDate | null;
  dueBasis: "MILEAGE" | "TIME" | "BOTH" | "ONE_TIME" | "INSPECTION" | "CONDITION" | "RECURRING" | null;
  estimateBasis: EstimateBasis[];
  overdueByKm: number | null;
  overdueByDays: number | null;
  reason: string;
}

const RANK: Record<ScheduleStatus, number> = {
  UP_TO_DATE: 0,
  UNKNOWN_HISTORY: 0,
  INSPECTION_REQUIRED: 2,
  UPCOMING: 1,
  DUE_SOON: 2,
  DUE_NOW: 3,
  OVERDUE: 4,
};
const BY_RANK: ScheduleStatus[] = ["UP_TO_DATE", "UPCOMING", "DUE_SOON", "DUE_NOW", "OVERDUE"];
export const statusUrgency = (s: ScheduleStatus): number =>
  ({ OVERDUE: 6, DUE_NOW: 5, INSPECTION_REQUIRED: 4, DUE_SOON: 3, UPCOMING: 2, UNKNOWN_HISTORY: 1, UP_TO_DATE: 0 })[s];

/** Status for a single remaining-distance/time dimension. */
export function dimensionStatus(remaining: number, upcoming: number, dueSoon: number, grace: number): ScheduleStatus {
  if (remaining < -grace) return "OVERDUE";
  if (remaining <= 0) return "DUE_NOW";
  if (remaining <= dueSoon) return "DUE_SOON";
  if (remaining <= upcoming) return "UPCOMING";
  return "UP_TO_DATE";
}

const hasKm = (r: RuleInput) => r.intervalKm !== null && r.intervalKm !== undefined && r.intervalKm > 0;
const hasTime = (r: RuleInput) => ((r.intervalMonths ?? 0) > 0 || (r.intervalDays ?? 0) > 0);

function basisFor(rule: RuleInput, usedEstimate: boolean): EstimateBasis[] {
  const b: EstimateBasis[] = [];
  b.push(rule.sourceType === "MANUFACTURER" ? "MANUFACTURER" : rule.sourceType === "USER_DEFINED" ? "USER_SCHEDULE" : "GENERAL_SUGGESTION");
  if (usedEstimate) b.push("HISTORICAL_DRIVING");
  return b;
}

function blank(reason: string, status: ScheduleStatus = "UNKNOWN_HISTORY"): Evaluation {
  return {
    status,
    nextDueKm: null,
    nextDueDate: null,
    remainingKm: null,
    remainingDays: null,
    estimatedKmDueDate: null,
    estimatedMonthsToKm: null,
    effectiveDueDate: null,
    dueBasis: null,
    estimateBasis: [],
    overdueByKm: null,
    overdueByDays: null,
    reason,
  };
}

/** Occurrence of a RECURRING (fixed-calendar) rule: anchor + k*interval, skipping occurrences already satisfied. */
export function nextRecurringOccurrence(anchor: IsoDate, months: number | null | undefined, days: number | null | undefined, lastCompleted: IsoDate | null | undefined, satisfiedWindowDays: number): IsoDate | null {
  if (!hasTime({ triggerType: "RECURRING", intervalMonths: months, intervalDays: days })) return null;
  let occ = anchor;
  for (let i = 0; i < 2000; i++) {
    if (!lastCompleted || lastCompleted < addDays(occ, -satisfiedWindowDays)) return occ;
    occ = addInterval(occ, months, days);
  }
  return occ;
}

export function evaluateRule(rule: RuleInput, ctx: EvalContext): Evaluation {
  const th = {
    ...ctx.thresholds,
    dueSoonKm: rule.dueSoonKm ?? ctx.thresholds.dueSoonKm,
    dueSoonDays: rule.dueSoonDays ?? ctx.thresholds.dueSoonDays,
  };
  const { today, currentKm, avgDailyKm } = ctx;
  const lastAt = rule.lastCompletedAt ?? null;
  const lastKm = rule.lastCompletedKm ?? null;
  const currentRef = currentKm !== null && currentKm !== undefined ? { valueKm: currentKm, date: ctx.currentKmDate ?? today } : null;

  // ── ONE_TIME
  if (rule.triggerType === "ONE_TIME") {
    if (lastAt) return { ...blank("Completed", "UP_TO_DATE"), reason: `Completed on ${lastAt}.` };
    const dueDate = rule.oneTimeDueDate ?? null;
    const dueKm = rule.oneTimeDueKm ?? null;
    if (!dueDate && dueKm === null) return blank("No due date or odometer target has been set.");
    return finish(rule, ctx, th, { dueKm, dueDate, mode: "OR", basis: "ONE_TIME", needsHistory: false });
  }

  // ── CONDITION
  if (rule.triggerType === "CONDITION") {
    const cond = rule.lastCondition as Condition | null | undefined;
    const completedAfterInspection = lastAt && (!rule.lastInspectedAt || lastAt >= rule.lastInspectedAt);
    if (completedAfterInspection) return { ...blank(`Replaced/serviced on ${lastAt}.`, "UP_TO_DATE"), dueBasis: "CONDITION", estimateBasis: basisFor(rule, false) };
    if (!cond) return { ...blank("Condition-based item with no recorded inspection."), dueBasis: "CONDITION" };
    let status: ScheduleStatus = ({ GOOD: "UP_TO_DATE", FAIR: "DUE_SOON", POOR: "DUE_NOW", CRITICAL: "OVERDUE" } as Record<string, ScheduleStatus>)[cond] ?? "UNKNOWN_HISTORY";
    let reason = `Last inspection (${rule.lastInspectedAt ?? "undated"}) rated this item ${cond.toLowerCase()}.`;
    if (hasTime(rule) && rule.lastInspectedAt) {
      const next = addInterval(rule.lastInspectedAt, rule.intervalMonths, rule.intervalDays);
      if (diffDays(next, today) < 0) {
        status = "INSPECTION_REQUIRED";
        reason = `Last inspected ${rule.lastInspectedAt}; a re-inspection was due ${next}.`;
      }
    }
    return { ...blank(reason, status), dueBasis: "CONDITION", estimateBasis: basisFor(rule, false) };
  }

  // ── INSPECTION
  if (rule.triggerType === "INSPECTION") {
    const insAt = [rule.lastInspectedAt, lastAt].filter(Boolean).sort().at(-1) ?? null;
    if (!insAt && lastKm === null) {
      return { ...blank("Never inspected - an inspection is needed to establish this item's condition.", "INSPECTION_REQUIRED"), dueBasis: "INSPECTION", estimateBasis: basisFor(rule, false) };
    }
    const ev = finish({ ...rule, lastCompletedAt: insAt, lastCompletedKm: lastKm }, ctx, th, {
      dueKm: hasKm(rule) && lastKm !== null ? lastKm + (rule.intervalKm as number) : null,
      dueDate: hasTime(rule) && insAt ? addInterval(insAt, rule.intervalMonths, rule.intervalDays) : null,
      mode: "OR",
      basis: "INSPECTION",
      needsHistory: true,
    });
    if (RANK[ev.status] >= RANK.DUE_NOW && ev.status !== "INSPECTION_REQUIRED") ev.status = "INSPECTION_REQUIRED";
    return ev;
  }

  // ── RECURRING (fixed calendar)
  if (rule.triggerType === "RECURRING") {
    if (!rule.anchorDate || !hasTime(rule)) return blank("Recurring rule needs an anchor date and an interval.");
    const occ = nextRecurringOccurrence(rule.anchorDate, rule.intervalMonths, rule.intervalDays, lastAt, th.upcomingDays);
    return finish(rule, ctx, th, { dueKm: null, dueDate: occ, mode: "OR", basis: "RECURRING", needsHistory: false });
  }

  // ── MILEAGE / TIME / OR / AND
  const wantKm = rule.triggerType !== "TIME";
  const wantTime = rule.triggerType !== "MILEAGE";
  const dueKm = wantKm && hasKm(rule) && lastKm !== null ? lastKm + (rule.intervalKm as number) : null;
  const dueDate = wantTime && hasTime(rule) && lastAt ? addInterval(lastAt, rule.intervalMonths, rule.intervalDays) : null;
  if (!hasKm(rule) && !hasTime(rule)) return blank("No interval configured.");
  if (dueKm === null && dueDate === null) {
    return { ...blank("No completed service recorded yet - record one (or enter when it was last done) to start tracking."), estimateBasis: basisFor(rule, false) };
  }
  const mode = rule.triggerType === "MILEAGE_AND_TIME" ? "AND" : "OR";
  const basis = rule.triggerType === "MILEAGE" ? "MILEAGE" : rule.triggerType === "TIME" ? "TIME" : "BOTH";
  return finish(rule, ctx, th, { dueKm, dueDate, mode, basis, needsHistory: true });
}

function finish(
  rule: RuleInput,
  ctx: EvalContext,
  th: Thresholds,
  p: { dueKm: number | null; dueDate: IsoDate | null; mode: "OR" | "AND"; basis: Evaluation["dueBasis"]; needsHistory: boolean },
): Evaluation {
  const { today, currentKm, avgDailyKm } = ctx;
  const remainingKm = p.dueKm !== null && currentKm !== null && currentKm !== undefined ? p.dueKm - currentKm : null;
  const remainingDays = p.dueDate ? diffDays(p.dueDate, today) : null;

  const dimKm = remainingKm !== null ? dimensionStatus(remainingKm, th.upcomingKm, th.dueSoonKm, th.graceKm) : null;
  const dimTime = remainingDays !== null ? dimensionStatus(remainingDays, th.upcomingDays, th.dueSoonDays, th.graceDays) : null;

  let status: ScheduleStatus;
  let reason = "";
  if (dimKm === null && dimTime === null) {
    status = "UNKNOWN_HISTORY";
    reason = p.dueKm !== null ? "A mileage target exists but the vehicle's current odometer is unknown." : "Insufficient data.";
  } else if (dimKm !== null && dimTime !== null) {
    const rk = RANK[dimKm];
    const rt = RANK[dimTime];
    if (p.mode === "OR") status = BY_RANK[Math.max(rk, rt)];
    else if (rk >= 3 && rt >= 3) status = BY_RANK[Math.max(rk, rt)];
    else status = BY_RANK[Math.max(Math.min(rk, rt), Math.max(rk, rt) >= 3 ? 1 : 0)];
  } else {
    status = (dimKm ?? dimTime) as ScheduleStatus;
  }

  const estimatedKmDate =
    p.dueKm !== null && currentKm !== null && currentKm !== undefined && remainingKm !== null
      ? remainingKm <= 0
        ? today
        : avgDailyKm && avgDailyKm > 0
          ? addDays(ctx.currentKmDate && ctx.currentKmDate > today ? ctx.currentKmDate : today, Math.ceil(remainingKm / avgDailyKm))
          : null
      : null;
  const estimatedMonths = remainingKm !== null && remainingKm > 0 && avgDailyKm && avgDailyKm > 0 ? remainingKm / (avgDailyKm * (365.25 / 12)) : null;

  let effective: IsoDate | null = null;
  if (estimatedKmDate && p.dueDate) effective = p.mode === "AND" ? (estimatedKmDate > p.dueDate ? estimatedKmDate : p.dueDate) : estimatedKmDate < p.dueDate ? estimatedKmDate : p.dueDate;
  else effective = estimatedKmDate ?? p.dueDate;

  if (!reason) {
    const parts: string[] = [];
    if (remainingKm !== null) parts.push(remainingKm >= 0 ? `${Math.round(remainingKm)} km remaining` : `${Math.round(-remainingKm)} km past due`);
    if (remainingDays !== null) parts.push(remainingDays >= 0 ? `${remainingDays} days remaining` : `${-remainingDays} days past due`);
    reason = parts.join("; ");
  }

  return {
    status,
    nextDueKm: p.dueKm,
    nextDueDate: p.dueDate,
    remainingKm,
    remainingDays,
    estimatedKmDueDate: estimatedKmDate,
    estimatedMonthsToKm: estimatedMonths,
    effectiveDueDate: effective,
    dueBasis: p.basis,
    estimateBasis: basisFor(rule, !!estimatedKmDate && remainingKm !== null && remainingKm > 0),
    overdueByKm: remainingKm !== null && remainingKm < 0 ? -remainingKm : null,
    overdueByDays: remainingDays !== null && remainingDays < 0 ? -remainingDays : null,
    reason,
  };
}

/** Human description such as "Due in 2,000 km (≈1.3 months)" / "Overdue by 3 months". */
export function describeDue(ev: Evaluation, unit: DistanceUnit = "KM"): string {
  const fmt = (km: number) => formatDistance(km, unit);
  switch (ev.status) {
    case "UNKNOWN_HISTORY":
      return "No service history recorded";
    case "INSPECTION_REQUIRED":
      return ev.overdueByDays || ev.overdueByKm ? "Inspection overdue" : "Inspection required";
    case "UP_TO_DATE":
      if (ev.remainingKm === null && ev.remainingDays === null) return "Up to date";
  }
  const bits: string[] = [];
  if (ev.status === "OVERDUE" || ev.status === "DUE_NOW") {
    if (ev.overdueByKm !== null && ev.overdueByKm > 0) bits.push(`${fmt(ev.overdueByKm)} past due`);
    if (ev.overdueByDays !== null && ev.overdueByDays > 0) bits.push(`${humanizeDays(ev.overdueByDays)} past due`);
    if (!bits.length) bits.push("Due now");
    return (ev.status === "OVERDUE" ? "Overdue by " : "Due now - ") + bits.join(" / ").replace(/ past due/g, "");
  }
  if (ev.remainingKm !== null && ev.remainingKm >= 0) {
    let s = `${fmt(ev.remainingKm)}`;
    if (ev.estimatedMonthsToKm !== null) s += ` (≈${ev.estimatedMonthsToKm.toFixed(1)} mo at your driving rate)`;
    bits.push(s);
  }
  if (ev.remainingDays !== null && ev.remainingDays >= 0) bits.push(humanizeDays(ev.remainingDays));
  return bits.length ? `Due in ${bits.join(" or ")}` : "Up to date";
}

export interface CompletionEvent {
  date: IsoDate;
  km: number | null;
}
/** Latest completion across record-derived events and the manual baseline. */
export function deriveLastCompletion(events: CompletionEvent[], baseline?: { date?: IsoDate | null; km?: number | null }): CompletionEvent | null {
  const all: CompletionEvent[] = [...events];
  if (baseline?.date) all.push({ date: baseline.date, km: baseline.km ?? null });
  if (all.length === 0) return null;
  return all.sort((a, b) => (a.date === b.date ? (a.km ?? -1) - (b.km ?? -1) : a.date < b.date ? -1 : 1)).at(-1) ?? null;
}

export function worstStatus(statuses: ScheduleStatus[]): ScheduleStatus | null {
  if (!statuses.length) return null;
  return statuses.reduce((w, s) => (statusUrgency(s) > statusUrgency(w) ? s : w));
}

/**
 * Transparent maintenance-condition score (0–100) from evaluated schedules with known history, weighted by priority.
 * Returns null when there is not enough recorded data - the UI must show "insufficient data" rather than a number.
 */
export function maintenanceHealth(items: { status: ScheduleStatus; priority: "LOW" | "NORMAL" | "HIGH" | "CRITICAL" }[]) {
  const weight = { LOW: 1, NORMAL: 2, HIGH: 3, CRITICAL: 4 } as const;
  const points: Record<ScheduleStatus, number | null> = { UP_TO_DATE: 100, UPCOMING: 90, DUE_SOON: 70, DUE_NOW: 40, OVERDUE: 0, INSPECTION_REQUIRED: 50, UNKNOWN_HISTORY: null };
  let num = 0;
  let den = 0;
  let known = 0;
  for (const i of items) {
    const p = points[i.status];
    if (p === null) continue;
    known++;
    num += p * weight[i.priority];
    den += weight[i.priority];
  }
  const unknown = items.length - known;
  if (known < 3) return { score: null as number | null, known, unknown, label: "Insufficient data" };
  const score = Math.round(num / den);
  const label = score >= 85 ? "Excellent" : score >= 70 ? "Good" : score >= 50 ? "Needs attention" : "Poor";
  return { score, known, unknown, label };
}
