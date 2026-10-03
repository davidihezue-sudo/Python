// Planning and insight: retirement, RESP, sinking funds, subscription watch, year in review and the monthly money review.
import { z } from "zod";
import { db } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { logger } from "@/lib/logger";
import { actorFromUser } from "../context";
import { D, Dec, ZERO, money } from "./engine/decimal";
import { addMonths, endOfMonth } from "./engine/dates";
import { projectRetirement } from "./engine/retirement";
import { planResp } from "./engine/resp";
import { sinkingNeed } from "./engine/sinking";
import { findDuplicates, findUntracked, normName, priceChange } from "./engine/subwatch";
import { finCtx, visWhere, type FinCtx } from "./access";
import { nonNegMoney, toDate } from "./common";
import { summarise, trend } from "./analytics";
import { netWorth, listInvestments } from "./wealth";
import { listGoals } from "./goals";
import { listSubscriptions } from "./bills";
import { budgetReport } from "./budgets";
import { obligations } from "./calendar";

const age = z.number().int().min(0).max(110);
const pct = z.number().min(-20).max(30);

// ───────────── retirement and RESP: nothing is stored, the person just plays with the numbers
export const retirementSchema = z.object({
  currentAge: age, retireAge: age, lifeAge: age.default(95), savings: nonNegMoney, monthlyContribution: nonNegMoney, returnPct: pct, inflationPct: pct.default(2),
  annualSpending: nonNegMoney, benefitIncome: nonNegMoney.default("0.00"), benefitAge: age.optional(), withdrawalPct: z.number().min(1).max(10).default(4),
}).refine((v) => v.retireAge >= v.currentAge, { message: "The retirement age cannot be before your age now", path: ["retireAge"] })
  .refine((v) => v.lifeAge > v.retireAge, { message: "The planning age must be after the retirement age", path: ["lifeAge"] });
export const projectRetirementNow = async (_ctx: FinCtx, i: z.infer<typeof retirementSchema>) => projectRetirement(i as never);

/** Starting point for the retirement page: the member's own investment accounts, in the household currency. */
export async function retirementDefaults(ctx: FinCtx) {
  const inv = await listInvestments(ctx, "my");
  const savings = inv.items.filter((i) => i.currency === ctx.base).reduce((a, i) => a.plus(D(i.currentValue)), ZERO);
  return { currency: ctx.base, savings: money(savings), basis: "The latest values of the investment accounts you own, in the household currency." };
}

export const respSchema = z.object({ childAge: z.number().int().min(0).max(17), balance: nonNegMoney.default("0.00"), annualContribution: nonNegMoney, returnPct: pct, grantsReceived: nonNegMoney.default("0.00"), carryForwardYears: z.number().int().min(0).max(18).optional() });
export const planRespNow = async (_ctx: FinCtx, i: z.infer<typeof respSchema>) => planResp(i as never);

// ───────────── sinking funds: goals with a date, expressed as "put this aside each month"
export const viewQ = z.object({ view: z.enum(["my", "household", "all"]).default("all") });
export async function sinkingFunds(ctx: FinCtx, q: z.infer<typeof viewQ>) {
  const { items } = await listGoals(ctx, q.view);
  const rows = items.filter((g) => g.status === "ACTIVE" && g.targetDate && g.tracking === "CONTRIBUTIONS" && D(g.target).gt(0)).map((g) => ({ g, n: sinkingNeed({ target: g.target, saved: g.current, dueDate: g.targetDate as string, today: ctx.today, plannedMonthly: g.monthlyContribution }) }));
  const list = rows.map(({ g, n }) => ({ id: g.id, name: g.name, kind: g.kind, target: g.target, saved: g.current, dueDate: g.targetDate, plannedMonthly: g.monthlyContribution, ...n })).sort((a, b) => (a.dueDate! < b.dueDate! ? -1 : 1));
  const total = list.filter((x) => x.status !== "funded" && x.status !== "overdue").reduce((a, x) => a.plus(x.perMonth), ZERO);
  return { items: list, totalPerMonth: money(total), currency: ctx.base, note: "Each fund is a savings goal with a due date that tracks contributions. Add one under Savings and goals, or here." };
}

// ───────────── subscription watch
export async function subscriptionWatch(ctx: FinCtx, q: z.infer<typeof viewQ>) {
  const { items: subs } = await listSubscriptions(ctx, q.view);
  const since = toDate(addMonths(ctx.today, -18));
  const txs = await db.finTransaction.findMany({ where: { householdId: ctx.householdId, deletedAt: null, type: "EXPENSE", status: "POSTED", date: { gte: since }, ...visWhere(ctx, q.view) }, select: { date: true, amount: true, description: true, merchant: { select: { name: true } } } });
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const chargeFor = (key: string) => txs.filter((t) => { const k = normName(t.merchant?.name ?? t.description); return k && key && (k.includes(key) || key.includes(k)); }).map((t) => ({ date: iso(t.date), amount: D(t.amount).abs().toFixed(2) }));

  const duplicates = findDuplicates(subs.map((s) => ({ id: s.id, name: s.name, provider: s.provider, amount: s.amount, active: s.active })));
  type Rise = { id: string; name: string; source: string; from: string; to: string; since: string | null; change: string; percent: string; yearlyImpact: string };
  const increases: Rise[] = subs.filter((s) => s.active).flatMap((s): Rise[] => {
    const pc = priceChange(chargeFor(normName(s.name)));
    const manual = s.priceIncrease ? ({ from: s.priceIncrease.from, to: s.priceIncrease.to } as { from: string; to: string }) : null;
    if (pc) return [{ id: s.id, name: s.name, source: "ledger", ...pc }];
    return manual ? [{ id: s.id, name: s.name, source: "price history", from: manual.from, to: manual.to, since: null, change: money(D(manual.to).minus(manual.from)), percent: D(manual.from).gt(0) ? D(manual.to).minus(manual.from).div(manual.from).times(100).toDecimalPlaces(1).toString() : "0", yearlyImpact: money(D(manual.to).minus(manual.from).times(12)) }] : [];
  });
  const byMerchant = new Map<string, { merchant: string; charges: { date: string; amount: string }[] }>();
  for (const t of txs) {
    const name = t.merchant?.name; if (!name) continue;
    const g = byMerchant.get(name) ?? { merchant: name, charges: [] };
    g.charges.push({ date: iso(t.date), amount: D(t.amount).abs().toFixed(2) });
    byMerchant.set(name, g);
  }
  const untracked = findUntracked([...byMerchant.values()], subs.map((s) => ({ id: s.id, name: s.name, amount: s.amount, active: s.active })));
  return { duplicates, increases, untracked, totalYearlyImpact: money(increases.reduce((a: Dec, i) => a.plus(D(i.yearlyImpact)), ZERO)), currency: ctx.base, note: "Matching uses names in your ledger, so it works best when the merchant or description includes the service name." };
}

// ───────────── year in review
export const yearQ = z.object({ view: z.enum(["my", "household"]).default("household"), year: z.coerce.number().int().min(2000).max(2100).optional() });
export async function yearInReview(ctx: FinCtx, q: z.infer<typeof yearQ>) {
  const year = q.year ?? Number(ctx.today.slice(0, 4));
  const from = `${year}-01-01`, to = `${year}-12-31` > ctx.today ? ctx.today : `${year}-12-31`;
  const [s, t, nw, goals] = await Promise.all([
    summarise(ctx, q.view, from, to), trend(ctx, q.view, from, to), netWorth(ctx, { view: q.view, months: 36 }),
    db.savingsGoal.findMany({ where: { householdId: ctx.householdId, deletedAt: null, completedAt: { gte: toDate(from), lte: toDate(to) }, ...visWhere(ctx, q.view) }, select: { name: true } }),
  ]);
  const series = t.series;
  const withNet = series.filter((m) => D(m.income).gt(0) || D(m.expenses).gt(0));
  const most = withNet.slice().sort((a, b) => D(b.expenses).comparedTo(D(a.expenses)))[0];
  const least = withNet.slice().sort((a, b) => D(a.expenses).comparedTo(D(b.expenses)))[0];
  const best = withNet.slice().sort((a, b) => D(b.net).comparedTo(D(a.net)))[0];
  const start = nw.history.find((h) => h.month === `${year - 1}-12`) ?? null, end = nw.history[nw.history.length - 1] ?? null;
  const nwChange = start && end ? D(end.netWorth).minus(start.netWorth) : null;
  const top = s.byCategory.slice(0, 5);
  const hl: string[] = [];
  hl.push(`You earned ${money(s.totals.income)} and spent ${money(s.totals.expenses)}.`);
  if (s.totals.savingsRate !== null) hl.push(`Your savings rate was ${D(s.totals.savingsRate).toDecimalPlaces(1).toString()} percent.`);
  if (top[0]) hl.push(`${top[0].name} was your biggest category at ${money(top[0].amount)}.`);
  if (most) hl.push(`Your highest spending month was ${most.month} (${money(most.expenses)}).`);
  if (nwChange) hl.push(`Net worth ${nwChange.gte(0) ? "grew" : "fell"} by ${money(nwChange.abs())} over the year.`);
  if (goals.length) hl.push(`You reached ${goals.length} goal${goals.length === 1 ? "" : "s"}: ${goals.map((g) => g.name).join(", ")}.`);
  return {
    view: q.view, year, from, to, partial: to !== `${year}-12-31`, currency: ctx.base, totals: s.totals, topCategories: top, months: series,
    highestSpendingMonth: most ?? null, lowestSpendingMonth: least ?? null, bestSavingsMonth: best ?? null,
    netWorth: { start: start?.netWorth ?? null, end: end?.netWorth ?? null, change: nwChange ? money(nwChange) : null }, goalsReached: goals.map((g) => g.name), highlights: hl,
  };
}

// ───────────── monthly money review
const monthRe = /^\d{4}-(0[1-9]|1[0-2])$/;
export const reviewQ = z.object({ view: z.enum(["my", "household"]).default("my"), month: z.string().regex(monthRe).optional() });
const label = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-CA", { month: "long", year: "numeric", timeZone: "UTC" });
export const previousMonth = (today: string) => addMonths(`${today.slice(0, 7)}-01`, -1).slice(0, 7);

export async function monthlyReview(ctx: FinCtx, q: z.infer<typeof reviewQ>) {
  const month = q.month ?? previousMonth(ctx.today);
  const from = `${month}-01`, to = endOfMonth(from);
  const pFrom = addMonths(from, -1), pTo = endOfMonth(pFrom);
  const [cur, prev] = await Promise.all([summarise(ctx, q.view, from, to), summarise(ctx, q.view, pFrom, pTo)]);
  const budgets = await db.finBudget.findMany({ where: { householdId: ctx.householdId, deletedAt: null, active: true, startDate: { lte: toDate(to) }, endDate: { gte: toDate(from) }, OR: [{ scope: "HOUSEHOLD" }, { scope: "PERSONAL", ownerMemberId: ctx.me.id }] }, select: { id: true } });
  const tight: { budget: string; category: string; percentUsed: number; over: boolean }[] = [];
  for (const b of budgets) { const r = await budgetReport(ctx, b.id); for (const l of r.lines) if (l.percentUsed !== null && Number(l.percentUsed) >= 90) tight.push({ budget: r.name, category: l.category, percentUsed: Math.round(Number(l.percentUsed)), over: Number(l.percentUsed) > 100 }); }
  const big = await db.finTransaction.findMany({ where: { householdId: ctx.householdId, deletedAt: null, type: "EXPENSE", status: "POSTED", date: { gte: toDate(from), lte: toDate(to) }, ...visWhere(ctx, q.view) }, orderBy: { amount: "asc" }, take: 5, select: { description: true, amount: true, date: true } });
  const goals = await listGoals(ctx, q.view);
  const watch = await subscriptionWatch(ctx, { view: q.view });
  const ahead = (await obligations(ctx, ctx.today, addMonths(ctx.today, 1), q.view)).filter((o) => o.direction === "out" && o.amount && !o.completed).slice(0, 6);
  const d = (a: string, b: string) => D(a).minus(b);
  const hl: string[] = [];
  hl.push(`Income ${money(cur.totals.income)}, spending ${money(cur.totals.expenses)}, net ${money(cur.totals.netCashFlow)}.`);
  const dx = d(cur.totals.expenses, prev.totals.expenses);
  if (D(prev.totals.expenses).gt(0)) hl.push(`Spending ${dx.gte(0) ? "rose" : "fell"} ${money(dx.abs())} compared with the month before.`);
  if (cur.byCategory[0]) hl.push(`Biggest category: ${cur.byCategory[0].name} (${money(cur.byCategory[0].amount)}).`);
  for (const t of tight.slice(0, 3)) hl.push(`${t.category} is ${t.over ? "over" : "at " + t.percentUsed + " percent of"} its budget.`);
  if (watch.increases.length) hl.push(`${watch.increases.length} subscription price increase${watch.increases.length === 1 ? "" : "s"} noticed.`);
  return {
    view: q.view, month, label: label(month), from, to, currency: ctx.base, totals: cur.totals, previous: { month: pFrom.slice(0, 7), totals: prev.totals }, topCategories: cur.byCategory.slice(0, 5),
    budgetsTight: tight, biggestExpenses: big.map((b) => ({ description: b.description, amount: money(D(b.amount).abs()), date: b.date.toISOString().slice(0, 10) })),
    goals: { active: goals.summary.active, onTrack: goals.summary.onTrack, behind: goals.summary.behind }, subscriptionFlags: { increases: watch.increases.length, duplicates: watch.duplicates.length },
    upcoming: ahead.map((o) => ({ date: o.date, title: o.title, amount: o.amount })), highlights: hl,
  };
}

function reviewText(ctx: FinCtx, r: Awaited<ReturnType<typeof monthlyReview>>) {
  const m = (v: string) => `${r.currency} ${v}`;
  const L = [`Your money review for ${r.label}`, "", ...r.highlights.map((h) => `- ${h}`), ""];
  if (r.topCategories.length) { L.push("Top categories"); for (const c of r.topCategories) L.push(`  ${c.name}: ${m(c.amount)}`); L.push(""); }
  if (r.upcoming.length) { L.push("Coming up"); for (const u of r.upcoming) L.push(`  ${u.date}  ${u.title}  ${m(D(u.amount).abs().toFixed(2))}`); L.push(""); }
  L.push(r.view === "my" ? "This covers the records you own." : "This covers records shared with the household.", `Open the full review in the app: /monthly-review?month=${r.month}`);
  void ctx;
  return L.join("\n");
}
export async function emailMonthlyReview(ctx: FinCtx, q: z.infer<typeof reviewQ>) {
  const r = await monthlyReview(ctx, q);
  const sent = await sendEmail(ctx.actor.email, `Your ${r.label} money review`, reviewText(ctx, r));
  return { sentTo: ctx.actor.email, delivered: sent.delivered, note: sent.delivered ? "Sent." : "Email is not set up on this server, so the message was saved to the outbox instead." };
}

export const reviewSettingsSchema = z.object({ monthlyReview: z.boolean() });
export async function getReviewSettings(ctx: FinCtx) {
  const s = await db.finAlertSetting.upsert({ where: { userId_householdId: { userId: ctx.actor.id, householdId: ctx.householdId } }, create: { userId: ctx.actor.id, householdId: ctx.householdId }, update: {} });
  return { monthlyReview: s.monthlyReview, lastSent: s.lastMonthlyReview };
}
export async function updateReviewSettings(ctx: FinCtx, p: z.infer<typeof reviewSettingsSchema>) {
  await db.finAlertSetting.upsert({ where: { userId_householdId: { userId: ctx.actor.id, householdId: ctx.householdId } }, create: { userId: ctx.actor.id, householdId: ctx.householdId, monthlyReview: p.monthlyReview }, update: { monthlyReview: p.monthlyReview } });
  return getReviewSettings(ctx);
}

/** Background job: on the first days of a month, email last month's review to everyone who opted in, once each. */
export async function sendDueMonthlyReviews(now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  if (Number(today.slice(8, 10)) > 5) return { due: 0, sent: 0, failed: 0 };
  const month = previousMonth(today);
  const rows = await db.finAlertSetting.findMany({ where: { monthlyReview: true, OR: [{ lastMonthlyReview: null }, { lastMonthlyReview: { not: month } }] }, take: 500 });
  let sent = 0, failed = 0;
  for (const s of rows) {
    try {
      const user = await db.user.findFirst({ where: { id: s.userId, disabledAt: null, deletedAt: null }, include: { preference: true } });
      if (!user) continue;
      const ctx = await finCtx(actorFromUser(user as never), s.householdId);
      await emailMonthlyReview(ctx, { view: "my", month });
      await db.finAlertSetting.update({ where: { id: s.id }, data: { lastMonthlyReview: month } });
      sent++;
    } catch (e) { failed++; logger.warn({ err: (e as Error).message }, "monthly review failed"); }
  }
  return { due: rows.length, sent, failed };
}
export { Dec };
