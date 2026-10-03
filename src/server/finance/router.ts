// REST route table for the finance API. Every route is dispatched through the shared route() wrapper (same-origin check, rate limit,
// body size limit, validation, error mapping). Household scoped routes resolve a FinCtx first, which enforces membership,
// role capability and record visibility on the server for every call.
import { z, type ZodTypeAny } from "zod";
import { NextResponse, type NextRequest } from "next/server";
import { route } from "@/lib/http";
import { AppError } from "@/lib/errors";
import type { Actor } from "../context";
import { assertAreaAllowed, finCtx, type FinCtx, type Need } from "./access";
import { pageQ, id, isoDate } from "./common";
import * as H from "./household";
import * as A from "./accounts";
import * as C from "./categories";
import * as T from "./transactions";
import * as I from "./income";
import * as B from "./bills";
import * as D from "./debts";
import * as G from "./goals";
import * as W from "./wealth";
import * as Bud from "./budgets";
import * as F from "./forecasts";
import * as Cal from "./calendar";
import * as Al from "./alerts";
import * as Dash from "./dashboard";
import * as Con from "./contributions";
import * as Tax from "./tax";
import * as P from "./planning";
import * as R from "./reports";
import * as Imp from "./imports";
import * as Doc from "./documents";
import * as As from "./assistant";
import * as Veh from "./vehicles";
import * as Hk from "./housekeeping";
import * as Rules from "./rules";
import * as Tags from "./tags";
import * as Safe from "./safe";
import * as Reg from "./registered";
import * as Insight from "./insight";
import * as Mile from "./mileage";
import * as FuelPost from "./fuelpost";
import * as People from "./people";
import * as Tok from "./tokens";
import * as Legacy from "./legacy";
import * as Hist from "./history";
import * as Rcpt from "./receipts";
import * as Pay from "./payday";
import * as Demo from "./demo";
import { analyticsQuery, getAnalytics, auditHistory, fxSchema, listFx, saveFx, deleteFx, exportMyData } from "./misc";
import { renderReport, REPORT_FORMATS, type ReportFormat } from "../services/report-render";

type Ctx = { ctx: FinCtx; actor: Actor; query: any; body: any; params: Record<string, string>; req: NextRequest };
interface Def { method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE"; path: string; need?: Need; query?: ZodTypeAny; body?: ZodTypeAny; status?: number; raw?: boolean; rate?: { limit: number; windowSec: number }; maxBody?: number; h: (c: Ctx) => Promise<unknown> }
const viewQ = z.object({ view: z.enum(["my", "household", "all"]).default("all") });
const viewQ2 = z.object({ view: z.enum(["my", "household"]).default("household") });
const rangeQ = z.object({ from: isoDate, to: isoDate });
const file = async (req: NextRequest) => {
  const form = await req.formData();
  const f = form.get("file");
  if (!(f instanceof File)) throw new AppError("VALIDATION_ERROR", "Attach a file in the 'file' field");
  return { form, file: { name: f.name, size: f.size, data: Buffer.from(await f.arrayBuffer()) } };
};
const download = (body: Buffer, name: string, mime: string, inline = false) => new Response(new Uint8Array(body), { headers: { "content-type": mime, "content-disposition": `${inline ? "inline" : "attachment"}; filename="${name}"`, "cache-control": "no-store", "x-content-type-options": "nosniff" } });

export const ROUTES: Def[] = [
  // ───── household
  { method: "GET", path: "/profile", h: ({ ctx }) => H.getProfile(ctx) },
  { method: "PATCH", path: "/profile", need: "admin", body: H.profileSchema.partial(), h: ({ ctx, body }) => H.updateProfile(ctx, body) },
  { method: "GET", path: "/members", h: ({ ctx }) => H.listMembers(ctx) },
  { method: "PATCH", path: "/members/:id", need: "write", body: H.memberPatchSchema, h: ({ ctx, params, body }) => H.updateMember(ctx, params.id, body) },
  { method: "PUT", path: "/sharing", need: "write", body: H.sharingSchema, h: ({ ctx, body }) => H.updateMySharing(ctx, body) },
  { method: "POST", path: "/clear-my-records", need: "write", body: Hk.clearMySchema, h: ({ ctx }) => Hk.clearMyRecords(ctx) },
  { method: "POST", path: "/delete-household", need: "admin", body: Hk.deleteHouseholdSchema, h: ({ ctx, body }) => Hk.deleteHousehold(ctx, body) },
  { method: "DELETE", path: "/demo", need: "admin", h: ({ ctx, actor }) => H.deleteDemoHousehold(actor, ctx.householdId) },
  // ───── accounts
  { method: "GET", path: "/accounts", query: viewQ, h: ({ ctx, query }) => A.listAccounts(ctx, query.view) },
  { method: "POST", path: "/accounts", need: "write", body: A.accountSchema, status: 201, h: ({ ctx, body }) => A.createAccount(ctx, body) },
  { method: "GET", path: "/accounts/:id", h: ({ ctx, params }) => A.getAccount(ctx, params.id) },
  { method: "PATCH", path: "/accounts/:id", need: "write", body: A.accountPatchSchema, h: ({ ctx, params, body }) => A.updateAccount(ctx, params.id, body) },
  { method: "DELETE", path: "/accounts/:id", need: "write", h: ({ ctx, params }) => A.deleteAccount(ctx, params.id) },
  { method: "POST", path: "/accounts/:id/balance", need: "write", body: A.balanceUpdateSchema, h: ({ ctx, params, body }) => A.setBalance(ctx, params.id, body) },
  { method: "POST", path: "/accounts/:id/reconcile", need: "write", body: A.reconcileSchema, h: ({ ctx, params, body }) => A.reconcile(ctx, params.id, body) },
  { method: "GET", path: "/accounts/:id/verify", h: ({ ctx, params }) => A.verifyAccountBalance(ctx, params.id) },
  // ───── categories and merchants
  { method: "GET", path: "/categories", h: ({ ctx }) => C.listCategories(ctx) },
  { method: "POST", path: "/categories", need: "write", body: C.categorySchema, status: 201, h: ({ ctx, body }) => C.createCategory(ctx, body) },
  { method: "PATCH", path: "/categories/:id", need: "write", body: C.categoryPatchSchema, h: ({ ctx, params, body }) => C.updateCategory(ctx, params.id, body) },
  { method: "DELETE", path: "/categories/:id", need: "write", h: ({ ctx, params }) => C.deleteCategory(ctx, params.id) },
  { method: "GET", path: "/merchants", query: z.object({ q: z.string().max(60).optional() }), h: ({ ctx, query }) => C.listMerchants(ctx, query.q) },
  // ───── transactions
  { method: "GET", path: "/transactions", query: T.txQuerySchema, h: ({ ctx, query }) => T.listTransactions(ctx, query) },
  { method: "POST", path: "/transactions", need: "write", body: T.txCreateSchema, status: 201, h: async ({ ctx, body }) => { const r = await T.createTransaction(ctx, body); return r.idempotentReplay ? r : { ...r, nudge: await Bud.budgetNudge(ctx, r.id) }; } },
  { method: "POST", path: "/transactions/bulk", need: "write", body: T.bulkSchema, h: ({ ctx, body }) => T.bulkUpdate(ctx, body) },
  { method: "POST", path: "/transfers", need: "write", body: T.transferSchema, status: 201, h: ({ ctx, body }) => T.createTransfer(ctx, body) },
  { method: "GET", path: "/transactions/:id", h: ({ ctx, params }) => T.getTransaction(ctx, params.id) },
  { method: "PATCH", path: "/transactions/:id", need: "write", body: T.txPatchSchema, h: ({ ctx, params, body }) => T.updateTransaction(ctx, params.id, body) },
  { method: "DELETE", path: "/transactions/:id", need: "write", h: ({ ctx, params }) => T.deleteTransaction(ctx, params.id) },
  { method: "POST", path: "/transactions/:id/duplicate", need: "write", body: z.object({ date: isoDate.optional() }), status: 201, h: ({ ctx, params, body }) => T.duplicateTransaction(ctx, params.id, body.date) },
  // ───── income
  { method: "GET", path: "/income", query: viewQ, h: ({ ctx, query }) => I.listIncome(ctx, query.view) },
  { method: "GET", path: "/income/summary", query: viewQ2, h: ({ ctx, query }) => I.incomeSummary(ctx, query.view) },
  { method: "POST", path: "/income", need: "write", body: I.incomeSchema, status: 201, h: ({ ctx, body }) => I.createIncome(ctx, body) },
  { method: "PATCH", path: "/income/:id", need: "write", body: I.incomePatchSchema, h: ({ ctx, params, body }) => I.updateIncome(ctx, params.id, body) },
  { method: "DELETE", path: "/income/:id", need: "write", h: ({ ctx, params }) => I.deleteIncome(ctx, params.id) },
  { method: "POST", path: "/income/:id/changes", need: "write", body: I.incomeChangeSchema, status: 201, h: ({ ctx, params, body }) => I.recordIncomeChange(ctx, params.id, body) },
  { method: "POST", path: "/income/:id/payments", need: "write", body: I.paymentSchema, status: 201, h: ({ ctx, params, body }) => I.recordIncomePayment(ctx, params.id, body) },
  // ───── bills, subscriptions, insurance, recurring
  { method: "GET", path: "/bills", query: viewQ, h: ({ ctx, query }) => B.listBills(ctx, query.view) },
  { method: "POST", path: "/bills", need: "write", body: B.billSchema, status: 201, h: ({ ctx, body }) => B.createBill(ctx, body) },
  { method: "PATCH", path: "/bills/:id", need: "write", body: B.billPatchSchema, h: ({ ctx, params, body }) => B.updateBill(ctx, params.id, body) },
  { method: "DELETE", path: "/bills/:id", need: "write", h: ({ ctx, params }) => B.deleteBill(ctx, params.id) },
  { method: "POST", path: "/bills/:id/pay", need: "write", body: B.billPaySchema, status: 201, h: ({ ctx, params, body }) => B.payBill(ctx, params.id, body) },
  { method: "GET", path: "/subscriptions", query: viewQ, h: ({ ctx, query }) => B.listSubscriptions(ctx, query.view) },
  { method: "POST", path: "/subscriptions", need: "write", body: B.subscriptionSchema, status: 201, h: ({ ctx, body }) => B.createSubscription(ctx, body) },
  { method: "PATCH", path: "/subscriptions/:id", need: "write", body: B.subscriptionPatchSchema, h: ({ ctx, params, body }) => B.updateSubscription(ctx, params.id, body) },
  { method: "DELETE", path: "/subscriptions/:id", need: "write", h: ({ ctx, params }) => B.deleteSubscription(ctx, params.id) },
  { method: "POST", path: "/subscriptions/:id/charge", need: "write", body: B.subscriptionPaySchema, status: 201, h: ({ ctx, params, body }) => B.recordSubscriptionCharge(ctx, params.id, body) },
  { method: "GET", path: "/insurance", query: viewQ, h: ({ ctx, query }) => B.listInsurance(ctx, query.view) },
  { method: "POST", path: "/insurance", need: "write", body: B.insuranceSchema, status: 201, h: ({ ctx, body }) => B.createInsurance(ctx, body) },
  { method: "PATCH", path: "/insurance/:id", need: "write", body: B.insurancePatchSchema, h: ({ ctx, params, body }) => B.updateInsurance(ctx, params.id, body) },
  { method: "DELETE", path: "/insurance/:id", need: "write", h: ({ ctx, params }) => B.deleteInsurance(ctx, params.id) },
  { method: "GET", path: "/recurring", query: viewQ, h: ({ ctx, query }) => B.listRecurring(ctx, query.view) },
  { method: "POST", path: "/recurring", need: "write", body: B.recurringSchema, status: 201, h: ({ ctx, body }) => B.createRecurring(ctx, body) },
  { method: "PATCH", path: "/recurring/:id", need: "write", body: B.recurringPatchSchema, h: ({ ctx, params, body }) => B.updateRecurring(ctx, params.id, body) },
  { method: "DELETE", path: "/recurring/:id", need: "write", h: ({ ctx, params }) => B.deleteRecurring(ctx, params.id) },
  { method: "POST", path: "/recurring/:id/post", need: "write", body: z.object({ through: isoDate.optional() }), h: ({ ctx, params, body }) => B.postDueRecurring(ctx, params.id, body.through) },
  // ───── debts
  { method: "GET", path: "/debts", query: viewQ, h: ({ ctx, query }) => D.listDebts(ctx, query.view) },
  { method: "POST", path: "/debts", need: "write", body: D.debtSchema, status: 201, h: ({ ctx, body }) => D.createDebt(ctx, body) },
  { method: "GET", path: "/debts/strategies", query: D.strategySchema, h: ({ ctx, query }) => D.compareStrategies(ctx, query) },
  { method: "GET", path: "/debts/:id", h: ({ ctx, params }) => D.getDebt(ctx, params.id) },
  { method: "PATCH", path: "/debts/:id", need: "write", body: D.debtPatchSchema, h: ({ ctx, params, body }) => D.updateDebt(ctx, params.id, body) },
  { method: "DELETE", path: "/debts/:id", need: "write", h: ({ ctx, params }) => D.deleteDebt(ctx, params.id) },
  { method: "GET", path: "/debts/:id/schedule", query: z.object({ extra: z.string().default("0") }), h: ({ ctx, params, query }) => D.debtSchedule(ctx, params.id, query.extra) },
  { method: "POST", path: "/debts/:id/payments", need: "write", body: D.paymentSchema, status: 201, h: ({ ctx, params, body }) => D.recordDebtPayment(ctx, params.id, body) },
  { method: "DELETE", path: "/debts/:id/payments/:pid", need: "write", h: ({ ctx, params }) => D.deleteDebtPayment(ctx, params.id, params.pid) },
  // ───── goals and emergency fund
  { method: "GET", path: "/goals", query: viewQ, h: ({ ctx, query }) => G.listGoals(ctx, query.view) },
  { method: "POST", path: "/goals", need: "write", body: G.goalSchema, status: 201, h: ({ ctx, body }) => G.createGoal(ctx, body) },
  { method: "GET", path: "/goals/:id", h: ({ ctx, params }) => G.getGoal(ctx, params.id) },
  { method: "PATCH", path: "/goals/:id", need: "write", body: G.goalPatchSchema, h: ({ ctx, params, body }) => G.updateGoal(ctx, params.id, body) },
  { method: "DELETE", path: "/goals/:id", need: "write", h: ({ ctx, params }) => G.deleteGoal(ctx, params.id) },
  { method: "POST", path: "/goals/:id/contributions", need: "write", body: G.contributionSchema, status: 201, h: ({ ctx, params, body }) => G.addContribution(ctx, params.id, body) },
  { method: "DELETE", path: "/goals/:id/contributions/:cid", need: "write", h: ({ ctx, params }) => G.deleteContribution(ctx, params.id, params.cid) },
  { method: "GET", path: "/emergency", query: G.emergencySchema, h: ({ ctx, query }) => G.emergencyPlan(ctx, query) },
  // ───── investments, assets, net worth
  { method: "GET", path: "/investments", query: viewQ, h: ({ ctx, query }) => W.listInvestments(ctx, query.view) },
  { method: "PATCH", path: "/investments/:id", need: "write", body: W.investmentPatchSchema, h: ({ ctx, params, body }) => W.updateInvestment(ctx, params.id, body) },
  { method: "POST", path: "/investments/:id/entries", need: "write", body: W.investmentEntrySchema, status: 201, h: ({ ctx, params, body }) => W.addInvestmentEntry(ctx, params.id, body) },
  { method: "DELETE", path: "/investments/:id/entries/:eid", need: "write", h: ({ ctx, params }) => W.deleteInvestmentEntry(ctx, params.id, params.eid) },
  { method: "POST", path: "/investments/:id/valuations", need: "write", body: W.valuationSchema, status: 201, h: ({ ctx, params, body }) => W.addValuation(ctx, params.id, body) },
  { method: "GET", path: "/assets", query: viewQ, h: ({ ctx, query }) => W.listAssets(ctx, query.view) },
  { method: "POST", path: "/assets", need: "write", body: W.assetSchema, status: 201, h: ({ ctx, body }) => W.createAsset(ctx, body) },
  { method: "PATCH", path: "/assets/:id", need: "write", body: W.assetPatchSchema, h: ({ ctx, params, body }) => W.updateAsset(ctx, params.id, body) },
  { method: "DELETE", path: "/assets/:id", need: "write", h: ({ ctx, params }) => W.deleteAsset(ctx, params.id) },
  { method: "POST", path: "/assets/:id/valuations", need: "write", body: W.assetValuationSchema, status: 201, h: ({ ctx, params, body }) => W.addAssetValuation(ctx, params.id, body) },
  { method: "GET", path: "/networth", query: W.netWorthQuery, h: ({ ctx, query }) => W.netWorth(ctx, query) },
  // ───── budgets
  { method: "GET", path: "/budgets", h: ({ ctx }) => Bud.listBudgets(ctx) },
  { method: "POST", path: "/budgets", need: "write", body: Bud.budgetSchema, status: 201, h: ({ ctx, body }) => Bud.createBudget(ctx, body) },
  { method: "GET", path: "/budgets/compare", query: Bud.compareQuery, h: ({ ctx, query }) => Bud.compareBudgets(ctx, query.ids) },
  { method: "GET", path: "/budgets/:id", h: ({ ctx, params }) => Bud.budgetReport(ctx, params.id) },
  { method: "PATCH", path: "/budgets/:id", need: "write", body: Bud.budgetPatchSchema, h: ({ ctx, params, body }) => Bud.updateBudget(ctx, params.id, body) },
  { method: "DELETE", path: "/budgets/:id", need: "write", h: ({ ctx, params }) => Bud.deleteBudget(ctx, params.id) },
  { method: "POST", path: "/budgets/:id/duplicate", need: "write", body: Bud.duplicateSchema, status: 201, h: ({ ctx, params, body }) => Bud.duplicateBudget(ctx, params.id, body) },
  // ───── forecasting and scenarios
  { method: "GET", path: "/forecast", query: F.forecastQuery, h: ({ ctx, query }) => F.forecast(ctx, query) },
  { method: "POST", path: "/scenarios/run", body: F.scenarioRunSchema, h: ({ ctx, body }) => F.runScenarioService(ctx, body) },
  { method: "GET", path: "/scenarios", h: ({ ctx }) => F.listScenarios(ctx) },
  { method: "POST", path: "/scenarios", need: "write", body: F.scenarioSaveSchema, status: 201, h: ({ ctx, body }) => F.saveScenario(ctx, body) },
  { method: "GET", path: "/scenarios/compare", query: z.object({ ids: z.string().transform((s) => s.split(",").filter(Boolean).slice(0, 6)) }), h: ({ ctx, query }) => F.compareScenarios(ctx, query.ids) },
  { method: "PUT", path: "/scenarios/:id", need: "write", body: F.scenarioSaveSchema, h: ({ ctx, params, body }) => F.saveScenario(ctx, body, params.id) },
  { method: "DELETE", path: "/scenarios/:id", need: "write", h: ({ ctx, params }) => F.deleteScenario(ctx, params.id) },
  // ───── planner
  { method: "GET", path: "/planner/defaults", query: viewQ2, h: ({ ctx, query }) => P.plannerDefaults(ctx, query.view) },
  { method: "POST", path: "/planner/mortgage", body: P.mortgageSchema, h: async ({ body }) => P.mortgageCalc(body) },
  { method: "POST", path: "/planner/mortgage/compare", body: P.mortgageCompareSchema, h: async ({ body }) => P.mortgageCompare(body) },
  { method: "POST", path: "/planner/affordability", body: P.affordabilitySchema, h: async ({ body }) => P.affordability(body) },
  { method: "POST", path: "/planner/down-payment", body: P.downPaymentSchema, h: async ({ ctx, body }) => P.downPaymentPlan(body, ctx.today) },
  { method: "GET", path: "/planner/saved", h: ({ ctx }) => P.listMortgageScenarios(ctx) },
  { method: "POST", path: "/planner/saved", need: "write", body: P.savedMortgageSchema, status: 201, h: ({ ctx, body }) => P.saveMortgageScenario(ctx, body) },
  { method: "DELETE", path: "/planner/saved/:id", need: "write", h: ({ ctx, params }) => P.deleteMortgageScenario(ctx, params.id) },
  // ───── tax
  { method: "GET", path: "/tax/records", query: z.object({ year: z.coerce.number().int().min(2000).max(2100) }), h: ({ ctx, query }) => Tax.listTaxRecords(ctx, query.year) },
  { method: "POST", path: "/tax/records", need: "write", body: Tax.taxRecordSchema, status: 201, h: ({ ctx, body }) => Tax.createTaxRecord(ctx, body) },
  { method: "PATCH", path: "/tax/records/:id", need: "write", body: Tax.taxRecordPatchSchema, h: ({ ctx, params, body }) => Tax.updateTaxRecord(ctx, params.id, body) },
  { method: "DELETE", path: "/tax/records/:id", need: "write", h: ({ ctx, params }) => Tax.deleteTaxRecord(ctx, params.id) },
  { method: "GET", path: "/tax/summary", query: Tax.taxSummaryQuery, h: ({ ctx, query }) => Tax.taxSummary(ctx, query) },
  { method: "GET", path: "/tax/rules", h: ({ ctx }) => Tax.listRuleSets(ctx) },
  { method: "PUT", path: "/tax/rules", need: "admin", body: Tax.ruleSetSchema, h: ({ ctx, body }) => Tax.saveRuleSet(ctx, body) },
  // ───── dashboard, analytics, contributions
  { method: "GET", path: "/dashboard", query: Dash.dashboardQuery, h: ({ ctx, query }) => Dash.dashboard(ctx, query) },
  { method: "GET", path: "/analytics", query: analyticsQuery, h: ({ ctx, query }) => getAnalytics(ctx, query) },
  { method: "GET", path: "/comparison", query: rangeQ, h: ({ ctx, query }) => Dash.memberComparison(ctx, query.from, query.to) },
  { method: "GET", path: "/contributions", query: rangeQ, h: ({ ctx, query }) => Con.contributionReport(ctx, query.from, query.to) },
  { method: "POST", path: "/contributions/preview", body: Con.previewSchema, h: ({ ctx, body }) => Con.contributionReport(ctx, body.from, body.to, body.rule) },
  { method: "GET", path: "/contributions/rules", h: ({ ctx }) => Con.listRules(ctx) },
  { method: "POST", path: "/contributions/rules", need: "write", body: Con.ruleSchema, status: 201, h: ({ ctx, body }) => Con.createRule(ctx, body) },
  { method: "PUT", path: "/contributions/rules/:id", need: "write", body: Con.ruleSchema, h: ({ ctx, params, body }) => Con.updateRule(ctx, params.id, body) },
  { method: "DELETE", path: "/contributions/rules/:id", need: "write", h: ({ ctx, params }) => Con.deleteRule(ctx, params.id) },
  { method: "GET", path: "/settlements", h: ({ ctx }) => Con.listSettlements(ctx) },
  { method: "POST", path: "/settlements", need: "write", body: Con.settlementSchema, status: 201, h: ({ ctx, body }) => Con.createSettlement(ctx, body) },
  { method: "DELETE", path: "/settlements/:id", need: "write", h: ({ ctx, params }) => Con.deleteSettlement(ctx, params.id) },
  // ───── rules, tags, saved views
  { method: "GET", path: "/rules", h: ({ ctx }) => Rules.listRules(ctx) },
  { method: "POST", path: "/rules", need: "write", body: Rules.ruleSchema, status: 201, h: ({ ctx, body }) => Rules.createRule(ctx, body) },
  { method: "POST", path: "/rules/preview", body: Rules.previewSchema, h: ({ ctx, body }) => Rules.previewRule(ctx, body) },
  { method: "POST", path: "/rules/apply", need: "write", body: Rules.applyExistingSchema, h: ({ ctx, body }) => Rules.applyRulesToExisting(ctx, body) },
  { method: "PATCH", path: "/rules/:id", need: "write", body: Rules.rulePatchSchema, h: ({ ctx, params, body }) => Rules.updateRule(ctx, params.id, body) },
  { method: "DELETE", path: "/rules/:id", need: "write", h: ({ ctx, params }) => Rules.deleteRule(ctx, params.id) },
  { method: "GET", path: "/tags", h: ({ ctx }) => Tags.listTags(ctx) },
  { method: "GET", path: "/tags/summary", query: Tags.tagSummaryQuery, h: ({ ctx, query }) => Tags.tagSummary(ctx, query) },
  { method: "GET", path: "/saved-views", query: z.object({ kind: z.string().max(20).optional() }), h: ({ ctx, query }) => Tags.listSavedViews(ctx, query.kind) },
  { method: "POST", path: "/saved-views", need: "write", body: Tags.savedViewSchema, status: 201, h: ({ ctx, body }) => Tags.createSavedView(ctx, body) },
  { method: "DELETE", path: "/saved-views/:id", need: "write", h: ({ ctx, params }) => Tags.deleteSavedView(ctx, params.id) },
  // ───── safe to spend, registered account room, pay day plans
  { method: "GET", path: "/safe-to-spend", query: Safe.safeQuery, h: ({ ctx, query }) => Safe.safeSpend(ctx, query) },
  { method: "GET", path: "/registered-room", query: Reg.roomQuery, h: ({ ctx, query }) => Reg.registeredStatus(ctx, query) },
  { method: "PUT", path: "/registered-room", need: "write", body: Reg.roomSchema, h: ({ ctx, body }) => Reg.saveRoom(ctx, body) },
  { method: "GET", path: "/registered-room/rrsp-helper", query: Reg.rrspHelperQuery, h: async ({ query }) => Reg.rrspHelper(query) },
  { method: "GET", path: "/payday-plans", h: ({ ctx }) => Pay.listPlans(ctx) },
  { method: "POST", path: "/payday-plans", need: "write", body: Pay.planSchema, status: 201, h: ({ ctx, body }) => Pay.createPlan(ctx, body) },
  { method: "PATCH", path: "/payday-plans/:id", need: "write", body: Pay.planPatchSchema, h: ({ ctx, params, body }) => Pay.updatePlan(ctx, params.id, body) },
  { method: "DELETE", path: "/payday-plans/:id", need: "write", h: ({ ctx, params }) => Pay.deletePlan(ctx, params.id) },
  { method: "POST", path: "/payday-plans/:id/run", need: "write", body: Pay.runSchema, h: ({ ctx, params, body }) => Pay.runPlan(ctx, params.id, body) },
  // vehicles: mileage log, keep or replace, fuel to ledger
  { method: "GET", path: "/mileage/trips", query: Mile.tripQuery, h: ({ ctx, query }) => Mile.listTrips(ctx, query) },
  { method: "POST", path: "/mileage/trips", need: "write", body: Mile.tripSchema, status: 201, h: ({ ctx, body }) => Mile.createTrip(ctx, body) },
  { method: "DELETE", path: "/mileage/trips/:id", need: "write", h: ({ ctx, params }) => Mile.deleteTrip(ctx, params.id) },
  { method: "GET", path: "/mileage/report", query: Mile.tripQuery, h: ({ ctx, query }) => Mile.mileageReport(ctx, query) },
  { method: "POST", path: "/vehicles/keep-or-replace", body: Mile.keepReplaceSchema, h: ({ ctx, body }) => Mile.keepReplace(ctx, body) },
  { method: "GET", path: "/vehicles/:id/replace-defaults", h: ({ ctx, params }) => Mile.keepReplaceDefaults(ctx, params.id) },
  { method: "POST", path: "/fuel/:id/post-to-ledger", need: "write", body: z.object({ accountId: z.string().min(5).max(40) }), status: 201, h: ({ actor, params, body }) => FuelPost.postFuelToLedger(actor, params.id, body.accountId) },
  // people: comments, wish list, read-only API tokens
  { method: "GET", path: "/comments", query: People.commentQuery, h: ({ ctx, query }) => People.listComments(ctx, query) },
  { method: "POST", path: "/comments", body: People.commentSchema, status: 201, h: ({ ctx, body }) => People.addComment(ctx, body) },
  { method: "DELETE", path: "/comments/:id", h: ({ ctx, params }) => People.deleteComment(ctx, params.id) },
  { method: "GET", path: "/wishlist", h: ({ ctx }) => People.listWishes(ctx) },
  { method: "POST", path: "/wishlist", body: People.wishSchema, status: 201, h: ({ ctx, body }) => People.createWish(ctx, body) },
  { method: "POST", path: "/wishlist/:id/decision", body: People.decisionSchema, h: ({ ctx, params, body }) => People.decideWish(ctx, params.id, body) },
  { method: "POST", path: "/wishlist/:id/purchased", h: ({ ctx, params }) => People.updateWishStatus(ctx, params.id, "PURCHASED") },
  { method: "POST", path: "/wishlist/:id/cancel", h: ({ ctx, params }) => People.updateWishStatus(ctx, params.id, "CANCELLED") },
  { method: "GET", path: "/api-tokens", h: ({ ctx }) => Tok.listTokens(ctx) },
  { method: "POST", path: "/api-tokens", need: "write", body: Tok.tokenSchema, status: 201, h: ({ ctx, body }) => Tok.createToken(ctx, body) },
  { method: "DELETE", path: "/api-tokens/:id", need: "write", h: ({ ctx, params }) => Tok.revokeToken(ctx, params.id) },
  // safety: receipt capture, emergency page, change history
  { method: "POST", path: "/receipts/scan", need: "write", raw: true, rate: { limit: 20, windowSec: 600 }, h: async ({ ctx, req }) => { const { file: f } = await file(req); return NextResponse.json({ data: await Rcpt.scanReceipt(ctx, f) }, { headers: { "cache-control": "no-store" } }); } },
  { method: "GET", path: "/legacy", h: ({ ctx }) => Legacy.getMyLegacy(ctx) },
  { method: "PUT", path: "/legacy", need: "write", body: Legacy.legacySchema, h: ({ ctx, body }) => Legacy.saveMyLegacy(ctx, body) },
  { method: "GET", path: "/legacy/shared", h: ({ ctx }) => Legacy.sharedWithMe(ctx) },
  { method: "GET", path: "/legacy/shared/:id", h: ({ ctx, params }) => Legacy.readSharedLegacy(ctx, params.id) },
  { method: "GET", path: "/change-history", query: Hist.historyQuery, h: ({ ctx, query }) => Hist.changeHistory(ctx, query) },
  // planning and insight
  { method: "GET", path: "/retirement/defaults", h: ({ ctx }) => Insight.retirementDefaults(ctx) },
  { method: "POST", path: "/retirement/project", body: Insight.retirementSchema, h: ({ ctx, body }) => Insight.projectRetirementNow(ctx, body) },
  { method: "POST", path: "/resp/plan", body: Insight.respSchema, h: ({ ctx, body }) => Insight.planRespNow(ctx, body) },
  { method: "GET", path: "/sinking-funds", query: Insight.viewQ, h: ({ ctx, query }) => Insight.sinkingFunds(ctx, query) },
  { method: "GET", path: "/subscriptions/watch", query: Insight.viewQ, h: ({ ctx, query }) => Insight.subscriptionWatch(ctx, query) },
  { method: "GET", path: "/year-in-review", query: Insight.yearQ, h: ({ ctx, query }) => Insight.yearInReview(ctx, query) },
  { method: "GET", path: "/monthly-review", query: Insight.reviewQ, h: ({ ctx, query }) => Insight.monthlyReview(ctx, query) },
  { method: "POST", path: "/monthly-review/email", query: Insight.reviewQ, h: ({ ctx, query }) => Insight.emailMonthlyReview(ctx, query) },
  { method: "GET", path: "/monthly-review/settings", h: ({ ctx }) => Insight.getReviewSettings(ctx) },
  { method: "PUT", path: "/monthly-review/settings", body: Insight.reviewSettingsSchema, h: ({ ctx, body }) => Insight.updateReviewSettings(ctx, body) },
  // ───── vehicles (cost of ownership from the ledger, maintenance from the vehicle module)
  { method: "GET", path: "/vehicles/options", h: ({ ctx }) => Veh.vehicleOptions(ctx) },
  { method: "GET", path: "/vehicles/overview", query: Veh.vehicleOverviewQuery, h: ({ ctx, query }) => Veh.vehicleOverview(ctx, query) },
  // ───── calendar, alerts
  { method: "GET", path: "/calendar", query: z.object({ from: isoDate, to: isoDate, view: z.enum(["my", "household", "all"]).default("all") }), h: ({ ctx, query }) => Cal.obligations(ctx, query.from, query.to, query.view) },
  { method: "GET", path: "/calendar/events", h: ({ ctx }) => Cal.listEvents(ctx) },
  { method: "POST", path: "/calendar/events", need: "write", body: Cal.eventSchema, status: 201, h: ({ ctx, body }) => Cal.createEvent(ctx, body) },
  { method: "PATCH", path: "/calendar/events/:id", need: "write", body: Cal.eventPatchSchema, h: ({ ctx, params, body }) => Cal.updateEvent(ctx, params.id, body) },
  { method: "DELETE", path: "/calendar/events/:id", need: "write", h: ({ ctx, params }) => Cal.deleteEvent(ctx, params.id) },
  { method: "GET", path: "/alerts", h: ({ ctx }) => Al.computeAlerts(ctx) },
  { method: "POST", path: "/alerts/refresh", h: ({ ctx, actor }) => Al.refreshAlertNotifications(actor, ctx.householdId) },
  { method: "GET", path: "/alert-settings", h: ({ ctx }) => Al.getAlertSettings(ctx) },
  { method: "PUT", path: "/alert-settings", body: Al.alertSettingsSchema, h: ({ ctx, body }) => Al.updateAlertSettings(ctx, body) },
  // ───── reports and exports
  { method: "GET", path: "/reports", h: async () => R.REPORT_TYPES },
  { method: "GET", path: "/reports/run", query: R.reportQuery, raw: true, rate: { limit: 40, windowSec: 600 }, h: async ({ ctx, query }) => {
    const rep = await R.buildFinanceReport(ctx, query);
    if (query.format === "json") return NextResponse.json({ data: rep }, { headers: { "cache-control": "no-store" } });
    const fmt = query.format as ReportFormat;
    return download(await renderReport(rep, fmt), `family-finance-${query.type}-${ctx.today}.${REPORT_FORMATS[fmt].ext}`, REPORT_FORMATS[fmt].mime, fmt === "pdf");
  } },
  { method: "GET", path: "/export/:entity", query: Imp.exportQuery, raw: true, rate: { limit: 30, windowSec: 600 }, h: async ({ ctx, params, query }) => {
    if (!(Imp.EXPORT_ENTITIES as readonly string[]).includes(params.entity)) throw new AppError("NOT_FOUND", "Unknown export");
    const rep = await Imp.exportEntity(ctx, params.entity as never, query);
    const fmt = query.format as ReportFormat;
    return download(await renderReport(rep, fmt), `family-finance-${params.entity}-${ctx.today}.${REPORT_FORMATS[fmt].ext}`, REPORT_FORMATS[fmt].mime);
  } },
  { method: "GET", path: "/export-all", raw: true, rate: { limit: 10, windowSec: 600 }, h: async ({ ctx }) => { const d = await exportMyData(ctx); return download(Buffer.from(JSON.stringify(d, null, 2)), `family-finance-my-data-${ctx.today}.json`, "application/json"); } },
  // ───── import
  { method: "POST", path: "/import/preview", need: "write", body: Imp.previewSchema, maxBody: 9_000_000, h: async ({ body }) => Imp.previewCsv(body) },
  { method: "POST", path: "/import/analyze", need: "write", body: Imp.analyzeSchema, maxBody: 9_000_000, h: ({ ctx, body }) => Imp.analyzeCsv(ctx, body) },
  { method: "POST", path: "/import/commit", need: "write", body: Imp.commitSchema, maxBody: 4_000_000, status: 201, h: ({ ctx, body }) => Imp.commitImport(ctx, body) },
  { method: "GET", path: "/import/batches", h: ({ ctx }) => Imp.listBatches(ctx) },
  { method: "POST", path: "/import/batches/:id/undo", need: "write", h: ({ ctx, params }) => Imp.undoBatch(ctx, params.id) },
  // ───── documents
  { method: "GET", path: "/documents", query: Doc.docListQuery, h: ({ ctx, query }) => Doc.listFinanceDocuments(ctx, query) },
  { method: "POST", path: "/documents", need: "write", raw: true, rate: { limit: 30, windowSec: 600 }, h: async ({ ctx, req }) => {
    const { form, file: f } = await file(req);
    const meta = Doc.docMetaSchema.parse(Object.fromEntries([...form.entries()].filter(([k, v]) => k !== "file" && typeof v === "string" && v !== "")));
    return NextResponse.json({ data: await Doc.uploadFinanceDocument(ctx, f, meta) }, { status: 201 });
  } },
  { method: "DELETE", path: "/documents/:id", need: "write", h: ({ ctx, params }) => Doc.deleteFinanceDocument(ctx, params.id) },
  // ───── assistant, history, fx
  { method: "POST", path: "/assistant", body: As.askSchema, rate: { limit: 60, windowSec: 600 }, h: ({ ctx, body }) => As.ask(ctx, body) },
  { method: "GET", path: "/assistant/examples", h: async () => As.EXAMPLE_QUESTIONS },
  { method: "GET", path: "/history/:entity/:eid", h: ({ ctx, params }) => auditHistory(ctx, params.entity, params.eid) },
  { method: "GET", path: "/fx", h: ({ ctx }) => listFx(ctx) },
  { method: "POST", path: "/fx", need: "write", body: fxSchema, status: 201, h: ({ ctx, body }) => saveFx(ctx, body) },
  { method: "DELETE", path: "/fx/:id", need: "write", h: ({ ctx, params }) => deleteFx(ctx, params.id) },
];

function match(def: string, actual: string[]): Record<string, string> | null {
  const d = def.split("/").filter(Boolean);
  if (d.length !== actual.length) return null;
  const p: Record<string, string> = {};
  for (let i = 0; i < d.length; i++) {
    if (d[i].startsWith(":")) p[d[i].slice(1)] = decodeURIComponent(actual[i]);
    else if (d[i] !== actual[i]) return null;
  }
  return p;
}

/** Routes that are not scoped to one household. */
const GLOBAL: Def[] = [];
const global = (method: Def["method"], path: string, opts: { body?: ZodTypeAny; status?: number }, h: (c: { actor: Actor; body: any }) => Promise<unknown>) => GLOBAL.push({ method, path, body: opts.body, status: opts.status, h: ({ actor, body }) => h({ actor, body }) } as Def);
global("GET", "/context", {}, async ({ actor }) => ({ households: await H.listFinanceHouseholds(actor) }));
global("POST", "/households", { body: H.profileSchema, status: 201 }, ({ actor, body }) => H.createFinanceHousehold(actor, body));
global("POST", "/demo", { status: 201 }, ({ actor }) => Demo.createDemoHousehold(actor));

export async function dispatch(req: NextRequest, segments: string[], method: Def["method"]): Promise<Response> {
  const g = GLOBAL.find((d) => d.method === method && match(d.path, segments));
  const opts = (d: Def) => ({ body: d.body, query: d.query, status: d.status, raw: d.raw, rate: d.rate, maxBody: d.maxBody }) as never;
  if (g) return route(opts(g), async ({ actor, body, query }) => g.h({ actor, body, query } as never))(req, { params: Promise.resolve({}) });
  const [hid, ...rest] = segments;
  const def = ROUTES.map((d) => ({ d, p: match(d.path, rest) })).find((x) => x.d.method === method && x.p);
  if (!hid || !def) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Unknown endpoint" } }, { status: 404 });
  const { d, p } = def;
  // A read-only token may only read, and may not manage tokens.
  const usesToken = !!req.headers.get("authorization");
  if (usesToken && (method !== "GET" || rest[0] === "api-tokens")) return NextResponse.json({ error: { code: "FORBIDDEN", message: "API tokens are read-only" } }, { status: 403 });
  return route({ ...(opts(d) as object), bearer: (r: NextRequest) => Tok.authenticateBearer(r, hid) } as never, async ({ actor, body, query }) => {
    const ctx = await finCtx(actor, hid, d.need ?? "read");
    assertAreaAllowed(ctx.me.role, method, rest[0]);
    return d.h({ ctx, actor, query, body, params: p as Record<string, string>, req });
  })(req, { params: Promise.resolve(p as Record<string, string>) });
}
export { id, pageQ };
