// Financial assistant. Deterministic: it recognises a set of questions, retrieves real figures through the same permission
// scoped services as the rest of the app, shows how it calculated them, and never invents data. No external AI service is
// required. Because it reads through the actor's view, it cannot reveal another member's private records.
import { z } from "zod";
import { D, money, ZERO } from "./engine/decimal";
import { addDays, endOfMonth, monthBounds, startOfMonth, addMonths, resolveRange } from "./engine/dates";
import { projectGoal } from "./engine/savings";
import { runScenario } from "./engine/scenario";
import { type FinCtx, type View } from "./access";
import { summarise } from "./analytics";
import { listDebts } from "./debts";
import { listSubscriptions } from "./bills";
import { obligations } from "./calendar";
import { listGoals, emergencyPlan } from "./goals";
import { netWorth } from "./wealth";
import { incomeSummary } from "./income";
import { buildBaseline } from "./forecasts";
import { loadCategories } from "./load";

export const askSchema = z.object({ question: z.string().trim().min(2).max(500), view: z.enum(["my", "household"]).optional() });
interface Figure { label: string; value: string; kind: "actual" | "estimate" }
export interface Answer { answer: string; period: { from: string; to: string; label: string } | null; view: View; figures: Figure[]; explanation: string; kind: "actual" | "estimate" | "mixed" | "help"; note: string | null }

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const moneyNum = (s: string) => Number(s.replace(/[$,\s]/g, ""));

function parsePeriod(q: string, today: string): { from: string; to: string; label: string } {
  const m = MONTHS.findIndex((x) => new RegExp(`\\b${x}\\b`).test(q));
  const yr = /\b(20\d{2})\b/.exec(q)?.[1];
  if (m >= 0) {
    let y = Number(yr ?? today.slice(0, 4));
    if (!yr && `${y}-${String(m + 1).padStart(2, "0")}` > today.slice(0, 7)) y -= 1; // "in September" means the most recent September
    const b = monthBounds(`${y}-${String(m + 1).padStart(2, "0")}`);
    return { ...b, label: `${MONTHS[m][0].toUpperCase()}${MONTHS[m].slice(1)} ${y}` };
  }
  const n = /last\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+months?/.exec(q);
  if (n) { const k = Number(n[1]) || WORDS[n[1]]; return { from: addMonths(startOfMonth(today), -k), to: endOfMonth(addMonths(startOfMonth(today), -1)), label: `The last ${k} full months` }; }
  if (/last month|previous month/.test(q)) return resolveRange("previous_month", today);
  if (/this week|next 7 days|next seven days/.test(q)) return { from: today, to: addDays(today, 7), label: "The next 7 days" };
  if (/year to date|ytd|this year/.test(q)) return resolveRange("year_to_date", today);
  if (/last year/.test(q)) { const y = Number(today.slice(0, 4)) - 1; return { from: `${y}-01-01`, to: `${y}-12-31`, label: `${y}` }; }
  return resolveRange("current_month", today);
}

export async function ask(ctx: FinCtx, input: z.infer<typeof askSchema>): Promise<Answer> {
  const q = input.question.toLowerCase().replace(/[?]/g, "");
  const view: View = input.view ?? (/\b(i|my|me|mine)\b/.test(q) && !/\b(we|our|us)\b/.test(q) ? "my" : "household");
  const period = parsePeriod(q, ctx.today);
  const scopeNote = view === "household" ? "Includes only records shared with the household (or with you). Private records are never used." : "Uses only records you own.";
  const mk = (a: Partial<Answer> & Pick<Answer, "answer" | "explanation" | "figures">): Answer => ({ period: null, view, kind: "actual", note: scopeNote, ...a });
  const cur = ctx.base;

  // 1. top categories
  if (/(top|largest|biggest|main)\s*(\d+|one|two|three|four|five|six|seven|eight|nine|ten)?\s*(expense )?categor/.test(q)) {
    const nMatch = /(\d+|one|two|three|four|five|six|seven|eight|nine|ten)/.exec(q.replace(/.*(top|largest|biggest|main)/, ""));
    const n = nMatch ? Number(nMatch[1]) || WORDS[nMatch[1]] || 5 : 5;
    const s = await summarise(ctx, view, period.from, period.to);
    const top = s.byCategory.slice(0, n);
    return mk({ period, answer: top.length ? `Your ${top.length} largest expense categories for ${period.label} were ${top.map((c) => `${c.name} (${c.amount})`).join(", ")}. Total expenses were ${s.totals.expenses} ${cur}.` : `No expenses are recorded for ${period.label}.`, figures: top.map((c) => ({ label: c.name, value: `${c.amount} ${cur}`, kind: "actual" as const })), explanation: "Net spending per top level category (purchases minus refunds and reimbursements), highest first. Transfers and credit card payments are excluded." });
  }
  // 2. what we spent on <category>
  const spentOn = /(?:spend|spent|spending|paid|pay)\b.*?\b(?:on|for|in)\s+(?!january|february|march|april|may|june|july|august|september|october|november|december)([a-z][a-z &'-]{2,40}?)(?:\s+(?:last|this|in|during|over|for)\b.*)?$/.exec(q);
  if (spentOn && !/save|saving/.test(q)) {
    const term = spentOn[1].trim().replace(/\s+(last|this)$/, "");
    const cats = await loadCategories(ctx);
    const hit = cats.find((c) => c.kind === "EXPENSE" && (c.name.toLowerCase() === term || c.name.toLowerCase().startsWith(term) || term.startsWith(c.name.toLowerCase().slice(0, 5)) || c.name.toLowerCase().includes(term)));
    if (hit) {
      const s = await summarise(ctx, view, period.from, period.to);
      const row = s.bySubcategory.find((c) => c.categoryId === hit.id);
      const parentRow = !hit.parentId ? s.byCategory.find((c) => c.categoryId === hit.id) : null;
      const amt = (parentRow?.amount ?? row?.amount ?? "0.00");
      return mk({ period, answer: `${view === "household" ? "The household" : "You"} spent ${amt} ${cur} on ${hit.name} during ${period.label}.`, figures: [{ label: hit.name, value: `${amt} ${cur}`, kind: "actual" }, { label: "All expenses in period", value: `${s.totals.expenses} ${cur}`, kind: "actual" }], explanation: `Sum of expense transactions in ${hit.name}${hit.parentId ? "" : " and its subcategories"} between ${period.from} and ${period.to}, less refunds. Each expense is counted once.` });
    }
  }
  // 3. savings in a period
  if (/\b(save|saved|savings)\b/.test(q) && /(how much|what).*(save|saved)/.test(q) && !/(need|monthly|each month|per month|target|deposit|goal)/.test(q)) {
    const s = await summarise(ctx, view, period.from, period.to);
    return mk({ period, answer: `For ${period.label}, income was ${s.totals.income} ${cur} and expenses were ${s.totals.expenses} ${cur}, so ${D(s.totals.netCashFlow).gte(0) ? "about " + s.totals.netCashFlow : "spending exceeded income by " + money(D(s.totals.netCashFlow).abs())} ${cur} was ${D(s.totals.netCashFlow).gte(0) ? "left over" : "drawn from savings or credit"}${s.totals.savingsRate ? ` (a savings rate of ${s.totals.savingsRate}%)` : ""}.`, figures: [{ label: "Income", value: `${s.totals.income} ${cur}`, kind: "actual" }, { label: "Expenses", value: `${s.totals.expenses} ${cur}`, kind: "actual" }, { label: "Left over", value: `${s.totals.netCashFlow} ${cur}`, kind: "actual" }], explanation: "Left over = income minus expenses for the period. It is not the same as money moved into a savings account, because transfers are excluded from both. Check the Savings page for deposits." });
  }
  // 4. debt
  if (/\b(debt|debts|owe|owing|liabilit)/.test(q) && /(how much|total|what)/.test(q)) {
    const d = await listDebts(ctx, view);
    return mk({ answer: `${view === "household" ? "The household currently owes" : "You currently owe"} ${d.totals.totalDebt} ${cur} across ${d.items.filter((i) => i.active && D(i.outstanding).gt(0)).length} debts, with about ${d.totals.monthlyPayments} ${cur} in monthly payments.`, figures: [...d.items.filter((i) => i.active && D(i.outstanding).gt(0)).map((i) => ({ label: i.name, value: `${i.outstanding} ${i.currency}`, kind: "actual" as const })), { label: "Monthly payments", value: `${d.totals.monthlyPayments} ${cur}`, kind: "estimate" }], explanation: "Outstanding balances come from each debt's ledger account as of today. Monthly payments convert each regular payment to a monthly amount." });
  }
  // 5. subscriptions
  if (/subscription/.test(q)) {
    const s = await listSubscriptions(ctx, view);
    return mk({ answer: `Active subscriptions cost ${s.totals.monthly} ${cur} a month (${s.totals.annual} ${cur} a year) across ${s.totals.activeCount} subscriptions.${s.flagged.length ? ` ${s.flagged.length} are flagged for a price increase or review.` : ""}`, figures: [{ label: "Monthly", value: `${s.totals.monthly} ${cur}`, kind: "estimate" }, { label: "Annual", value: `${s.totals.annual} ${cur}`, kind: "estimate" }], explanation: "Each active subscription is converted to a monthly average from its billing frequency. Annual = twelve times the monthly figure.", kind: "estimate" });
  }
  // 6. bills due
  if (/\bbills?\b/.test(q) && /(due|upcoming|this week|next)/.test(q)) {
    const to = addDays(ctx.today, 7);
    const o = (await obligations(ctx, ctx.today, to, view)).filter((x) => x.kind === "BILL" && !x.completed);
    return mk({ period: { from: ctx.today, to, label: "The next 7 days" }, answer: o.length ? `${o.length} bill${o.length === 1 ? " is" : "s are"} due in the next 7 days: ${o.map((b) => `${b.title} ${b.amount} on ${b.date}`).join("; ")}.` : "No unpaid bills are due in the next 7 days.", figures: o.map((b) => ({ label: `${b.title} (${b.date})`, value: `${b.amount} ${cur}`, kind: "actual" as const })), explanation: "Unpaid occurrences of recorded bills with due dates between today and seven days from now." });
  }
  // 7. required monthly savings for a goal
  if (/(how much).*(save|need).*(month|monthly)/.test(q) || /(deposit|down payment|goal|target).*(month|monthly)/.test(q)) {
    const goals = await listGoals(ctx, view);
    const words = q.split(/\W+/).filter((w) => w.length > 3);
    const g = goals.items.find((x) => words.some((w) => x.name.toLowerCase().includes(w) || x.kind.toLowerCase().includes(w))) ?? (/deposit|down payment|house|home/.test(q) ? goals.items.find((x) => x.kind === "HOME_DOWN_PAYMENT") : undefined) ?? (goals.items.length === 1 ? goals.items[0] : undefined);
    if (g && g.targetDate) {
      const p = projectGoal({ target: g.target, current: g.current, monthly: g.monthlyContribution, targetDate: g.targetDate, today: ctx.today });
      return mk({ answer: `To reach "${g.name}" (${g.target} ${cur}) by ${g.targetDate} you need to save about ${p.requiredMonthly ? money(p.requiredMonthly) : "n/a"} ${cur} a month. ${g.current} ${cur} is saved so far; at the current plan of ${g.monthlyContribution} ${cur} a month it would be reached around ${p.estimatedCompletion ?? "an unknown date"}.`, figures: [{ label: "Remaining", value: `${g.remaining} ${cur}`, kind: "actual" }, { label: "Required per month", value: `${p.requiredMonthly ? money(p.requiredMonthly) : "n/a"} ${cur}`, kind: "estimate" }, { label: "Current plan per month", value: `${g.monthlyContribution} ${cur}`, kind: "actual" }], explanation: "Required monthly = remaining amount divided by the months left until the target date, rounded up to the cent. It does not include interest.", kind: "mixed" });
    }
    if (g) return mk({ answer: `"${g.name}" has no target date, so a required monthly amount cannot be calculated. ${g.current} of ${g.target} ${cur} is saved.`, figures: [], explanation: "Add a target date to the goal to see the required monthly contribution.", kind: "help" });
  }
  // 8. income change what-if
  const pctM = /(\d+(?:\.\d+)?)\s*%/.exec(q);
  if (/(what happens|what if|suppose|if)\b/.test(q) && /income/.test(q) && pctM) {
    const dir = /(decrease|drop|fall|fell|reduce|lower|lose|cut|down)/.test(q) ? -1 : 1;
    const base = await buildBaseline(ctx, { view, savingsInterestPct: 0, investmentReturnPct: 0, assetGrowthPct: 0, varMonths: 3 });
    const r = runScenario(base, [{ type: "INCOME_CHANGE", target: "ALL", mode: "PCT", value: dir * Number(pctM[1]) }], { months: 12 });
    return mk({ answer: `If ${view === "household" ? "household" : "your"} income ${dir < 0 ? "fell" : "rose"} by ${pctM[1]}%, estimated monthly cash flow would change by ${money(r.difference.monthlyCashFlow)} ${cur} and net worth after 12 months would be ${money(r.difference.netWorth)} ${cur} ${dir < 0 ? "lower" : "higher"} than the current path.`, figures: [{ label: "Monthly cash flow change", value: `${money(r.difference.monthlyCashFlow)} ${cur}`, kind: "estimate" }, { label: "Net worth change after 12 months", value: `${money(r.difference.netWorth)} ${cur}`, kind: "estimate" }, { label: "Cash at end of 12 months", value: `${money(r.simulated.end.liquid)} ${cur}`, kind: "estimate" }], explanation: "A what-if forecast on a copy of your data: scheduled income is scaled and everything else is unchanged. Real records are not altered. This is an estimate, not a prediction.", kind: "estimate" });
  }
  // 9. reduce spending by $N
  const red = /(reduce|cut|lower|spend (?:\$?\d+ )?less on)\b.*?(restaurants?|groceries|entertainment|travel|clothing|subscriptions|[a-z ]{3,25}?)\s*(?:spending )?by\s*\$?([\d,]+(?:\.\d+)?)/.exec(q);
  if (red) {
    const amt = moneyNum(red[3]);
    const cats = await loadCategories(ctx);
    const t = red[2].trim();
    const hit = cats.find((c) => c.kind === "EXPENSE" && !c.parentId && (c.name.toLowerCase().startsWith(t.replace(/s$/, "")) || t.startsWith(c.name.toLowerCase().slice(0, 5))));
    let current: string | null = null;
    if (hit) { const s = await summarise(ctx, view, addMonths(startOfMonth(ctx.today), -3), endOfMonth(addMonths(startOfMonth(ctx.today), -1))); current = money(D(s.byCategory.find((c) => c.categoryId === hit.id)?.amount ?? 0).div(3)); }
    return mk({ answer: `Cutting ${hit?.name ?? red[2]} by ${money(amt)} ${cur} a month would save ${money(amt)} ${cur} a month, or ${money(amt * 12)} ${cur} over 12 months.${current && D(current).gt(0) ? ` You have been spending about ${current} ${cur} a month there${amt > Number(current) ? ", so that reduction is larger than your current spending" : ""}.` : ""}`, figures: [{ label: "Saved per month", value: `${money(amt)} ${cur}`, kind: "estimate" }, { label: "Saved over 12 months", value: `${money(amt * 12)} ${cur}`, kind: "estimate" }, ...(current ? [{ label: `Recent average in ${hit?.name}`, value: `${current} ${cur}`, kind: "actual" as const }] : [])], explanation: "Saving = the reduction you named multiplied by twelve. The recent average is the last three full months of spending in that category.", kind: "estimate" });
  }
  // 10. afford a purchase
  const afford = /afford.*?\$?([\d,]{3,}(?:\.\d+)?)/.exec(q) ?? /\$\s*([\d,]{3,}(?:\.\d+)?).*afford/.exec(q);
  if (afford) {
    const price = D(moneyNum(afford[1]));
    const [em, nw, inc] = await Promise.all([emergencyPlan(ctx, { view, months: "3,6", planMonths: 12 } as never), netWorth(ctx, { view, months: 2 }), incomeSummary(ctx, view)]);
    const cash = D(nw.lines.filter((l) => l.side === "asset" && (l.group === "cash" || l.group === "savings")).reduce((a, l) => a.plus(D(l.value)), ZERO));
    const after = cash.minus(price);
    const ess = D(em.essentialMonthly);
    const months = ess.gt(0) ? after.div(ess).toDecimalPlaces(1) : null;
    return mk({ answer: `Paying ${money(price)} ${cur} from cash and savings would leave ${money(after)} ${cur}${months ? `, about ${months.toString()} months of essential spending` : ""}. ${after.isNegative() ? "That is more than your cash and savings." : months && months.lt(3) ? "That would leave less than three months of essential spending covered." : "Your emergency cushion would remain at or above three months."}`, figures: [{ label: "Cash and savings today", value: `${money(cash)} ${cur}`, kind: "actual" }, { label: "After purchase", value: `${money(after)} ${cur}`, kind: "estimate" }, { label: "Essential spending per month", value: `${em.essentialMonthly} ${cur}`, kind: "estimate" }, { label: "Monthly net income", value: `${inc.combinedMonthlyNet} ${cur}`, kind: "estimate" }], explanation: "Compares the price with cash and savings account balances, and expresses what is left in months of essential spending (categories marked essential, averaged over the last three full months). Whether to buy is your decision: it ignores financing, tax and your other plans.", kind: "mixed" });
  }
  // 11. net worth
  if (/net worth/.test(q)) {
    const n = await netWorth(ctx, { view, months: 13 });
    return mk({ answer: `${view === "household" ? "Household" : "Your"} net worth is ${n.netWorth} ${cur}: assets of ${n.assets} ${cur} minus liabilities of ${n.liabilities} ${cur}.${n.monthOverMonth ? ` That is ${n.monthOverMonth.change} ${cur} compared with last month.` : ""}`, figures: [{ label: "Assets", value: `${n.assets} ${cur}`, kind: "actual" }, { label: "Liabilities", value: `${n.liabilities} ${cur}`, kind: "actual" }, { label: "Net worth", value: `${n.netWorth} ${cur}`, kind: "actual" }], explanation: "Net worth = total assets minus total liabilities as of today. Investments use their latest manual valuation; property and vehicles use their latest recorded valuation." });
  }
  // 12. income
  if (/\b(income|earn|earning|salary|salaries)\b/.test(q)) {
    const [s, inc] = await Promise.all([summarise(ctx, view, period.from, period.to), incomeSummary(ctx, view)]);
    return mk({ period, answer: `Income received in ${period.label} was ${s.totals.income} ${cur}. Expected recurring income is ${inc.combinedMonthlyNet} ${cur} net and ${inc.combinedMonthlyGross} ${cur} gross per month.`, figures: [{ label: "Received in period (net)", value: `${s.totals.income} ${cur}`, kind: "actual" }, { label: "Expected monthly net", value: `${inc.combinedMonthlyNet} ${cur}`, kind: "estimate" }, { label: "Expected monthly gross", value: `${inc.combinedMonthlyGross} ${cur}`, kind: "estimate" }], explanation: "Received = income transactions in the period. Expected figures convert each income source to a monthly average from its pay frequency. Gross and net are never added together.", kind: "mixed" });
  }
  // 13. emergency fund
  if (/emergency/.test(q)) {
    const e = await emergencyPlan(ctx, { view, months: "3,6", planMonths: 12 } as never);
    return mk({ answer: `Savings accounts hold ${e.currentEmergencySavings} ${cur}, which covers about ${e.coverageMonths ?? "n/a"} months of essential spending (${e.essentialMonthly} ${cur} a month).${e.targets[1] ? ` A six month target is ${e.targets[1].amount} ${cur}.` : ""}`, figures: [{ label: "Savings", value: `${e.currentEmergencySavings} ${cur}`, kind: "actual" }, { label: "Essential spending per month", value: `${e.essentialMonthly} ${cur}`, kind: "estimate" }, { label: "Coverage", value: `${e.coverageMonths ?? "n/a"} months`, kind: "estimate" }], explanation: e.note, kind: "mixed" });
  }
  // 14. expenses overall
  if (/\b(expenses?|spend|spent|spending)\b/.test(q)) {
    const s = await summarise(ctx, view, period.from, period.to);
    return mk({ period, answer: `Expenses for ${period.label} were ${s.totals.expenses} ${cur} against income of ${s.totals.income} ${cur}.`, figures: [{ label: "Expenses", value: `${s.totals.expenses} ${cur}`, kind: "actual" }, { label: "Income", value: `${s.totals.income} ${cur}`, kind: "actual" }], explanation: "Expenses are counted once, net of refunds, with transfers and settlements excluded." });
  }
  return mk({ answer: "I can answer questions about your recorded finances, but I did not recognise that one. Try one of the examples below.", figures: [], explanation: "I only answer from your actual records and I do not guess. Supported topics: spending by category, top categories, savings in a month, debt, subscriptions, bills due, savings goals, income, net worth, emergency fund, affordability, and what-if questions about income or spending.", kind: "help", note: scopeNote });
}
export const EXAMPLE_QUESTIONS = ["How much did we spend on groceries last month?", "What are our five largest expense categories?", "How much debt do we currently have?", "How much do we pay in subscriptions every month?", "What bills are due this week?", "What happens if our household income decreases by 20%?", "How much would we save if we reduced restaurant spending by $150 per month?", "Can we afford a $4,000 purchase?", "How much money did we save in September?", "What is our net worth?"];
export { monthBounds };
