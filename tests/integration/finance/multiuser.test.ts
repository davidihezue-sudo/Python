import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { summarise } from "@/server/finance/analytics";
import { createIncome, incomeSummary, listIncome } from "@/server/finance/income";
import { createTransaction, deleteTransaction, getTransaction, listTransactions, updateTransaction, txQuerySchema } from "@/server/finance/transactions";
import { listAccounts, updateAccount, verifyAccountBalance } from "@/server/finance/accounts";
import { contributionReport, createRule, createSettlement } from "@/server/finance/contributions";
import { createTransfer } from "@/server/finance/transactions";
import { account, catId, coupleHousehold, ctxFor, spend } from "./helpers";
import { createActor } from "../helpers";

const q = (o: Record<string, unknown> = {}) => txQuerySchema.parse(o);
const RANGE = ["2026-03-01", "2026-03-31"] as const;

describe("David and Sharon: independent entry, one consolidated household view", () => {
  it("combines independently entered, shared expenses automatically and counts each once", async () => {
    const { david, sharon, householdId } = await coupleHousehold();
    const d = await ctxFor(david, householdId, "write"), s = await ctxFor(sharon, householdId, "write");
    const dAcct = await account(d, "David chequing"), sAcct = await account(s, "Sharon chequing");

    for (const [c, a] of [["Groceries", "250.00"], ["Fuel", "100.00"], ["Internet", "90.00"], ["Personal care", "120.00"]] as const) await spend(d, dAcct, c === "Internet" ? "Utilities" : c, a);
    for (const [c, a] of [["Groceries", "180.00"], ["Utilities", "110.00"], ["Restaurants", "75.00"], ["Personal care", "150.00"]] as const) await spend(s, sAcct, c, a);

    // ownership and entry attribution are automatic: nobody picked themselves
    const rows = await listTransactions(d, q({ view: "all", from: RANGE[0], to: RANGE[1] }));
    expect(rows.items.filter((t) => t.owner?.name === "David")).toHaveLength(4);
    expect(rows.items.find((t) => t.owner?.name === "Sharon")?.enteredBy?.name).toBe("Sharon");

    const household = await summarise(await ctxFor(david, householdId), "household", ...RANGE);
    expect(household.totals.expenses).toBe("1075.00");
    const byCat = Object.fromEntries(household.byCategory.map((c) => [c.name, c.amount]));
    expect(byCat.Groceries).toBe("430.00");
    expect(byCat["Personal care"]).toBe("270.00");
    expect(byCat.Utilities).toBe("200.00"); // internet 90 + electricity 110
    // Sharon sees exactly the same household figures
    const sharonView = await summarise(await ctxFor(sharon, householdId), "household", ...RANGE);
    expect(sharonView.totals.expenses).toBe("1075.00");
    // individual views see only their own
    expect((await summarise(await ctxFor(david, householdId), "my", ...RANGE)).totals.expenses).toBe("560.00");
    expect((await summarise(await ctxFor(sharon, householdId), "my", ...RANGE)).totals.expenses).toBe("515.00");
    // recorded by member, and the two members' figures add to the combined total
    const members = Object.fromEntries(household.byMember.map((m) => [m.member?.name, m.expensesRecorded]));
    expect(members).toMatchObject({ David: "560.00", Sharon: "515.00" });
  });

  it("combines gross and net income separately and respects income visibility", async () => {
    const { david, sharon, householdId } = await coupleHousehold();
    const d = await ctxFor(david, householdId, "write"), s = await ctxFor(sharon, householdId, "write");
    await createIncome(d, { name: "David salary", kind: "EMPLOYMENT", grossAmount: "8000.00", netAmount: "5800.00", frequency: "MONTHLY", nextPayDate: "2026-03-31" } as never);
    await createIncome(s, { name: "Sharon salary", kind: "EMPLOYMENT", grossAmount: "5500.00", netAmount: "4100.00", frequency: "MONTHLY", nextPayDate: "2026-03-31" } as never);
    const sum = await incomeSummary(await ctxFor(david, householdId), "household");
    expect(sum.combinedMonthlyGross).toBe("13500.00");
    expect(sum.combinedMonthlyNet).toBe("9900.00");
    expect(sum.members.map((m) => m.monthlyNet).sort()).toEqual(["4100.00", "5800.00"]);

    // Sharon keeps her income personal: David's household view no longer includes it, and he cannot read it at all
    const mine = (await listIncome(s, "my"))[0];
    await db.incomeSource.update({ where: { id: mine.id }, data: { visibility: "PERSONAL" } });
    const after = await incomeSummary(await ctxFor(david, householdId), "household");
    expect(after.combinedMonthlyNet).toBe("5800.00");
    expect((await listIncome(await ctxFor(david, householdId), "all")).map((i) => i.name)).toEqual(["David salary"]);
    // gross and net never mixed
    expect(after.combinedMonthlyGross).toBe("8000.00");
  });
});

describe("privacy is enforced by the backend, including against administrators", () => {
  it("a personal transaction is invisible to the household administrator and cannot be fetched by id", async () => {
    const { david, sharon, householdId } = await coupleHousehold(); // david is the administrator
    const s = await ctxFor(sharon, householdId, "write");
    const acct = await account(s, "Sharon private", { visibility: "PERSONAL" });
    const t = await spend(s, acct, "Personal care", "99.00", { visibility: "PERSONAL" });
    const d = await ctxFor(david, householdId, "admin");
    expect(d.isAdmin).toBe(true);
    await expect(getTransaction(d, t.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(updateTransaction(d, t.id, { description: "tamper" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(deleteTransaction(d, t.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await listTransactions(d, q())).items).toHaveLength(0);
    expect((await listAccounts(d)).items.map((a) => a.name)).not.toContain("Sharon private");
    expect((await summarise(d, "household", ...RANGE)).totals.expenses).toBe("0.00");
    // even asking for Sharon's records explicitly returns nothing
    const bySharon = await listTransactions(d, q({ member: s.me.id }));
    expect(bySharon.items).toHaveLength(0);
    // a hidden account cannot be used as a payment account either
    await expect(createTransaction(d, { type: "EXPENSE", accountId: acct, amount: "5.00", date: "2026-03-01", description: "x" } as never)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(d.hiddenAccountCount).toBe(1);
  });

  it("shared with selected members is visible only to those members", async () => {
    const { david, sharon, householdId } = await coupleHousehold();
    const third = await createActor("Alex", "alex@example.com");
    const { createInvite, acceptInvite } = await import("@/server/services/households");
    const inv = await createInvite(david, householdId, { email: third.email, role: "MEMBER", vehicleAccess: [] } as never);
    await acceptInvite(third, inv.inviteUrl.split("/invite/")[1]);
    const d = await ctxFor(david, householdId, "write");
    const acct = await account(d, "Joint-ish");
    const t = await spend(d, acct, "Groceries", "40.00", { visibility: "SELECTED", sharedWithMemberIds: [(await ctxFor(sharon, householdId)).me.id] });
    expect((await listTransactions(await ctxFor(sharon, householdId), q())).items.map((x) => x.id)).toContain(t.id);
    expect((await listTransactions(await ctxFor(third, householdId), q())).items).toHaveLength(0);
    await expect(getTransaction(await ctxFor(third, householdId), t.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    // sharing with nobody is rejected
    await expect(spend(d, acct, "Groceries", "1.00", { visibility: "SELECTED", sharedWithMemberIds: [] })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    // cannot share with someone outside the household
    await expect(spend(d, acct, "Groceries", "1.00", { visibility: "SELECTED", sharedWithMemberIds: ["cxxxxxxxxxxxxxxxxxxxxxxxx"] })).rejects.toBeTruthy();
  });

  it("only the owner can change visibility; shared edits are audited with the editor", async () => {
    const { david, sharon, householdId } = await coupleHousehold();
    const d = await ctxFor(david, householdId, "write"), s = await ctxFor(sharon, householdId, "write");
    const acct = await account(d, "Joint", { joint: true });
    const t = await spend(d, acct, "Groceries", "60.00");
    await expect(updateTransaction(s, t.id, { visibility: "PERSONAL" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await updateTransaction(s, t.id, { notes: "Sharon corrected the note", categoryId: await catId(s, "Restaurants") });
    const detail = await getTransaction(d, t.id);
    expect(detail.owner?.name).toBe("David");
    expect(detail.enteredBy?.name).toBe("David");
    expect(detail.lastModifiedBy?.name).toBe("Sharon");
    expect(detail.history.map((h) => h.action)).toEqual(expect.arrayContaining(["create", "update"]));
    expect(detail.history.find((h) => h.action === "update")?.by?.name).toBe("Sharon");
  });

  it("a read-only member can see shared records but can never write", async () => {
    const { david, householdId } = await coupleHousehold();
    const viewer = await createActor("Viewer", "viewer@example.com");
    const { createInvite, acceptInvite } = await import("@/server/services/households");
    const inv = await createInvite(david, householdId, { email: viewer.email, role: "READ_ONLY", vehicleAccess: [] } as never);
    await acceptInvite(viewer, inv.inviteUrl.split("/invite/")[1]);
    const d = await ctxFor(david, householdId, "write");
    const acct = await account(d, "Joint", { joint: true });
    await spend(d, acct, "Groceries", "10.00");
    const v = await ctxFor(viewer, householdId);
    expect(v.canWrite).toBe(false);
    expect((await listTransactions(v, q())).items).toHaveLength(1);
    await expect(ctxFor(viewer, householdId, "write")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(createTransaction(v, { type: "EXPENSE", accountId: acct, amount: "1.00", date: "2026-03-01", description: "x" } as never)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("household isolation", () => {
  it("another household's ids never resolve, however they are supplied", async () => {
    const a = await coupleHousehold();
    const outsider = await createActor("Mallory", "mallory@example.com");
    const { listHouseholds } = await import("@/server/services/households");
    const theirs = (await listHouseholds(outsider))[0].id;
    const d = await ctxFor(a.david, a.householdId, "write");
    const acct = await account(d, "Joint", { joint: true });
    const t = await spend(d, acct, "Groceries", "10.00");
    await expect(ctxFor(outsider, a.householdId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const m = await ctxFor(outsider, theirs, "write");
    await expect(getTransaction(m, t.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(updateTransaction(m, t.id, { notes: "x" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(createTransaction(m, { type: "EXPENSE", accountId: acct, amount: "1.00", date: "2026-03-01", description: "x" } as never)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(updateAccount(m, acct, { name: "pwned" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(verifyAccountBalance(m, acct)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await summarise(m, "household", ...RANGE)).totals.expenses).toBe("0.00");
  });
});

describe("expense allocation and double counting", () => {
  it("a $2,000 mortgage paid by David and allocated to the household is one expense", async () => {
    const { david, sharon, householdId } = await coupleHousehold();
    const d = await ctxFor(david, householdId, "write"), s = await ctxFor(sharon, householdId, "write");
    const acct = await account(d, "David chequing");
    await spend(d, acct, "Housing", "2000.00", { allocation: { mode: "HOUSEHOLD" } });
    const sh = await summarise(await ctxFor(sharon, householdId), "household", ...RANGE);
    expect(sh.totals.expenses).toBe("2000.00");
    expect(sh.expenseSplit).toMatchObject({ shared: "2000.00", personal: "0.00" });
    expect(sh.byMember.find((m) => m.member?.name === "David")).toMatchObject({ expensesPaid: "2000.00", expensesRecorded: "2000.00" });
    void s;
  });

  it("splits by percent and by amount, require exact totals, and never change the household total", async () => {
    const { david, sharon, householdId } = await coupleHousehold();
    const d = await ctxFor(david, householdId, "write");
    const sid = (await ctxFor(sharon, householdId)).me.id;
    const acct = await account(d, "David chequing");
    await expect(spend(d, acct, "Groceries", "500.00", { allocation: { mode: "SPLIT", splits: [{ memberId: d.me.id, percent: 60 }, { memberId: sid, percent: 30 }] } })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(spend(d, acct, "Groceries", "500.00", { allocation: { mode: "SPLIT", splits: [{ memberId: d.me.id, amount: "300.00" }, { memberId: sid, amount: "100.00" }] } })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    const pct = await spend(d, acct, "Groceries", "500.01", { allocation: { mode: "SPLIT", splits: [{ memberId: d.me.id, percent: 50 }, { memberId: sid, percent: 50 }] } });
    const amt = await spend(d, acct, "Groceries", "100.00", { allocation: { mode: "SPLIT", splits: [{ memberId: d.me.id, amount: "70.00" }, { memberId: sid, amount: "30.00" }] } });
    const eq = await spend(d, acct, "Groceries", "100.00", { allocation: { mode: "SPLIT", splits: [{ memberId: d.me.id }, { memberId: null }, { memberId: sid }] } });
    for (const t of [pct, amt, eq]) {
      const v = await getTransaction(d, t.id);
      expect(v.allocations.reduce((a, x) => a + Number(x.amount) * 100, 0)).toBe(Math.abs(Number(v.amount)) * 100);
    }
    expect((await getTransaction(d, pct.id)).allocations.map((a) => a.amount).sort()).toEqual(["250.00", "250.01"]);
    const sh = await summarise(await ctxFor(david, householdId), "household", ...RANGE);
    expect(sh.totals.expenses).toBe("700.01"); // 500.01 + 100 + 100, each counted once
    expect(Number(sh.expenseSplit.shared) + Number(sh.expenseSplit.personal)).toBeCloseTo(700.01, 2);
  });

  it("the database itself rejects allocations that do not add up", async () => {
    const { david, householdId } = await coupleHousehold();
    const d = await ctxFor(david, householdId, "write");
    const acct = await account(d, "Joint", { joint: true });
    const t = await spend(d, acct, "Groceries", "100.00");
    await expect(db.$transaction(async (tx) => {
      await tx.finTransaction.update({ where: { id: t.id }, data: { allocationMode: "SPLIT" } });
      await tx.transactionAllocation.create({ data: { transactionId: t.id, memberId: d.me.id, amount: "60.00" } });
    })).rejects.toThrow(/must add up/);
    await expect(db.finTransaction.update({ where: { id: t.id }, data: { amount: "50.00" } })).rejects.toThrow(); // sign check: expense must stay negative
    await expect(db.finAccount.update({ where: { id: acct }, data: { visibility: "PERSONAL" } })).rejects.toThrow(); // joint accounts must be household visible
  });

  it("a reimbursement between members is a settlement, never another expense", async () => {
    const { david, sharon, householdId } = await coupleHousehold();
    const d = await ctxFor(david, householdId, "write"), s = await ctxFor(sharon, householdId, "write");
    const dAcct = await account(d, "David chequing"), sAcct = await account(s, "Sharon chequing");
    await spend(d, dAcct, "Groceries", "500.00", { allocation: { mode: "HOUSEHOLD" } }); // David pays for the household
    await createRule(d, { name: "Split evenly", arrangement: "SHARED_EQUAL", participants: [d.me.id, s.me.id], effectiveFrom: "2026-01-01", active: true } as never);
    let rep = await contributionReport(d, ...RANGE);
    const dm = (n: string) => rep.members.find((m) => m.member?.name === n)!;
    expect(rep.pool).toBe("500.00");
    expect(dm("David")).toMatchObject({ paidTotal: "500.00", shareOfSharedExpenses: "250.00", netPosition: "250.00" });
    expect(dm("Sharon")).toMatchObject({ paidTotal: "0.00", netPosition: "-250.00" });
    expect(rep.suggestedSettlements[0]).toMatchObject({ amount: "250.00", from: { name: "Sharon" }, to: { name: "David" } });

    const before = (await summarise(d, "household", ...RANGE)).totals.expenses;
    await createSettlement(s, { fromMemberId: s.me.id, toMemberId: d.me.id, amount: "250.00", date: "2026-03-15", fromAccountId: sAcct } as never);
    rep = await contributionReport(await ctxFor(david, householdId), ...RANGE);
    expect(rep.members.find((m) => m.member?.name === "David")!.netPosition).toBe("0.00");
    expect(rep.members.find((m) => m.member?.name === "Sharon")!.netPosition).toBe("0.00");
    const after = await summarise(await ctxFor(david, householdId), "household", ...RANGE);
    expect(after.totals.expenses).toBe(before); // no new expense, no income
    expect(after.totals.income).toBe("0.00");
    // her account balance still reconciles with its ledger
    expect((await verifyAccountBalance(s, sAcct)).matches).toBe(true);
    expect((await listAccounts(s, "my")).items.find((a) => a.id === sAcct)?.currentBalance).toBe("4750.00");
  });

  it("transfers into a joint account count as contributions and never as income or expenses", async () => {
    const { david, sharon, householdId } = await coupleHousehold();
    const d = await ctxFor(david, householdId, "write");
    const mine = await account(d, "David chequing"), joint = await account(d, "Joint", { joint: true, openingBalance: "0.00" });
    await createTransfer(d, { fromAccountId: mine, toAccountId: joint, amount: "1000.00", date: "2026-03-05", description: "Monthly contribution" } as never);
    const sum = await summarise(await ctxFor(sharon, householdId), "household", ...RANGE);
    expect(sum.totals).toMatchObject({ income: "0.00", expenses: "0.00" });
    const rep = await contributionReport(await ctxFor(sharon, householdId), ...RANGE);
    expect(rep.members.find((m) => m.member?.name === "David")!.transfersToJointAccounts).toBe("1000.00");
    // David's personal leg is invisible to Sharon only if his account is personal; the joint leg is visible to her
    const hh = await listAccounts(await ctxFor(sharon, householdId), "household");
    expect(hh.items.find((a) => a.name === "Joint")?.currentBalance).toBe("1000.00");
  });
});
