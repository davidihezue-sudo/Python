// Registered account contribution room (pure). The person enters the room CRA shows them at the start of the year; the app tracks what they have contributed since.
import { D, ZERO, money, type DecLike } from "./decimal";

export type RegisteredKind = "RRSP" | "TFSA" | "FHSA";
export const REGISTERED_KINDS: RegisteredKind[] = ["RRSP", "TFSA", "FHSA"];

/** Reference limits as published by the Canada Revenue Agency. Editable data, shown as a reference only: the figure that governs you is on your CRA notice of assessment. */
export const REGISTERED_LIMITS: Record<number, { TFSA: string; RRSPDollarLimit: string; FHSAAnnual: string; FHSALifetime: string }> = {
  2024: { TFSA: "7000", RRSPDollarLimit: "31560", FHSAAnnual: "8000", FHSALifetime: "40000" },
  2025: { TFSA: "7000", RRSPDollarLimit: "32490", FHSAAnnual: "8000", FHSALifetime: "40000" },
  2026: { TFSA: "7000", RRSPDollarLimit: "33810", FHSAAnnual: "8000", FHSALifetime: "40000" },
};
export const LIMITS_SOURCE = "Reference figures from the Canada Revenue Agency for each year. Check canada.ca or your CRA My Account, which is the figure that governs you.";
/** Over-contribution tolerated for an RRSP before the 1 percent monthly tax applies. */
const RRSP_BUFFER = "2000";

export interface RoomInput { kind: RegisteredKind; openingRoom: DecLike; contributed: DecLike; withdrawn: DecLike }
export interface RoomResult {
  kind: RegisteredKind;
  openingRoom: string;
  contributed: string;
  remaining: string;
  overBy: string;
  percentUsed: string;
  status: "ok" | "near" | "over";
  estimatedMonthlyTax: string;
  restoresNextYear: string;
  notes: string[];
}

export function registeredRoom(i: RoomInput): RoomResult {
  const open = D(i.openingRoom), contrib = D(i.contributed), withdrawn = D(i.withdrawn);
  const remaining = open.minus(contrib);
  const overBy = remaining.lt(0) ? remaining.negated() : ZERO;
  const taxable = i.kind === "RRSP" ? (overBy.gt(RRSP_BUFFER) ? overBy.minus(RRSP_BUFFER) : ZERO) : overBy;
  const pct = open.gt(0) ? contrib.div(open).times(100) : contrib.gt(0) ? D(100) : ZERO;
  const notes: string[] = [];
  if (i.kind === "TFSA" && withdrawn.gt(0)) notes.push(`Withdrawals of ${money(withdrawn)} this year are added back to your room on 1 January of next year, not sooner.`);
  if (i.kind === "RRSP" && overBy.gt(0)) notes.push(`An RRSP excess of up to $${RRSP_BUFFER} is tolerated. Beyond that, a tax of 1 percent a month applies.`);
  if (i.kind !== "RRSP" && overBy.gt(0)) notes.push("An excess contribution is taxed at 1 percent a month until it is withdrawn. Withdraw the excess promptly.");
  if (i.kind === "FHSA") notes.push("The FHSA also has a lifetime limit and allows a limited carry-forward. Enter the room your CRA statement shows.");
  return {
    kind: i.kind, openingRoom: money(open), contributed: money(contrib), remaining: money(remaining), overBy: money(overBy), percentUsed: pct.toDecimalPlaces(1).toString(),
    status: taxable.gt(0) || (i.kind !== "RRSP" && overBy.gt(0)) ? "over" : overBy.gt(0) || pct.gte(90) ? "near" : "ok",
    estimatedMonthlyTax: money(taxable.times("0.01")), restoresNextYear: i.kind === "TFSA" ? money(withdrawn) : "0.00", notes,
  };
}

/** The RRSP deduction limit is 18 percent of last year's earned income, up to the dollar limit. A planning helper only. */
export function rrspLimitFromIncome(priorYearEarnedIncome: DecLike, year: number): string | null {
  const lim = REGISTERED_LIMITS[year];
  if (!lim) return null;
  const eighteen = D(priorYearEarnedIncome).times("0.18");
  return money(eighteen.gt(lim.RRSPDollarLimit) ? D(lim.RRSPDollarLimit) : eighteen);
}
