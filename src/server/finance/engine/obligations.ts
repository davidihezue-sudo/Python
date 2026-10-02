// Bill status and scheduled obligation helpers (pure).
import { D, ZERO, type Dec as DecT, type DecLike } from "./decimal";
import { diffDays, type IsoDate } from "./dates";

export type BillStatus = "PAID" | "PARTIAL" | "OVERDUE" | "UNPAID" | "UPCOMING";
/**
 * PAID when payments cover the amount; PARTIAL when something but not everything was paid;
 * OVERDUE when unpaid and past due; UNPAID when due today or within the reminder window; UPCOMING when further out.
 */
export function billStatus(p: { amount: DecLike; paid: DecLike; dueDate: IsoDate; today: IsoDate; leadDays?: number }): BillStatus {
  const amount = D(p.amount),
    paid = D(p.paid);
  if (amount.gt(0) && paid.gte(amount)) return "PAID";
  if (paid.gt(0)) return p.dueDate < p.today ? "OVERDUE" : "PARTIAL";
  if (p.dueDate < p.today) return "OVERDUE";
  return diffDays(p.dueDate, p.today) <= (p.leadDays ?? 3) ? "UNPAID" : "UPCOMING";
}
export const outstanding = (amount: DecLike, paid: DecLike): DecT => {
  const r = D(amount).minus(D(paid));
  return r.isNegative() ? ZERO : r;
};

export type ObligationKind = "INCOME" | "BILL" | "MORTGAGE" | "LOAN" | "CREDIT_CARD" | "INSURANCE" | "INSURANCE_RENEWAL" | "SUBSCRIPTION" | "SAVINGS" | "GOAL" | "CUSTOM" | "RECURRING";
export interface Obligation {
  key: string;
  date: IsoDate;
  kind: ObligationKind;
  title: string;
  amount: string | null;
  direction: "in" | "out" | "neutral";
  sourceType: string;
  sourceId: string;
  status?: string;
  ownerMemberId?: string | null;
  completed?: boolean;
  note?: string | null;
}
export const sortObligations = (xs: Obligation[]) => [...xs].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.direction === b.direction ? a.title.localeCompare(b.title) : a.direction === "in" ? -1 : 1));
