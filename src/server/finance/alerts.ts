// Alerts. They are computed from the records the actor may see, so they never reveal another member's private information.
// The same alerts can be persisted as notifications (deduplicated) by the background job.
import { z } from "zod";
import { db } from "@/lib/db";
import { D, money, ZERO } from "./engine/decimal";
import { addDays, addMonths, diffDays, endOfMonth, startOfMonth } from "./engine/dates";
import { audit } from "../services/audit";
import { requireWriter, finCtx, type FinCtx } from "./access";
import { loadBooks, loadReportTxs } from "./load";
import { balances, isLiabilityType, isLiquidType } from "./engine/ledger";
import { billOccurrences } from "./bills";
import { listBudgets, budgetReport } from "./budgets";
import { listGoals } from "./goals";
import { listDebts } from "./debts";
import { listInsurance, listSubscriptions } from "./bills";
import { netExpense } from "./analytics";
import type { Actor } from "../context";

export interface Alert { id: string; type: string; severity: "INFO" | "WARNING" | "CRITICAL"; title: string; body: string; actionUrl: string; date: string }

export const alertSettingsSchema = z.object({ billsDue: z.boolean(), overdue: z.boolean(), budget: z.boolean(), unusual: z.boolean(), lowBalance: z.boolean(), savings: z.boolean(), debtDue: z.boolean(), insurance: z.boolean(), subscriptions: z.boolean(), leadDays: z.number().int().min(0).max(60), budgetThresholdPct: z.number().int().min(10).max(100), lowBalanceThreshold: z.union([z.string(), z.number()]), unusualMultiplier: z.union([z.string(), z.number()]), frequency: z.enum(["IMMEDIATE", "DAILY", "WEEKLY"]), inApp: z.boolean(), email: z.boolean() }).partial();

export async function getAlertSettings(ctx: FinCtx) {
  const s = await db.finAlertSetting.upsert({ where: { userId_householdId: { userId: ctx.actor.id, householdId: ctx.householdId } }, create: { userId: ctx.actor.id, householdId: ctx.householdId }, update: {} });
  return { billsDue: s.billsDue, overdue: s.overdue, budget: s.budget, unusual: s.unusual, lowBalance: s.lowBalance, savings: s.savings, debtDue: s.debtDue, insurance: s.insurance, subscriptions: s.subscriptions, leadDays: s.leadDays, budgetThresholdPct: s.budgetThresholdPct, lowBalanceThreshold: money(s.lowBalanceThreshold), unusualMultiplier: s.unusualMultiplier.toString(), frequency: s.frequency, inApp: s.inApp, email: s.email };
}
export async function updateAlertSettings(ctx: FinCtx, patch: z.infer<typeof alertSettingsSchema>) {
  await db.finAlertSetting.upsert({ where: { userId_householdId: { userId: ctx.actor.id, householdId: ctx.householdId } }, create: { userId: ctx.actor.id, householdId: ctx.householdId, ...(patch as object) }, update: patch as never });
  return getAlertSettings(ctx);
}

export async function computeAlerts(ctx: FinCtx): Promise<Alert[]> {
  const st = await getAlertSettings(ctx);
  const out: Alert[] = [];
  const today = ctx.today, lead = st.leadDays;
  const link = (p: string) => `/${p}`;

  if (st.billsDue || st.overdue) {
    const occ = await billOccurrences(ctx, addDays(today, -45), addDays(today, Math.max(lead, 1)), "all");
    for (const o of occ) {
      if (o.status === "PAID") continue;
      if (o.status === "OVERDUE" && st.overdue) out.push({ id: `bill-overdue:${o.billId}:${o.date}`, type: "BILL_OVERDUE", severity: "CRITICAL", title: `${o.name} is overdue`, body: `Due ${o.date}. ${money(D(o.amount).minus(D(o.paid)))} remaining.`, actionUrl: link("bills"), date: o.date });
      else if (o.status !== "OVERDUE" && st.billsDue && diffDays(o.date, today) <= lead) out.push({ id: `bill-due:${o.billId}:${o.date}`, type: "BILL_DUE", severity: "WARNING", title: `${o.name} is due ${o.date === today ? "today" : `on ${o.date}`}`, body: `${o.amount} due.`, actionUrl: link("bills"), date: o.date });
    }
  }
  if (st.budget) {
    const budgets = (await listBudgets(ctx)).filter((b) => b.current && b.active);
    for (const b of budgets) {
      const r = await budgetReport(ctx, b.id);
      for (const l of r.lines) {
        if (l.state === "over") out.push({ id: `budget-over:${b.id}:${l.categoryId}`, type: "BUDGET_THRESHOLD", severity: "CRITICAL", title: `${l.category} is over budget`, body: `${l.actual} spent of ${l.available} (${b.name}).`, actionUrl: `/budgets?id=${b.id}`, date: today });
        else if (l.percentUsed && Number(l.percentUsed) >= st.budgetThresholdPct) out.push({ id: `budget-near:${b.id}:${l.categoryId}`, type: "BUDGET_THRESHOLD", severity: "WARNING", title: `${l.category} is at ${Math.round(Number(l.percentUsed))}% of its budget`, body: `${l.remaining} remains in ${b.name}.`, actionUrl: `/budgets?id=${b.id}`, date: today });
        else if (l.forecastOver) out.push({ id: `budget-pace:${b.id}:${l.categoryId}`, type: "BUDGET_THRESHOLD", severity: "INFO", title: `${l.category} is on pace to exceed its budget`, body: `Forecast ${l.forecast} against ${l.available}.`, actionUrl: `/budgets?id=${b.id}`, date: today });
      }
    }
  }
  if (st.lowBalance) {
    const books = await loadBooks(ctx);
    const bal = balances(books.ledgerAccounts, books.balanceTxs, today);
    for (const a of books.accounts) if (a.status === "ACTIVE" && isLiquidType(a.type) && !isLiabilityType(a.type)) {
      const v = bal.get(a.id) ?? ZERO;
      if (v.lt(D(st.lowBalanceThreshold))) out.push({ id: `low:${a.id}:${startOfMonth(today)}`, type: "LOW_BALANCE", severity: v.isNegative() ? "CRITICAL" : "WARNING", title: `${a.name} balance is low`, body: `Balance ${money(v)} is below your ${st.lowBalanceThreshold} alert level.`, actionUrl: "/accounts", date: today });
    }
  }
  if (st.unusual) {
    const { txs } = await loadReportTxs(ctx, addMonths(startOfMonth(today), -6), today, "all");
    const byCat = new Map<string, number[]>();
    for (const t of txs) { const ne = netExpense(t); if (ne && ne.gt(0) && t.categoryId) (byCat.get(t.categoryId) ?? byCat.set(t.categoryId, []).get(t.categoryId)!).push(ne.toNumber()); }
    const mult = Number(st.unusualMultiplier);
    for (const t of txs) {
      const ne = netExpense(t);
      if (!ne || ne.lte(50) || !t.categoryId || t.date < addDays(today, -14)) continue;
      const hist = (byCat.get(t.categoryId) ?? []).filter((x) => x !== ne.toNumber()).sort((a, b) => a - b);
      if (hist.length < 5) continue;
      const median = hist[Math.floor(hist.length / 2)];
      if (ne.toNumber() > median * mult) out.push({ id: `unusual:${t.id}`, type: "UNUSUAL_SPENDING", severity: "INFO", title: "Unusually large transaction", body: `${t.description ?? "A transaction"} on ${t.date} was ${money(ne)}, about ${(ne.toNumber() / median).toFixed(1)} times the usual amount for this category.`, actionUrl: `/transactions?focus=${t.id}`, date: t.date });
    }
    // month so far versus the average of the previous three months
    const { txs: cur } = await loadReportTxs(ctx, startOfMonth(today), today, "all");
    const { txs: prev } = await loadReportTxs(ctx, addMonths(startOfMonth(today), -3), endOfMonth(addMonths(startOfMonth(today), -1)), "all");
    const tot = (xs: typeof cur) => xs.reduce((a, t) => a.plus(netExpense(t) ?? ZERO), ZERO);
    const avg = tot(prev).div(3);
    const dayFrac = Number(today.slice(8, 10)) / Number(endOfMonth(today).slice(8, 10));
    if (avg.gt(500) && dayFrac > 0.3 && tot(cur).gt(avg.times(dayFrac).times(1.4))) out.push({ id: `spend-up:${startOfMonth(today)}`, type: "UNUSUAL_SPENDING", severity: "WARNING", title: "Spending is running above your usual pace", body: `${money(tot(cur))} spent so far this month, compared with a usual ${money(avg.times(dayFrac))} by this point.`, actionUrl: "/dashboard", date: today });
  }
  if (st.savings) {
    const g = await listGoals(ctx, "all");
    for (const x of g.items) {
      if (x.progressStatus === "BEHIND") out.push({ id: `goal-behind:${x.id}`, type: "GOAL_BEHIND", severity: "WARNING", title: `${x.name} is behind schedule`, body: x.shortfallMonthly ? `About ${x.shortfallMonthly} more per month is needed to reach it by ${x.targetDate}.` : "The planned contribution will not reach the target by the target date.", actionUrl: "/goals", date: today });
      const pct = Number(x.percentComplete);
      for (const m of [25, 50, 75, 100]) if (pct >= m && pct < m + 15 && x.status !== "CANCELLED") out.push({ id: `goal-ms:${x.id}:${m}`, type: "SAVINGS_MILESTONE", severity: "INFO", title: m === 100 ? `${x.name} is fully funded` : `${x.name} reached ${m}%`, body: `${x.current} of ${x.target} saved.`, actionUrl: "/goals", date: today });
    }
  }
  if (st.debtDue) {
    const d = await listDebts(ctx, "all");
    for (const x of d.items) if (x.active && x.nextDueDate && D(x.outstanding).gt(0) && diffDays(x.nextDueDate, today) <= lead) out.push({ id: `debt:${x.id}:${x.nextDueDate}`, type: "DEBT_PAYMENT_DUE", severity: x.nextDueDate < today ? "CRITICAL" : "WARNING", title: `${x.name} payment ${x.nextDueDate < today ? "is overdue" : "is due"}`, body: `${x.regularPayment} due ${x.nextDueDate}.`, actionUrl: "/debts", date: x.nextDueDate });
  }
  if (st.insurance) {
    const i = await listInsurance(ctx, "all");
    for (const x of i.items) if (x.active && x.daysToRenewal !== null && x.daysToRenewal >= 0 && x.daysToRenewal <= Math.max(lead, 30)) out.push({ id: `ins:${x.id}:${x.renewalDate}`, type: "INSURANCE_POLICY_RENEWAL", severity: "INFO", title: `${x.policyName} renews in ${x.daysToRenewal} days`, body: `Premium ${x.premium}.`, actionUrl: "/insurance", date: x.renewalDate as string });
  }
  if (st.subscriptions) {
    const s = await listSubscriptions(ctx, "all");
    for (const x of s.items) if (x.active && x.nextBillingDate && diffDays(x.nextBillingDate, today) >= 0 && diffDays(x.nextBillingDate, today) <= lead) out.push({ id: `sub:${x.id}:${x.nextBillingDate}`, type: "SUBSCRIPTION_RENEWAL", severity: "INFO", title: `${x.name} renews ${x.nextBillingDate}`, body: `${x.amount} will be charged.`, actionUrl: "/subscriptions", date: x.nextBillingDate });
  }
  const rank = { CRITICAL: 0, WARNING: 1, INFO: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity] || (a.date < b.date ? -1 : 1));
}

/** Persists alerts as in-app notifications for the actor. Existing ones are not duplicated (dedupeKey). */
export async function refreshAlertNotifications(actor: Actor, householdId: string) {
  const ctx = await finCtx(actor, householdId);
  const st = await getAlertSettings(ctx);
  if (!st.inApp) return { created: 0 };
  const alerts = await computeAlerts(ctx);
  let created = 0;
  for (const a of alerts) {
    const key = `fin:${householdId}:${a.id}`;
    const exists = await db.notification.findUnique({ where: { userId_dedupeKey: { userId: actor.id, dedupeKey: key } } });
    if (exists) continue;
    await db.notification.create({ data: { userId: actor.id, householdId, type: a.type as never, severity: a.severity, title: a.title, body: a.body, actionUrl: a.actionUrl, dedupeKey: key, deliveredInAppAt: new Date() } });
    created++;
  }
  return { created };
}
export { requireWriter, audit };
