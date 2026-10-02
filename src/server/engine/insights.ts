import { humanizeDays, diffDays, type IsoDate } from "@/lib/dates";
import type { EstimateBasis, ScheduleStatus } from "./schedule";

export interface Insight {
  id: string;
  severity: "info" | "warning" | "critical";
  title: string;
  detail: string;
  basis: (EstimateBasis | "RECORDED_DATA")[];
  vehicleId: string;
  vehicleName: string;
  action?: { label: string; href: string };
}

export interface InsightInput {
  vehicleId: string;
  vehicleName: string;
  today: IsoDate;
  schedules: { id: string; name: string; status: ScheduleStatus; summary: string; effectiveDueDate: IsoDate | null; estimatedMonthsToKm: number | null; estimateBasis: EstimateBasis[]; enabled: boolean }[];
  replacements: { componentKey: string; count: number; withinMonths24: number }[];
  spendLast12: number | null;
  spendPrev12: number | null;
  fmtMoney: (n: number) => string;
  warranties: { name: string; endDate: IsoDate }[];
  openIssues: number;
  avgMonthlyKmText: string | null;
  hasOdometer: boolean;
}

const pretty = (k: string) => k.replace(/_/g, " ");

/** Transparent, deterministic insights — every statement is derived from recorded data and labelled with its basis. */
export function generateInsights(i: InsightInput): Insight[] {
  const out: Insight[] = [];
  const mk = (x: Omit<Insight, "vehicleId" | "vehicleName">) => out.push({ ...x, vehicleId: i.vehicleId, vehicleName: i.vehicleName });
  const active = i.schedules.filter((s) => s.enabled);
  for (const s of active.filter((s) => s.status === "OVERDUE").slice(0, 4)) mk({ id: `overdue:${s.id}`, severity: "critical", title: `${s.name} is overdue`, detail: s.summary, basis: s.estimateBasis, action: { label: "Record service", href: `/service-history/new?assignmentId=${s.id}` } });
  for (const s of active.filter((s) => s.status === "DUE_NOW" || s.status === "DUE_SOON" || s.status === "INSPECTION_REQUIRED").slice(0, 4)) mk({ id: `due:${s.id}`, severity: "warning", title: `${s.name}: ${s.status === "INSPECTION_REQUIRED" ? "inspection required" : s.status === "DUE_NOW" ? "due now" : "due soon"}`, detail: s.summary, basis: s.estimateBasis, action: { label: "Record service", href: `/service-history/new?assignmentId=${s.id}` } });
  for (const s of active.filter((s) => s.status === "UPCOMING" && s.estimatedMonthsToKm !== null && s.estimatedMonthsToKm <= 3 && s.effectiveDueDate).slice(0, 3)) mk({ id: `proj:${s.id}`, severity: "info", title: `${s.name} expected around ${s.effectiveDueDate}`, detail: `${s.summary}. ${i.avgMonthlyKmText ? `Estimated from your average driving of ${i.avgMonthlyKmText} per month.` : ""}`.trim(), basis: s.estimateBasis });
  for (const r of i.replacements.filter((r) => r.withinMonths24 >= 2 || r.count >= 3).slice(0, 3)) mk({ id: `repl:${r.componentKey}`, severity: "warning", title: `${pretty(r.componentKey)} replaced ${r.count} times`, detail: r.withinMonths24 >= 2 ? `${r.withinMonths24} replacements within the last 24 months — consider investigating the underlying cause.` : "Repeated replacements are recorded for this component.", basis: ["RECORDED_DATA"], action: { label: "View parts history", href: `/parts?vehicle=${i.vehicleId}&component=${r.componentKey}` } });
  if (i.spendPrev12 !== null && i.spendLast12 !== null && i.spendPrev12 > 0 && i.spendLast12 > i.spendPrev12 * 1.25 && i.spendLast12 - i.spendPrev12 >= 200) {
    const pct = Math.round(((i.spendLast12 - i.spendPrev12) / i.spendPrev12) * 100);
    mk({ id: "spend-up", severity: "info", title: `Maintenance & repair spending up ${pct}%`, detail: `${i.fmtMoney(i.spendLast12)} in the last 12 months versus ${i.fmtMoney(i.spendPrev12)} in the 12 months before.`, basis: ["RECORDED_DATA"], action: { label: "See expenses", href: "/expenses" } });
  }
  for (const w of i.warranties) {
    const d = diffDays(w.endDate, i.today);
    if (d >= 0 && d <= 60) mk({ id: `war:${w.name}`, severity: "warning", title: `${w.name} warranty ends in ${humanizeDays(d)}`, detail: `Coverage ends ${w.endDate}. Consider an inspection to claim any covered issues before then.`, basis: ["RECORDED_DATA"], action: { label: "View warranties", href: `/vehicles/${i.vehicleId}?tab=warranty` } });
  }
  if (i.openIssues >= 3) mk({ id: "issues", severity: "warning", title: `${i.openIssues} outstanding issues`, detail: "Several reported issues are still unresolved.", basis: ["RECORDED_DATA"], action: { label: "Review issues", href: "/repairs" } });
  if (!i.hasOdometer) mk({ id: "no-odo", severity: "info", title: "Add your current odometer reading", detail: "Mileage-based schedules and cost-per-distance can't be calculated until at least one reading is recorded.", basis: [], action: { label: "Update mileage", href: `/vehicles/${i.vehicleId}?tab=odometer` } });
  const unknown = active.filter((s) => s.status === "UNKNOWN_HISTORY").length;
  if (unknown >= 5) mk({ id: "unknown", severity: "info", title: `${unknown} schedules have no recorded history`, detail: "Record when each item was last done (even approximately) so due dates can be calculated.", basis: [], action: { label: "Set up schedules", href: `/vehicles/${i.vehicleId}?tab=schedule` } });
  const sev = { critical: 0, warning: 1, info: 2 } as const;
  return out.sort((a, b) => sev[a.severity] - sev[b.severity]);
}
