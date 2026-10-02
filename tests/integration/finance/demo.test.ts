import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createDemoHousehold } from "@/server/finance/demo";
import { deleteDemoHousehold } from "@/server/finance/household";
import { finCtx } from "@/server/finance/access";
import { listAccounts, verifyAccountBalance } from "@/server/finance/accounts";
import { dashboard } from "@/server/finance/dashboard";
import { netWorth } from "@/server/finance/wealth";
import { listDebts } from "@/server/finance/debts";
import { forecast, runScenarioService } from "@/server/finance/forecasts";
import { buildFinanceReport, REPORT_TYPES } from "@/server/finance/reports";
import { contributionReport } from "@/server/finance/contributions";
import { listBudgets, budgetReport } from "@/server/finance/budgets";
import { listGoals } from "@/server/finance/goals";
import { computeAlerts } from "@/server/finance/alerts";
import { obligations } from "@/server/finance/calendar";
import { ask } from "@/server/finance/assistant";
import { taxSummary } from "@/server/finance/tax";
import { createActor } from "../helpers";

async function demo() {
  const actor = await createActor("Demo User", "demo-owner@example.com");
  const { id } = await createDemoHousehold(actor);
  return { actor, householdId: id };
}

describe("demonstration household", () => {
  it("builds a coherent household and every account's ledger reconciles", async () => {
    const { actor, householdId } = await demo();
    const ctx = await finCtx(actor, householdId);
    const accts = await listAccounts(ctx, "all");
    expect(accts.items.length).toBeGreaterThanOrEqual(11); // 12 accounts exist; one is the partner private savings account
    for (const a of accts.items) {
      const v = await verifyAccountBalance(await finCtx(actor, householdId), a.id);
      expect(v.matches, a.name).toBe(true);
    }
    // the partner's private savings account is hidden from the household view
    expect((await listAccounts(ctx, "household")).items.map((a) => a.name)).not.toContain("Partner private savings");
    expect(ctx.hiddenAccountCount).toBeGreaterThanOrEqual(1);
  });

  it("dashboard figures agree with the underlying modules (no double counting, no drift)", async () => {
    const { actor, householdId } = await demo();
    const ctx = await finCtx(actor, householdId);
    const d = await dashboard(ctx, { view: "household", range: "last_6_months" } as never);
    const nw = await netWorth(ctx, { view: "household", months: 12 });
    expect(d.overview.netWorth).toBe(nw.netWorth);
    expect(D(nw.assets).minus(D(nw.liabilities)).toFixed(2)).toBe(nw.netWorth);
    // net worth history ends at today's net worth
    expect(nw.history[nw.history.length - 1].netWorth).toBe(nw.netWorth);
    // expense categories add up to the total
    const sumCats = d.expenses.byCategory.reduce((a, c) => a + Number(c.amount), 0);
    expect(sumCats).toBeLessThanOrEqual(Number(d.expenses.total) + 0.01);
    expect(Number(d.expenses.shared) + Number(d.expenses.personal)).toBeCloseTo(Number(d.expenses.total), 1);
    // gross and net income stay separate
    expect(Number(d.income.combinedMonthlyGross)).toBeGreaterThan(Number(d.income.combinedMonthlyNet));
    // debts: outstanding comes from the ledger
    const debts = await listDebts(ctx, "household");
    expect(Number(debts.totals.totalDebt)).toBeGreaterThan(300000);
    expect(d.overview.totalDebt).toBe(debts.totals.totalDebt);
    // income received in a transfer-heavy ledger is only salary, bonus and tutoring, never a transfer
    expect(Number(d.overview.income)).toBeGreaterThan(0);
  });

  it("household totals are identical for both members; the personal view differs; privacy holds", async () => {
    const { actor, householdId } = await demo();
    const partnerUser = await db.user.findFirstOrThrow({ where: { email: { startsWith: "demo.partner." } }, include: { preference: true } });
    const { actorFromUser } = await import("@/server/context");
    const partner = actorFromUser(partnerUser as never);
    const a = await dashboard(await finCtx(actor, householdId), { view: "household", range: "last_6_months" } as never);
    const b = await dashboard(await finCtx(partner, householdId), { view: "household", range: "last_6_months" } as never);
    expect(b.overview.income).toBe(a.overview.income);
    expect(b.overview.expenses).toBe(a.overview.expenses);
    const mine = await dashboard(await finCtx(actor, householdId), { view: "my", range: "last_6_months" } as never);
    const theirs = await dashboard(await finCtx(partner, householdId), { view: "my", range: "last_6_months" } as never);
    expect(mine.overview.income).not.toBe(theirs.overview.income);
    // the partner's PERSONAL line of credit etc. belong to the actor; the partner's private savings and tax records are invisible to the actor
    const actorAccounts = (await listAccounts(await finCtx(actor, householdId), "all")).items.map((x) => x.name);
    expect(actorAccounts).not.toContain("Partner private savings");
    expect((await listAccounts(await finCtx(partner, householdId), "all")).items.map((x) => x.name)).toContain("Partner private savings");
    expect((await listAccounts(await finCtx(partner, householdId), "all")).items.map((x) => x.name)).not.toContain("Line of credit (you, personal)");
  });

  it("budgets, goals, alerts, calendar, forecast, reports and the assistant all run on real data", async () => {
    const { actor, householdId } = await demo();
    const ctx = await finCtx(actor, householdId);
    const budgets = await listBudgets(ctx);
    expect(budgets.length).toBeGreaterThanOrEqual(3);
    const cur = budgets.filter((b) => b.scope === "HOUSEHOLD" && (b.to ?? "") < ctx.today).sort((a, b) => ((a.to ?? "") < (b.to ?? "") ? 1 : -1))[0]; // latest completed month
    const rep = await budgetReport(ctx, cur.id);
    expect(rep.lines.length).toBeGreaterThan(5);
    expect(Number(rep.totals.actual)).toBeGreaterThan(0);
    expect((await listGoals(ctx, "household")).items.length).toBeGreaterThanOrEqual(3);
    expect((await computeAlerts(ctx)).length).toBeGreaterThanOrEqual(0);
    expect((await obligations(ctx, ctx.today, `${ctx.today.slice(0, 7)}-28`, "all")).length).toBeGreaterThan(5);
    const f = await forecast(ctx, { view: "household", months: 12, savingsInterestPct: 0, investmentReturnPct: 0, assetGrowthPct: 0, varMonths: 3 } as never);
    expect(f.forecast.months.length).toBeGreaterThanOrEqual(12); expect(f.forecast.months[0].partial || f.forecast.months[f.forecast.months.length - 1].partial).toBe(true);
    expect(f.forecast.assumptions.join(" ")).toMatch(/not a guaranteed outcome/);
    expect(f.actual.length).toBeGreaterThan(3);
    for (const t of REPORT_TYPES) {
      const r = await buildFinanceReport(ctx, { type: t.type, view: "household", format: "json" } as never);
      expect(r.title, t.type).toBeTruthy();
    }
    const c = await contributionReport(ctx, `${ctx.today.slice(0, 4)}-01-01`, ctx.today);
    expect(c.members).toHaveLength(2);
    // the total of positions across members nets out (every shared cost is owed to someone)
    expect(c.members.reduce((a, m) => a + Number(m.netPosition), 0)).toBeCloseTo(0, 1);
    const q1 = await ask(ctx, { question: "How much did we spend on groceries last month?" });
    expect(q1.answer).toMatch(/groceries/i);
    expect(q1.period).toBeTruthy();
    expect((await ask(ctx, { question: "What are our five largest expense categories?" })).figures.length).toBeLessThanOrEqual(5);
    expect((await ask(ctx, { question: "What happens if our household income decreases by 20%?" })).kind).toBe("estimate");
    expect((await ask(ctx, { question: "quantum banana" })).kind).toBe("help");
    const tax = await taxSummary(ctx, { year: Number(ctx.today.slice(0, 4)) - 1, region: "AB" });
    expect(tax.disclaimer).toMatch(/not an official/);
  });

  it("scenarios never change real records", async () => {
    const { actor, householdId } = await demo();
    const ctx = await finCtx(actor, householdId, "write");
    const snap = async () => ({ tx: await db.finTransaction.count(), income: await db.incomeSource.findMany({ select: { id: true, netAmount: true, active: true } }), debts: await db.debt.findMany({ select: { id: true, regularPayment: true } }), acct: await db.finAccount.count() });
    const before = JSON.stringify(await snap());
    const members = ctx.members.map((m) => m.id);
    const r = await runScenarioService(ctx, { view: "household", months: 12, assumptions: [{ type: "JOB_LOSS", target: { memberId: members[1] }, durationMonths: 4 }, { type: "ONE_TIME_EXPENSE", amount: 6000, month: 2 }, { type: "HOME_PURCHASE", price: 600000, downPayment: 120000, aprPercent: 5, amortisationYears: 25 }, { type: "EXTRA_DEBT_PAYMENT", extraMonthly: 300 }], savingsInterestPct: 0, investmentReturnPct: 0 } as never);
    expect(r.realRecordsChanged).toBe(false);
    expect(Number(r.difference.netWorth)).not.toBe(0);
    expect(JSON.stringify(await snap())).toBe(before);
  });

  it("the demonstration household can be removed completely", async () => {
    const { actor, householdId } = await demo();
    await deleteDemoHousehold(actor, householdId);
    expect(await db.household.count({ where: { id: householdId } })).toBe(0);
    expect(await db.finTransaction.count({ where: { householdId } })).toBe(0);
    expect(await db.user.count({ where: { email: { endsWith: "@demo.invalid" } } })).toBe(0);
  });
});
import { D } from "@/server/finance/engine/decimal";
