// Lifecycle rules for records and issues.
export type RecordStatus = "DRAFT" | "SCHEDULED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
export type IssueStatus = "NEW" | "INVESTIGATING" | "DIAGNOSED" | "AWAITING_PARTS" | "SCHEDULED" | "IN_REPAIR" | "RESOLVED" | "MONITORING" | "CLOSED";

const RECORD_FLOW: Record<RecordStatus, RecordStatus[]> = {
  DRAFT: ["SCHEDULED", "IN_PROGRESS", "COMPLETED", "CANCELLED"],
  SCHEDULED: ["DRAFT", "IN_PROGRESS", "COMPLETED", "CANCELLED"],
  IN_PROGRESS: ["SCHEDULED", "COMPLETED", "CANCELLED"],
  COMPLETED: ["IN_PROGRESS"],
  CANCELLED: ["DRAFT", "SCHEDULED"],
};
export const canTransitionRecord = (from: RecordStatus, to: RecordStatus) => from === to || RECORD_FLOW[from].includes(to);

const ISSUE_ORDER: IssueStatus[] = ["NEW", "INVESTIGATING", "DIAGNOSED", "AWAITING_PARTS", "SCHEDULED", "IN_REPAIR", "RESOLVED", "MONITORING", "CLOSED"];
export const ISSUE_STATUSES = ISSUE_ORDER;
/** Closed issues can only be reopened (to NEW); otherwise any status may be chosen as work is rarely linear. */
export function canTransitionIssue(from: IssueStatus, to: IssueStatus) {
  if (from === to) return true;
  if (from === "CLOSED") return to === "NEW";
  return true;
}
export const isOpenIssue = (s: IssueStatus) => !["RESOLVED", "CLOSED"].includes(s);
export const isUnresolvedIssue = (s: IssueStatus) => !["RESOLVED", "CLOSED", "MONITORING"].includes(s);
