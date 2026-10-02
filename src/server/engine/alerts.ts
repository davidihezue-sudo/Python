import { diffDays, humanizeDays, type IsoDate } from "@/lib/dates";
import { describeDue, type Evaluation } from "./schedule";
import { formatDistance, type DistanceUnit } from "@/lib/units";

export interface AlertCandidate {
  type:
    | "MAINTENANCE_UPCOMING"
    | "MAINTENANCE_DUE"
    | "MAINTENANCE_OVERDUE"
    | "WARRANTY_EXPIRING"
    | "REGISTRATION_EXPIRING"
    | "INSURANCE_RENEWAL"
    | "INSPECTION_DUE"
    | "REPAIR_OUTSTANDING"
    | "BUDGET_THRESHOLD"
    | "CUSTOM_REMINDER"
    | "DOCUMENT_EXPIRING";
  severity: "INFO" | "WARNING" | "CRITICAL";
  title: string;
  body: string;
  vehicleId: string;
  actionUrl: string;
  /** Stable key — one notification per (user, dedupeKey). */
  dedupeKey: string;
}

export interface AlertPrefs {
  alertKmBefore: number[];
  alertDaysBefore: number[];
  alertOnDue: boolean;
  alertOnOverdue: boolean;
}

/**
 * Determines the single most advanced alert stage reached for a maintenance item, or null if none.
 * Stages: pre:<kmThreshold>:<dayThreshold> → due → overdue. The key embeds the due cycle so a completed
 * service (new due point) re-arms the alerts, while repeated job runs never duplicate.
 */
export function maintenanceAlert(args: {
  assignmentId: string;
  vehicleId: string;
  vehicleName: string;
  itemName: string;
  evaluation: Evaluation;
  prefs: AlertPrefs;
  override?: { km?: number[]; days?: number[] };
  unit: DistanceUnit;
}): AlertCandidate | null {
  const { evaluation: ev, prefs } = args;
  if (ev.status === "UNKNOWN_HISTORY" || ev.status === "UP_TO_DATE" && ev.remainingKm === null && ev.remainingDays === null) return null;
  const cycle = `${ev.nextDueKm ?? "-"}|${ev.nextDueDate ?? "-"}`;
  const base = `maint:${args.assignmentId}:${cycle}`;
  const url = `/vehicles/${args.vehicleId}?tab=schedule`;
  const desc = describeDue(ev, args.unit);
  if (ev.status === "OVERDUE") {
    if (!prefs.alertOnOverdue) return null;
    return { type: "MAINTENANCE_OVERDUE", severity: "CRITICAL", title: `${args.itemName} is overdue`, body: `${args.vehicleName}: ${desc}.`, vehicleId: args.vehicleId, actionUrl: url, dedupeKey: `${base}:overdue` };
  }
  if (ev.status === "INSPECTION_REQUIRED") {
    return { type: "MAINTENANCE_DUE", severity: "WARNING", title: `${args.itemName}: inspection required`, body: `${args.vehicleName}: ${desc}.`, vehicleId: args.vehicleId, actionUrl: url, dedupeKey: `${base}:inspect` };
  }
  if (ev.status === "DUE_NOW") {
    if (!prefs.alertOnDue) return null;
    return { type: "MAINTENANCE_DUE", severity: "WARNING", title: `${args.itemName} is due now`, body: `${args.vehicleName}: ${desc}.`, vehicleId: args.vehicleId, actionUrl: url, dedupeKey: `${base}:due` };
  }
  const kmList = [...(args.override?.km?.length ? args.override.km : prefs.alertKmBefore)].sort((a, b) => a - b);
  const dayList = [...(args.override?.days?.length ? args.override.days : prefs.alertDaysBefore)].sort((a, b) => a - b);
  const tk = ev.remainingKm !== null ? kmList.find((t) => (ev.remainingKm as number) <= t) : undefined;
  const td = ev.remainingDays !== null ? dayList.find((t) => (ev.remainingDays as number) <= t) : undefined;
  if (tk === undefined && td === undefined) return null;
  const bits: string[] = [];
  if (tk !== undefined && ev.remainingKm !== null) bits.push(`${formatDistance(ev.remainingKm, args.unit)} remaining`);
  if (td !== undefined && ev.remainingDays !== null) bits.push(`${humanizeDays(ev.remainingDays)} remaining`);
  return {
    type: "MAINTENANCE_UPCOMING",
    severity: "INFO",
    title: `${args.itemName} coming up`,
    body: `${args.vehicleName}: ${bits.join(", ")}.`,
    vehicleId: args.vehicleId,
    actionUrl: url,
    dedupeKey: `${base}:pre:${tk ?? "-"}:${td ?? "-"}`,
  };
}

export function dateAlert(args: {
  kind: "WARRANTY_EXPIRING" | "REGISTRATION_EXPIRING" | "INSURANCE_RENEWAL" | "INSPECTION_DUE" | "CUSTOM_REMINDER" | "DOCUMENT_EXPIRING";
  id: string;
  label: string;
  vehicleId: string;
  vehicleName: string;
  date: IsoDate;
  today: IsoDate;
  leadDays?: number[];
  actionUrl: string;
}): AlertCandidate | null {
  const days = diffDays(args.date, args.today);
  const leads = [...(args.leadDays?.length ? args.leadDays : [30, 7])].sort((a, b) => a - b);
  let stage: string | null = null;
  let severity: AlertCandidate["severity"] = "INFO";
  let when: string;
  if (days < 0) {
    stage = "past";
    severity = "CRITICAL";
    when = `expired ${humanizeDays(days)} ago`;
  } else if (days === 0) {
    stage = "today";
    severity = "WARNING";
    when = "is today";
  } else {
    const lead = leads.find((l) => days <= l);
    if (lead === undefined) return null;
    stage = `lead:${lead}`;
    severity = days <= 7 ? "WARNING" : "INFO";
    when = `in ${humanizeDays(days)}`;
  }
  const verb = { WARRANTY_EXPIRING: "Warranty", REGISTRATION_EXPIRING: "Registration", INSURANCE_RENEWAL: "Insurance renewal", INSPECTION_DUE: "Inspection", CUSTOM_REMINDER: "Reminder", DOCUMENT_EXPIRING: "Document" }[args.kind];
  const title = args.kind === "CUSTOM_REMINDER" ? `${args.label}` : `${verb}: ${args.label}`;
  return {
    type: args.kind,
    severity,
    title,
    body: `${args.vehicleName}: ${args.label} ${days < 0 ? when : days === 0 ? "is today" : `is due ${when}`} (${args.date}).`,
    vehicleId: args.vehicleId,
    actionUrl: args.actionUrl,
    dedupeKey: `${args.kind}:${args.id}:${args.date}:${stage}`,
  };
}

export function budgetAlert(args: { budgetId: string; label: string; vehicleId: string; periodKey: string; utilizationPct: number; thresholds: number[]; actual: number; amount: number; currencyFmt: (n: number) => string }): AlertCandidate | null {
  const crossed = [...args.thresholds].sort((a, b) => a - b).filter((t) => args.utilizationPct >= t);
  if (!crossed.length) return null;
  const t = crossed[crossed.length - 1];
  const exceeded = args.utilizationPct >= 100;
  return {
    type: "BUDGET_THRESHOLD",
    severity: exceeded ? "CRITICAL" : "WARNING",
    title: exceeded ? `Budget exceeded: ${args.label}` : `Budget at ${t}%: ${args.label}`,
    body: `${args.currencyFmt(args.actual)} of ${args.currencyFmt(args.amount)} used (${args.utilizationPct.toFixed(0)}%).`,
    vehicleId: args.vehicleId,
    actionUrl: "/expenses?tab=budgets",
    dedupeKey: `budget:${args.budgetId}:${args.periodKey}:${t}`,
  };
}
