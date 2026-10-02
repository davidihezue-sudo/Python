// Illustrative demonstration household. Everything here is invented and labelled as such. It lives in its own household
// (isDemo = true) so it can be removed in one step and never mixes with real records.
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { D, money, ZERO } from "./engine/decimal";
import { apportion } from "./engine/allocation";
import { splitPayment, periodicRate } from "./engine/debt";
import { addDays, addMonths, endOfMonth, startOfMonth, daysInMonth } from "./engine/dates";
import { toDate } from "./common";
import { finCtx, type FinCtx } from "./access";
import { createFinanceHousehold, ensureMemberDefaults } from "./household";
import { createDebt, debtSchema } from "./debts";
import { createAccount, accountSchema } from "./accounts";
import { createIncome, incomeSchema } from "./income";
import { createBill, createSubscription, createInsurance, billSchema, subscriptionSchema, insuranceSchema } from "./bills";
import { createGoal, goalSchema } from "./goals";
import { createAsset, assetSchema } from "./wealth";
import { createBudget, budgetSchema } from "./budgets";
import { createRule, ruleSchema } from "./contributions";
import { createTaxRecord, taxRecordSchema } from "./tax";
import { createEvent, eventSchema } from "./calendar";
import { AVATAR_COLORS } from "./defaults";
import type { Actor } from "../context";

export const DEMO_LABEL = "Demo household (illustrative data)";
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

/** Fills a household with a year of plausible data. `partnerMemberId` is the second earner. */
export async function populateDemoData(ctx: FinCtx, partnerMemberId: string) {
  const me = ctx.me.id, partner = partnerMemberId;
  const partnerUserId = ctx.members.find((m) => m.id === partner)!.userId;
  const r = rng(20261002);
  const rnd = (lo: number, hi: number) => Math.round((lo + r() * (hi - lo)) * 100) / 100;
  const start = startOfMonth(addMonths(ctx.today, -11));
  const cat = async (name: string, _parent?: string) => (await db.finCategory.findFirstOrThrow({ where: { householdId: ctx.householdId, name, kind: "EXPENSE" } })).id;
  const C = { groceries: await cat("Groceries"), restaurants: await cat("Restaurants"), fuel: await cat("Fuel", "Transportation"), electricity: await cat("Electricity"), gas: await cat("Natural gas"), internet: await cat("Internet"), phone: await cat("Mobile phone"), propTax: await cat("Property tax"), homeIns: await cat("Home insurance"), carIns: await cat("Vehicle insurance"), lifeIns: await cat("Life insurance"), shopping: await cat("Clothing"), personal: await cat("Personal care"), ent: await cat("Entertainment"), subs: await cat("Subscriptions"), health: await cat("Pharmacy"), maint: await cat("Vehicle maintenance"), interest: await cat("Interest and fees"), salary: (await db.finCategory.findFirstOrThrow({ where: { householdId: ctx.householdId, name: "Salary", kind: "INCOME" } })).id, bonus: (await db.finCategory.findFirstOrThrow({ where: { householdId: ctx.householdId, name: "Other income", kind: "INCOME" } })).id, selfEmp: (await db.finCategory.findFirstOrThrow({ where: { householdId: ctx.householdId, name: "Self-employment", kind: "INCOME" } })).id, travel: await cat("Travel") };

  // ───── accounts
  const mk = async (name: string, type: string, owner: string | null, opening: string, extra: Record<string, unknown> = {}) => (await createAccount(ctx, accountSchema.parse({ name, type, openingBalance: opening, openingDate: start, institution: "Demo Credit Union", joint: owner === null, ownerMemberId: owner ?? undefined, ...extra }))).id;
  const A = {
    meChq: await mk("Chequing (you)", "CHEQUING", me, "3200.00"), partnerChq: await mk("Chequing (partner)", "CHEQUING", partner, "2800.00"), joint: await mk("Joint chequing", "CHEQUING", null, "4200.00"),
    emergency: await mk("Emergency savings (joint)", "HIGH_INTEREST_SAVINGS", null, "11000.00"), house: await mk("House fund (joint)", "HIGH_INTEREST_SAVINGS", null, "9500.00"), private: await mk("Partner private savings", "SAVINGS", partner, "2400.00", { visibility: "PERSONAL" }),
    tfsa: await mk("TFSA (you)", "INVESTMENT", me, "14000.00", { investmentKind: "TFSA" }), rrsp: await mk("RRSP (partner)", "INVESTMENT", partner, "26000.00", { investmentKind: "RRSP" }),
  };
  const visa = await createDebt(ctx, debtSchema.parse({ lender: "Demo Bank Visa", name: "Visa (you)", type: "CREDIT_CARD", originalAmount: "6000.00", outstandingBalance: "900.00", interestRate: "19.99", minimumPayment: "35.00", regularPayment: "35.00", frequency: "MONTHLY", nextDueDate: addDays(ctx.today, 9), creditLimit: "6000.00", startDate: start, assignToMemberId: me }));
  const mortgage = await createDebt(ctx, debtSchema.parse({ lender: "Demo Mortgage Co", name: "Mortgage", type: "MORTGAGE", originalAmount: "420000.00", outstandingBalance: "398000.00", interestRate: "4.79", compoundingPerYear: 2, minimumPayment: "2330.00", regularPayment: "2330.00", frequency: "MONTHLY", nextDueDate: addDays(startOfMonth(addMonths(ctx.today, 1)), 2), termMonths: 60, startDate: start, maturityDate: addMonths(start, 300) }));
  const car = await createDebt(ctx, debtSchema.parse({ lender: "Demo Auto Finance", name: "Car loan (partner)", type: "VEHICLE_LOAN", originalAmount: "18000.00", outstandingBalance: "13200.00", interestRate: "6.9", minimumPayment: "410.00", regularPayment: "410.00", frequency: "MONTHLY", nextDueDate: addDays(startOfMonth(addMonths(ctx.today, 1)), 14), startDate: start, assignToMemberId: partner }));
  const loc = await createDebt(ctx, debtSchema.parse({ lender: "Demo Credit Union", name: "Line of credit (you, personal)", type: "LINE_OF_CREDIT", originalAmount: "8000.00", outstandingBalance: "5200.00", interestRate: "9.2", minimumPayment: "120.00", regularPayment: "200.00", frequency: "MONTHLY", nextDueDate: addDays(startOfMonth(addMonths(ctx.today, 1)), 19), startDate: start, assignToMemberId: me, visibility: "PERSONAL" }));
  const debts = [mortgage, car, loc];
  const debtRows = await db.debt.findMany({ where: { id: { in: [visa.id, ...debts.map((d) => d.id)] } }, include: { account: true } });
  const debtBy = (id: string) => debtRows.find((d) => d.id === id)!;

  // ───── income sources
  const fmt = (d: string) => d;
  await createIncome(ctx, incomeSchema.parse({ name: "Salary (you)", kind: "EMPLOYMENT", employer: "Demo Employer Ltd", grossAmount: "7800.00", netAmount: "5700.00", taxDeduction: "1700.00", pensionDeduction: "250.00", otherDeduction: "150.00", frequency: "MONTHLY", nextPayDate: addMonths(startOfMonth(ctx.today), 1), startDate: start, accountId: A.meChq }));
  await createIncome(ctx, incomeSchema.parse({ name: "Salary (partner)", kind: "EMPLOYMENT", employer: "Demo Clinic Inc", grossAmount: "2600.00", netAmount: "1900.00", taxDeduction: "560.00", pensionDeduction: "90.00", otherDeduction: "50.00", frequency: "SEMI_MONTHLY", nextPayDate: addDays(startOfMonth(ctx.today), 14), startDate: start, accountId: A.partnerChq, assignToMemberId: partner }));
  const tutoring = await createIncome(ctx, incomeSchema.parse({ name: "Tutoring (partner, irregular)", kind: "FREELANCE", grossAmount: "300.00", netAmount: "300.00", frequency: "IRREGULAR", accountId: A.partnerChq, assignToMemberId: partner }));

  // ───── twelve months of ledger rows (inserted directly for speed; each respects the same rules the services enforce)
  type Row = { id?: string; accountId: string; type: string; amount: string; date: string; description: string; categoryId?: string | null; owner: string; payer: string | null; mode?: string; allocated?: string | null; vis?: string; group?: string; billId?: string; debtPaymentId?: string; incomeSourceId?: string; splits?: { memberId: string | null; amount: string }[]; user: string };
  const rows: Row[] = [];
  const myUser = ctx.actor.id;
  const add = (x: Omit<Row, "user"> & { user?: string }) => rows.push({ user: x.owner === partner ? partnerUserId : myUser, ...x });
  const transfer = (from: string, to: string, amt: number, date: string, desc: string, owner: string, vis = "HOUSEHOLD") => {
    const g = randomUUID();
    add({ accountId: from, type: "TRANSFER", amount: money(-amt), date, description: desc, owner, payer: owner, group: g, vis });
    add({ accountId: to, type: "TRANSFER", amount: money(amt), date, description: desc, owner, payer: owner, group: g, vis });
    return g;
  };
  const exp = (accountId: string, categoryId: string, amt: number, date: string, desc: string, owner: string, o: Partial<Row> = {}) => add({ accountId, type: "EXPENSE", amount: money(-amt), date, description: desc, categoryId, owner, payer: owner, mode: "OWNER", ...o });
  const equalSplit = (amt: number) => apportion(amt, [1, 1]).map((a, i) => ({ memberId: i === 0 ? me : partner, amount: money(a) }));
  const day = (m: number, d: number) => { const s = startOfMonth(addMonths(start, m)); return `${s.slice(0, 7)}-${String(Math.min(d, daysInMonth(+s.slice(0, 4), +s.slice(5, 7)))).padStart(2, "0")}`; };

  const balances: Record<string, number> = { [mortgage.id]: 398000, [car.id]: 13200, [loc.id]: 5200 };
  const debtPayments: { debtId: string; date: string; total: number; principal: number; interest: number; from: string; owner: string; group: string; ptxId: string }[] = [];
  let visaSpend = 0;
  for (let m = 0; m < 12; m++) {
    const d = (n: number) => day(m, n);
    if (d(1) > ctx.today) break;
    // income
    add({ accountId: A.meChq, type: "INCOME", amount: "5700.00", date: d(1), description: "Salary (Demo Employer Ltd)", categoryId: C.salary, owner: me, payer: me });
    for (const dd of [1, 15]) add({ accountId: A.partnerChq, type: "INCOME", amount: "1900.00", date: d(dd), description: "Salary (Demo Clinic Inc)", categoryId: C.salary, owner: partner, payer: partner });
    if (m === 2) add({ accountId: A.meChq, type: "INCOME", amount: "2400.00", date: d(20), description: "Annual bonus", categoryId: C.bonus, owner: me, payer: me });
    if ([1, 5, 9].includes(m)) add({ accountId: A.partnerChq, type: "INCOME", amount: money(rnd(240, 420)), date: d(18), description: "Tutoring sessions", categoryId: C.selfEmp, owner: partner, payer: partner, incomeSourceId: tutoring.id });
    // contributions to the joint account
    transfer(A.meChq, A.joint, 1900, d(2), "Monthly contribution to joint account", me);
    transfer(A.partnerChq, A.joint, 1600, d(2), "Monthly contribution to joint account", partner);
    // debts
    for (const [dt, from, owner, day0] of [[mortgage, A.joint, null as string | null, 3], [car, A.partnerChq, partner, 14], [loc, A.meChq, me, 19]] as const) {
      const row = debtBy(dt.id);
      const total = dt === mortgage ? 2330 : dt === car ? 410 : 200;
      const sp = splitPayment({ balance: balances[dt.id], aprPercent: row.interestRate.toString(), compoundingPerYear: row.compoundingPerYear, frequency: "MONTHLY", total });
      const g = randomUUID();
      const ptxId = randomUUID();
      const date = d(day0);
      const vis = dt === loc ? "PERSONAL" : "HOUSEHOLD";
      const who = owner ?? me;
      add({ accountId: from, type: "TRANSFER", amount: money(sp.principal.negated()), date, description: `Payment to ${row.lender}`, owner: who, payer: owner, group: g, debtPaymentId: ptxId, vis });
      add({ accountId: row.accountId, type: "TRANSFER", amount: money(sp.principal), date, description: `Payment from ${from === A.joint ? "Joint chequing" : "chequing"}`, owner: who, payer: owner, group: g, debtPaymentId: ptxId, vis });
      add({ accountId: from, type: "EXPENSE", amount: money(sp.interest.negated()), date, description: `Interest on ${row.lender}`, categoryId: C.interest, owner: who, payer: owner, mode: dt === loc ? "OWNER" : "HOUSEHOLD", debtPaymentId: ptxId, vis });
      balances[dt.id] -= sp.principal.toNumber();
      debtPayments.push({ debtId: dt.id, date, total, principal: sp.principal.toNumber(), interest: sp.interest.toNumber(), from, owner: who, group: g, ptxId });
    }
    // fixed household bills from the joint account (paid by the household)
    exp(A.joint, C.propTax, 330, d(5), "Property tax instalment", me, { payer: null, mode: "HOUSEHOLD" });
    exp(A.joint, C.electricity, rnd(88, 150), d(6), "Electricity", me, { payer: null, mode: "HOUSEHOLD" });
    exp(A.joint, C.gas, rnd(48, 140), d(6), "Natural gas", me, { payer: null, mode: "HOUSEHOLD" });
    exp(A.joint, C.internet, 89.99, d(8), "Internet", me, { payer: null, mode: "HOUSEHOLD" });
    exp(A.joint, C.homeIns, 112, d(9), "Home insurance", me, { payer: null, mode: "HOUSEHOLD" });
    // paid personally but shared
    exp(A.partnerChq, C.carIns, 214, d(10), "Car insurance", partner, { mode: "HOUSEHOLD" });
    exp(A.meChq, C.phone, 128, d(11), "Mobile phones (two lines)", me, { mode: "SPLIT", splits: equalSplit(128) });
    exp(A.meChq, C.lifeIns, 64, d(12), "Life insurance", me, { mode: "OWNER", vis: "PERSONAL" });
    // groceries, restaurants, fuel
    for (let k = 0; k < 4; k++) {
      const who = k % 2 === 0 ? me : partner;
      const amt = rnd(85, 190);
      const via = who === me && k === 0 ? visa.accountId : who === me ? A.meChq : A.partnerChq;
      if (via === visa.accountId) visaSpend += amt;
      exp(via, C.groceries, amt, d(3 + k * 7), k % 2 ? "Grocery store" : "Supermarket", who, { mode: "HOUSEHOLD" });
    }
    for (let k = 0; k < 3; k++) {
      const who = k === 1 ? partner : me;
      const amt = rnd(32, 96);
      exp(who === me ? A.meChq : A.partnerChq, C.restaurants, amt, d(7 + k * 8), ["Family restaurant", "Cafe", "Takeout"][k], who, k === 0 ? { mode: "SPLIT", splits: equalSplit(amt) } : { mode: "OWNER" });
    }
    exp(A.partnerChq, C.fuel, rnd(55, 85), d(9), "Fuel", partner, { mode: "HOUSEHOLD" });
    exp(A.meChq, C.fuel, rnd(55, 90), d(23), "Fuel", me, { mode: "HOUSEHOLD" });
    // personal spending (allocated to the person who spent it)
    exp(A.meChq, C.shopping, rnd(40, 160), d(13), "Personal shopping", me);
    exp(A.partnerChq, C.shopping, rnd(50, 170), d(16), "Personal shopping", partner);
    exp(A.partnerChq, C.personal, rnd(30, 90), d(21), "Salon", partner);
    exp(A.meChq, C.ent, rnd(25, 80), d(24), "Movies and games", me);
    if (m % 2 === 0) exp(A.meChq, C.health, rnd(22, 64), d(17), "Pharmacy", me, { mode: "HOUSEHOLD" });
    if (m === 5) exp(A.partnerChq, C.maint, 486.2, d(19), "Winter tire swap and service", partner, { mode: "HOUSEHOLD" });
    if (m === 8) exp(visa.accountId, C.travel, 1180, d(12), "Family trip flights", me, { mode: "SPLIT", splits: equalSplit(1180) }), (visaSpend += 1180);
    // subscriptions on the card
    for (const [n, a, who] of [["Streaming service", 17.99, me], ["Music streaming", 11.99, partner], ["Cloud storage", 3.99, me], ["Gym membership", m > 6 ? 54.99 : 49.99, partner]] as const) { exp(visa.accountId, C.subs, a, d(15), n, who, { mode: "OWNER" }); visaSpend += a; }
    if (m === 7) add({ accountId: visa.accountId, type: "REFUND", amount: "64.50", date: d(20), description: "Refund: returned item", categoryId: C.shopping, owner: me, payer: me, mode: "OWNER" });
    // card payment is a transfer, so the spending is counted once
    if (m > 0) transfer(A.meChq, visa.accountId, Math.round(visaSpend * 100) / 100, d(27), "Credit card payment", me), (visaSpend = 0);
    else visaSpend = 0;
    // savings and investing
    transfer(A.meChq, A.emergency, 450, d(25), "Emergency fund", me);
    transfer(A.partnerChq, A.emergency, 350, d(25), "Emergency fund", partner);
    transfer(A.meChq, A.house, 650, d(26), "House down payment", me);
    transfer(A.partnerChq, A.house, 550, d(26), "House down payment", partner);
    transfer(A.partnerChq, A.private, 200, d(28), "Private savings", partner, "PERSONAL");
    transfer(A.meChq, A.tfsa, 300, d(26), "TFSA contribution", me);
    transfer(A.partnerChq, A.rrsp, 400, d(26), "RRSP contribution", partner);
    if (m % 3 === 1) exp(A.partnerChq, C.shopping, rnd(60, 110), d(22), "Gift (private)", partner, { vis: "PERSONAL" });
  }

  // write rows
  const futureSafe = rows.filter((x) => x.date <= ctx.today);
  const ids = new Map<string, string>();
  const accDefaults = await db.finAccount.findMany({ where: { householdId: ctx.householdId }, select: { id: true, visibility: true, ownerMemberId: true } });
  const accVis = new Map(accDefaults.map((a) => [a.id, a]));
  const ptx = new Map<string, string>();
  for (const p of debtPayments) {
    const dp = await db.debtPayment.create({ data: { debtId: p.debtId, date: toDate(p.date), total: money(p.total), principal: money(p.principal), interest: money(p.interest), fromAccountId: p.from, memberId: p.owner, note: "Demo payment" } });
    ptx.set(p.ptxId, dp.id);
  }
  const data = futureSafe.map((x) => {
    const id = randomUUID();
    ids.set(id, id);
    const acct = accVis.get(x.accountId)!;
    const vis = x.vis ?? (acct.visibility === "PERSONAL" ? "PERSONAL" : "HOUSEHOLD");
    return { row: x, data: { id, householdId: ctx.householdId, accountId: x.accountId, type: x.type as never, status: "POSTED" as const, amount: x.amount, currency: "CAD", date: toDate(x.date), description: x.description, categoryId: x.categoryId ?? null, ownerMemberId: x.owner, payerMemberId: x.payer, allocationMode: ((x.mode ?? "OWNER") as never), visibility: vis as never, sharedWithMemberIds: [] as string[], transferGroupId: x.group ?? null, debtPaymentId: x.debtPaymentId ? ptx.get(x.debtPaymentId) ?? null : null, incomeSourceId: x.incomeSourceId ?? null, createdById: x.user, updatedById: x.user } };
  });
  const splitRows = data.filter((x) => x.row.mode === "SPLIT" && x.row.splits).flatMap((x) => x.row.splits!.map((s) => ({ transactionId: x.data.id, memberId: s.memberId, amount: s.amount })));
  // rows and their allocations are committed together, which is what the database's deferred allocation check requires
  await db.$transaction(async (tx) => {
    for (let i = 0; i < data.length; i += 400) await tx.finTransaction.createMany({ data: data.slice(i, i + 400).map((x) => x.data) });
    if (splitRows.length) await tx.transactionAllocation.createMany({ data: splitRows });
  }, { timeout: 60_000 });

  // keep debt next-due dates consistent with the payments recorded above
  await db.debt.update({ where: { id: mortgage.id }, data: { nextDueDate: toDate(addDays(startOfMonth(addMonths(ctx.today, ctx.today.slice(8) > "03" ? 1 : 0)), 2)) } });

  // investments: valuations and entries
  const inv = await db.investmentProfile.findMany({ where: { accountId: { in: [A.tfsa, A.rrsp] } } });
  for (const p of inv) {
    const isTfsa = p.accountId === A.tfsa;
    let v = isTfsa ? 14000 : 26000;
    const monthly = isTfsa ? 300 : 400;
    for (let m = 0; m < 12; m++) {
      const date = day(m, 28) > ctx.today ? ctx.today : day(m, 28);
      v = v * (1 + rnd(-0.012, 0.022)) + monthly;
      await db.investmentValuation.upsert({ where: { profileId_date: { profileId: p.id, date: toDate(date) } }, create: { profileId: p.id, date: toDate(date), marketValue: money(v), source: "manual statement" }, update: {} });
      await db.investmentEntry.create({ data: { profileId: p.id, kind: "CONTRIBUTION", date: toDate(day(m, 26)), amount: money(monthly), note: "Monthly contribution" } });
    }
    await db.investmentProfile.update({ where: { id: p.id }, data: { investmentType: isTfsa ? "Index funds" : "Balanced funds", allocation: isTfsa ? [{ assetClass: "Equities", percent: 85 }, { assetClass: "Bonds", percent: 15 }] : [{ assetClass: "Equities", percent: 60 }, { assetClass: "Bonds", percent: 35 }, { assetClass: "Cash", percent: 5 }] } });
  }
  // contribution entries are linked to the transfers above, so they must not create more ledger rows

  // assets
  const homeV = await createAsset(ctx, assetSchema.parse({ name: "Family home", kind: "PROPERTY", currentValue: "452000.00", valuationDate: addMonths(ctx.today, -1), valuationSource: "Demo online estimate", details: { address: "1 Demo Street (illustrative)", purchasePrice: "410000.00", purchaseDate: "2022-06-01", annualPropertyTax: "3960.00" } }));
  await db.assetValuation.createMany({ data: [[-11, 436000], [-6, 441000], [-3, 447000]].map(([o, v]) => ({ assetId: homeV.id, date: toDate(addMonths(ctx.today, o)), value: money(v), source: "Demo online estimate" })) });
  await db.debt.update({ where: { id: mortgage.id }, data: { assetId: homeV.id } });
  await createAsset(ctx, assetSchema.parse({ name: "Family SUV", kind: "VEHICLE", currentValue: "21500.00", valuationSource: "Demo guide", details: { make: "Demo", model: "SUV", year: 2020 } }));
  await createAsset(ctx, assetSchema.parse({ name: "Sedan (partner)", kind: "VEHICLE", currentValue: "12800.00", valuationSource: "Demo guide", details: { make: "Demo", model: "Sedan", year: 2018 }, assignToMemberId: partner }));

  // bills, subscriptions, insurance
  const billsDef = [["Electricity", "ELECTRICITY", "112.00", 6], ["Natural gas", "NATURAL_GAS", "85.00", 6], ["Internet", "INTERNET", "89.99", 8], ["Property tax", "PROPERTY_TAX", "330.00", 5], ["Mobile phones", "PHONE", "128.00", 11]] as const;
  for (const [name, kind, amount, dom] of billsDef) { const due = day(11, dom); await createBill(ctx, billSchema.parse({ name, kind, provider: `Demo ${name} provider`, amount, frequency: "MONTHLY", dueDate: due, accountId: A.joint, reminderDays: [3], visibility: "HOUSEHOLD" })); }
  for (const [n, a, who, next] of [["Streaming service", "17.99", me, 15], ["Music streaming", "11.99", partner, 15], ["Cloud storage", "3.99", me, 15], ["Gym membership", "54.99", partner, 15]] as const) {
    const s = await createSubscription(ctx, subscriptionSchema.parse({ name: n, amount: a, frequency: "MONTHLY", nextBillingDate: addDays(addMonths(startOfMonth(ctx.today), ctx.today.slice(8) > "15" ? 1 : 0), 14), accountId: visa.accountId, assignToMemberId: who, category: n.includes("Gym") ? "Fitness" : "Streaming" }));
    if (n === "Gym membership") await db.recurringSubscription.update({ where: { id: s.id }, data: { priceHistory: [{ date: addMonths(ctx.today, -11).slice(0, 10), amount: "49.99" }, { date: addMonths(ctx.today, -5), amount: "54.99" }] } });
  }
  await createInsurance(ctx, insuranceSchema.parse({ kind: "VEHICLE", provider: "Demo Insurance", policyName: "Auto policy", policyNumberLast4: "4821", premium: "214.00", frequency: "MONTHLY", renewalDate: addDays(ctx.today, 38), coverageAmount: "2000000.00", insuredMemberIds: [me, partner], accountId: A.partnerChq }));
  await createInsurance(ctx, insuranceSchema.parse({ kind: "HOME", provider: "Demo Insurance", policyName: "Home policy", policyNumberLast4: "1177", premium: "112.00", frequency: "MONTHLY", renewalDate: addDays(ctx.today, 140), coverageAmount: "450000.00", insuredMemberIds: [me, partner], accountId: A.joint }));
  await createInsurance(ctx, insuranceSchema.parse({ kind: "LIFE", provider: "Demo Life", policyName: "Term life (you)", policyNumberLast4: "9034", premium: "64.00", frequency: "MONTHLY", renewalDate: addDays(ctx.today, 260), coverageAmount: "750000.00", beneficiary: "Partner", insuredMemberIds: [me], accountId: A.meChq, visibility: "PERSONAL" }));

  // goals
  await createGoal(ctx, goalSchema.parse({ name: "Emergency fund", kind: "EMERGENCY_FUND", tracking: "ACCOUNT_BALANCE", accountId: A.emergency, targetAmount: "24000.00", monthlyContribution: "800.00", targetDate: addMonths(ctx.today, 12), priority: 1 }));
  const house = await createGoal(ctx, goalSchema.parse({ name: "House down payment", kind: "HOME_DOWN_PAYMENT", targetAmount: "80000.00", startingAmount: "9500.00", accountId: A.house, monthlyContribution: "1200.00", targetDate: addMonths(ctx.today, 30), assignedMemberIds: [me, partner], priority: 1 }));
  await createGoal(ctx, goalSchema.parse({ name: "Pay off line of credit", kind: "DEBT_PAYOFF", tracking: "DEBT_BALANCE", debtId: loc.id, targetAmount: "8000.00", monthlyContribution: "200.00", targetDate: addMonths(ctx.today, 20), visibility: "PERSONAL", priority: 2 }));
  await createGoal(ctx, goalSchema.parse({ name: "Family vacation", kind: "VACATION", targetAmount: "4500.00", startingAmount: "600.00", monthlyContribution: "250.00", targetDate: addMonths(ctx.today, 8), priority: 3, assignedMemberIds: [me, partner] }));
  const houseRows = await db.finTransaction.findMany({ where: { householdId: ctx.householdId, accountId: A.house, type: "TRANSFER", amount: { gt: 0 } } });
  await db.goalContribution.createMany({ data: houseRows.map((t) => ({ goalId: house.id, date: t.date, amount: t.amount, memberId: t.ownerMemberId, note: "Monthly contribution", transferGroupId: t.transferGroupId })) });

  // budgets
  const lines = async (scale = 1) => [[C.groceries, 800], [C.restaurants, 250], [C.fuel, 220], [C.electricity, 140], [C.gas, 110], [C.internet, 90], [C.phone, 130], [C.ent, 120], [C.shopping, 300], [C.personal, 90], [C.health, 80], [C.subs, 95], [C.carIns, 220]].map(([categoryId, amount]) => ({ categoryId: categoryId as string, amount: money((amount as number) * scale), rollover: categoryId === C.groceries, warnAtPct: 85 }));
  for (const off of [-2, -1, 0]) { const ref = addMonths(ctx.today, off); await createBudget(ctx, budgetSchema.parse({ name: "Household budget", period: "MONTHLY", scope: "HOUSEHOLD", startDate: ref, lines: await lines(off === -2 ? 0.95 : 1) })); }
  await createBudget(ctx, budgetSchema.parse({ name: "My personal budget", period: "MONTHLY", scope: "PERSONAL", startDate: ctx.today, lines: [{ categoryId: C.shopping, amount: "180.00" }, { categoryId: C.ent, amount: "90.00" }, { categoryId: C.restaurants, amount: "120.00" }] }));

  // contribution arrangement, settlement, tax, calendar
  await createRule(ctx, ruleSchema.parse({ name: "Shared costs in proportion to net income", arrangement: "INCOME_BASED", participants: [me, partner], percentOfNet: 40, effectiveFrom: start, active: true }));
  await db.settlement.create({ data: { householdId: ctx.householdId, fromMemberId: partner, toMemberId: me, amount: "250.00", currency: "CAD", date: toDate(addDays(ctx.today, -9)), note: "Reimbursement for groceries paid on the card", createdById: partnerUserId } });
  const ty = Number(ctx.today.slice(0, 4)) - 1;
  for (const [k, a] of [["EMPLOYMENT_INCOME", "93600.00"], ["TAX_DEDUCTED", "17800.00"], ["RRSP_CONTRIBUTION", "4000.00"], ["CHARITABLE_DONATION", "350.00"]] as const) await createTaxRecord(ctx, taxRecordSchema.parse({ taxYear: ty, kind: k, amount: a, visibility: "PERSONAL" }));
  await createEvent(ctx, eventSchema.parse({ title: "Review the household budget together", date: addDays(ctx.today, 6), notes: "Illustrative reminder" }));
  await db.householdMember.update({ where: { id: partner }, data: { responsibilities: "Utilities and insurance" } });
  await db.householdMember.update({ where: { id: me }, data: { responsibilities: "Mortgage, savings and investments" } });
  await db.household.update({ where: { id: ctx.householdId }, data: { onboardedAt: new Date() } });
  return { transactions: futureSafe.length };
}

/** Creates a demo household for the signed-in user, with a second (non-login) member. The demo can be removed in one step. */
export async function createDemoHousehold(actor: Actor) {
  const { id } = await createFinanceHousehold(actor, { name: DEMO_LABEL, countryCode: "CA", region: "AB", city: "Calgary", currency: "CAD", fiscalYearStartMonth: 1, dateFormat: "YYYY-MM-DD", numberLocale: "en-CA", structure: "Two earners", goalsPreference: ["Emergency fund", "Buy a home"], budgetPeriod: "MONTHLY", completeOnboarding: true } as never, { demo: true });
  const tag = randomUUID().slice(0, 8);
  const user = await db.user.create({ data: { email: `demo.partner.${tag}@demo.invalid`, name: "Sam Rivera (demo partner)", emailVerifiedAt: new Date(), preference: { create: {} } } });
  const m = await db.householdMember.create({ data: { householdId: id, userId: user.id, role: "MEMBER", avatarColor: AVATAR_COLORS[1] } });
  await ensureMemberDefaults(id, user.id);
  await db.memberPrivacy.upsert({ where: { householdMemberId: m.id }, create: { householdMemberId: m.id }, update: {} });
  const ctx = await finCtx(actor, id, "write");
  await populateDemoData(ctx, m.id);
  return { id };
}
export { ZERO, D, periodicRate, endOfMonth, fmtUnused };
function fmtUnused() { return null; }
