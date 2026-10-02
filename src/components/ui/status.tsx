import { Badge } from "./primitives";
import { titleCase } from "@/lib/client/utils";

type Tone = "neutral" | "primary" | "success" | "warning" | "danger" | "info";
const SCHEDULE: Record<string, [string, Tone]> = {
  UP_TO_DATE: ["Up to date", "success"],
  UPCOMING: ["Upcoming", "info"],
  DUE_SOON: ["Due soon", "warning"],
  DUE_NOW: ["Due now", "warning"],
  OVERDUE: ["Overdue", "danger"],
  INSPECTION_REQUIRED: ["Inspection required", "warning"],
  UNKNOWN_HISTORY: ["Unknown history", "neutral"],
};
export function ScheduleStatusBadge({ status }: { status: string }) {
  const [label, tone] = SCHEDULE[status] ?? [titleCase(status), "neutral" as Tone];
  return <Badge tone={tone}>{label}</Badge>;
}
const SEVERITY: Record<string, Tone> = { LOW: "neutral", MODERATE: "info", HIGH: "warning", CRITICAL: "danger" };
export const SeverityBadge = ({ severity }: { severity: string }) => <Badge tone={SEVERITY[severity] ?? "neutral"}>{titleCase(severity)}</Badge>;
const ISSUE: Record<string, Tone> = { NEW: "danger", INVESTIGATING: "warning", DIAGNOSED: "warning", AWAITING_PARTS: "warning", SCHEDULED: "info", IN_REPAIR: "info", RESOLVED: "success", MONITORING: "primary", CLOSED: "neutral" };
export const IssueStatusBadge = ({ status }: { status: string }) => <Badge tone={ISSUE[status] ?? "neutral"}>{titleCase(status)}</Badge>;
const REC: Record<string, Tone> = { DRAFT: "neutral", SCHEDULED: "info", IN_PROGRESS: "warning", COMPLETED: "success", CANCELLED: "danger" };
export const RecordStatusBadge = ({ status }: { status: string }) => <Badge tone={REC[status] ?? "neutral"}>{titleCase(status)}</Badge>;
export const SOURCE_LABEL: Record<string, string> = { MANUFACTURER: "Manufacturer data", SUGGESTED: "Generic suggestion", USER_DEFINED: "Your own schedule" };
export const BASIS_LABEL: Record<string, string> = { USER_SCHEDULE: "your schedule", MANUFACTURER: "manufacturer data", HISTORICAL_DRIVING: "your driving history", GENERAL_SUGGESTION: "generic suggestion", RECORDED_DATA: "recorded data" };
