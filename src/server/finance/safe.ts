// "Safe to spend": everyday money minus what is already committed before the next pay day, per day.
import { z } from "zod";
import { db } from "@/lib/db";
import { ZERO } from "./engine/decimal";
import { addDays, endOfMonth } from "./engine/dates";
import { safeToSpend } from "./engine/safespend";
import { visWhere, type FinCtx } from "./access";
import { currentBalance } from "./accounts";
import { obligations } from "./calendar";
import { nonNegMoney } from "./common";

export const safeQuery = z.object({ view: z.enum(["my", "household"]).default("my"), buffer: nonNegMoney.optional() });

export async function safeSpend(ctx: FinCtx, q: z.infer<typeof safeQuery>) {
  const accounts = await db.finAccount.findMany({ where: { householdId: ctx.householdId, deletedAt: null, status: "ACTIVE", type: { in: ["CHEQUING", "CASH"] }, ...visWhere(ctx, q.view) } });
  let cash = ZERO;
  const skipped: string[] = [];
  for (const a of accounts) {
    if (a.currency !== ctx.base) { skipped.push(a.name); continue; }
    cash = cash.plus(await currentBalance(ctx.householdId, a));
  }
  const ahead = await obligations(ctx, addDays(ctx.today, 1), addDays(ctx.today, 45), q.view);
  const nextPay = ahead.filter((o) => o.kind === "INCOME").map((o) => o.date).sort()[0] ?? null;
  const horizonEnd = nextPay ? addDays(nextPay, -1) : endOfMonth(ctx.today);
  const today = ctx.today;
  const committedAll = (await obligations(ctx, today, horizonEnd, q.view)).filter((o) => o.direction === "out" && o.amount && !o.completed && o.status !== "PAID");
  const committed = committedAll.map((o) => ({ date: o.date, amount: o.amount as string, label: o.title }));
  const r = safeToSpend({ cash: cash.toFixed(2), committed, today, horizonEnd, buffer: q.buffer ?? 0 });
  return {
    view: q.view, currency: ctx.base, asOf: today, nextPayday: nextPay, horizonEnd, ...r,
    basis: [
      `Counts chequing and cash accounts${q.view === "my" ? " you own" : " shared with the household"}${skipped.length ? ` (left out for a different currency: ${skipped.join(", ")})` : ""}.`,
      "Subtracts bills, subscriptions, insurance, loan and credit card payments and savings contributions that fall due before your next pay day.",
      nextPay ? `The next pay day found is ${nextPay}.` : "No upcoming pay day is recorded, so the end of the month is used.",
      "It does not know about spending you have not recorded. Treat it as a guide, not a guarantee.",
    ],
  };
}
