import { describe, expect, it } from "vitest";
import { D, money, sum, pct } from "@/server/finance/engine/decimal";
import { accountBalance, balances, monthlySeries, periodTotals, resolveAncestor, rollUpToRoot, spendByCategory, toBase, transferImbalance, type LedgerAccount, type LedgerTx } from "@/server/finance/engine/ledger";
import { makeFx, noFx } from "@/server/finance/engine/fx";

const acct = (id: string, type: string, opening: string, cur = "CAD"): LedgerAccount => ({ id, type, currency: cur, openingBalance: opening, openingDate: "2026-01-01" });
const tx = (o: Partial<LedgerTx> & Pick<LedgerTx, "id" | "accountId" | "type" | "amount" | "date">): LedgerTx => ({ currency: "CAD", status: "POSTED", ...o });

describe("decimal safety", () => {
  it("does not suffer binary floating point drift", () => {
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(money(D("0.1").plus(D("0.2")))).toBe("0.30");
    expect(sum(Array(10).fill("0.10")).toFixed(2)).toBe("1.00");
  });
  it("rounds half up to cents and handles zero denominators", () => {
    expect(money("1.005")).toBe("1.01");
    expect(money("-1.005")).toBe("-1.01");
    expect(pct(5, 0)).toBeNull();
    expect(pct(1, 3)!.toString()).toBe("33.33");
  });
  it("rejects non finite numbers", () => {
    expect(() => D(NaN)).toThrow();
    expect(() => D(Infinity)).toThrow();
  });
});

describe("balances", () => {
  const accts = [acct("chq", "CHEQUING", "1000.00"), acct("cc", "CREDIT_CARD", "-200.00")];
  it("balance = opening + posted transactions only", () => {
    const txs = [
      tx({ id: "1", accountId: "chq", type: "INCOME", amount: "2500.00", date: "2026-02-01" }),
      tx({ id: "2", accountId: "chq", type: "EXPENSE", amount: "-100.10", date: "2026-02-02" }),
      tx({ id: "3", accountId: "chq", type: "EXPENSE", amount: "-999.00", date: "2026-02-03", status: "PLANNED" }),
      tx({ id: "4", accountId: "chq", type: "EXPENSE", amount: "-50.00", date: "2026-02-04", deleted: true }),
    ];
    expect(accountBalance(accts[0], txs).toFixed(2)).toBe("3399.90");
    expect(accountBalance(accts[0], txs, "2026-02-01").toFixed(2)).toBe("3500.00");
    expect(accountBalance(accts[0], txs, "2025-12-31").toFixed(2)).toBe("0.00");
  });
  it("calculates all balances in one pass and matches per-account results", () => {
    const txs = [tx({ id: "1", accountId: "cc", type: "EXPENSE", amount: "-80.00", date: "2026-02-02" }), tx({ id: "2", accountId: "chq", type: "INCOME", amount: "10.00", date: "2026-02-02" })];
    const b = balances(accts, txs);
    expect(b.get("cc")!.toFixed(2)).toBe("-280.00");
    expect(b.get("chq")!.toFixed(2)).toBe("1010.00");
    for (const a of accts) expect(b.get(a.id)!.eq(accountBalance(a, txs))).toBe(true);
  });
  it("a transfer between household accounts nets to zero", () => {
    const legs = [tx({ id: "a", accountId: "chq", type: "TRANSFER", amount: "-300.00", date: "2026-03-01", transferGroupId: "g" }), tx({ id: "b", accountId: "cc", type: "TRANSFER", amount: "300.00", date: "2026-03-01", transferGroupId: "g" })];
    expect(transferImbalance(legs)!.isZero()).toBe(true);
    const b = balances(accts, legs);
    expect(b.get("chq")!.plus(b.get("cc")!).toFixed(2)).toBe("800.00".replace("800.00", "800.00"));
  });
});

describe("period totals (no double counting)", () => {
  const accts = [acct("chq", "CHEQUING", "5000.00"), acct("cc", "CREDIT_CARD", "0.00")];
  const txs: LedgerTx[] = [
    tx({ id: "i", accountId: "chq", type: "INCOME", amount: "3000.00", date: "2026-03-01" }),
    tx({ id: "g", accountId: "cc", type: "EXPENSE", amount: "-400.00", date: "2026-03-05", categoryId: "groc" }), // card purchase
    tx({ id: "p1", accountId: "chq", type: "TRANSFER", amount: "-400.00", date: "2026-03-20", transferGroupId: "pay" }), // card payment
    tx({ id: "p2", accountId: "cc", type: "TRANSFER", amount: "400.00", date: "2026-03-20", transferGroupId: "pay" }),
    tx({ id: "r", accountId: "cc", type: "REFUND", amount: "40.00", date: "2026-03-10", categoryId: "groc" }),
    tx({ id: "a", accountId: "chq", type: "ADJUSTMENT", amount: "-5.00", date: "2026-03-30" }),
    tx({ id: "x", accountId: "chq", type: "EXPENSE", amount: "-999.00", date: "2026-03-12", status: "PLANNED" }),
    tx({ id: "d", accountId: "chq", type: "EXPENSE", amount: "-77.00", date: "2026-03-12", deleted: true }),
    tx({ id: "reimb", accountId: "chq", type: "REIMBURSEMENT", amount: "60.00", date: "2026-03-15", categoryId: "travel" }),
    tx({ id: "t", accountId: "chq", type: "EXPENSE", amount: "-160.00", date: "2026-03-14", categoryId: "travel" }),
  ];
  const conv = toBase(txs, "CAD", noFx()).txs;
  it("counts the card purchase once, ignores the card payment, subtracts refunds and reimbursements", () => {
    const t = periodTotals(conv, "2026-03-01", "2026-03-31");
    expect(t.income.toFixed(2)).toBe("3000.00");
    expect(t.grossExpenses.toFixed(2)).toBe("560.00");
    expect(t.refunds.toFixed(2)).toBe("100.00");
    expect(t.expenses.toFixed(2)).toBe("460.00");
    expect(t.netCashFlow.toFixed(2)).toBe("2540.00");
    expect(t.savingsRate!.toFixed(2)).toBe("84.67");
  });
  it("refunds reduce the category they point at", () => {
    const s = spendByCategory(conv, "2026-03-01", "2026-03-31");
    expect(s.get("groc")!.toFixed(2)).toBe("360.00");
    expect(s.get("travel")!.toFixed(2)).toBe("100.00");
  });
  it("net worth effect of all rows equals the balance change (ledger reconciles)", () => {
    const b = balances(accts, txs);
    const total = b.get("chq")!.plus(b.get("cc")!);
    // opening 5000 + income 3000 - groceries 400 + refund 40 - adjustment 5 + reimbursement 60 - travel 160 (transfer legs cancel)
    expect(total.toFixed(2)).toBe("7535.00");
  });
  it("monthly series spans empty months", () => {
    const s = monthlySeries(conv, "2026-02-01", "2026-04-30");
    expect(s.map((m) => m.month)).toEqual(["2026-02", "2026-03", "2026-04"]);
    expect(s[0].income.isZero()).toBe(true);
    expect(s[1].income.toFixed(2)).toBe("3000.00");
  });
  it("savings rate is null (not infinity) with no income", () => {
    expect(periodTotals(conv, "2026-02-01", "2026-02-28").savingsRate).toBeNull();
  });
});

describe("categories", () => {
  const parentOf = new Map<string, string | null>([["groc", "food"], ["rest", "food"], ["food", null]]);
  it("attributes spending to the most specific budgeted ancestor", () => {
    expect(resolveAncestor("groc", new Set(["food"]), parentOf)).toBe("food");
    expect(resolveAncestor("groc", new Set(["groc", "food"]), parentOf)).toBe("groc");
    expect(resolveAncestor("other", new Set(["food"]), parentOf)).toBeNull();
  });
  it("rolls children up to root categories", () => {
    const r = rollUpToRoot(new Map([["groc", D(10)], ["rest", D(5)]]), parentOf);
    expect(r.get("food")!.toFixed(2)).toBe("15.00");
  });
});

describe("currency", () => {
  it("never mixes currencies silently: missing rates are excluded and reported", () => {
    const txs = [tx({ id: "1", accountId: "a", type: "INCOME", amount: "100.00", currency: "USD", date: "2026-03-01" }), tx({ id: "2", accountId: "a", type: "INCOME", amount: "50.00", date: "2026-03-01" })];
    const r = toBase(txs, "CAD", noFx());
    expect(r.excluded).toHaveLength(1);
    expect(r.missingRates).toEqual(["USD->CAD"]);
    expect(periodTotals(r.txs, "2026-03-01", "2026-03-31").income.toFixed(2)).toBe("50.00");
  });
  it("converts with the latest rate on or before the transaction date, and supports inverse rates", () => {
    const fx = makeFx([{ base: "USD", quote: "CAD", rate: "1.30", asOf: "2026-01-01" }, { base: "USD", quote: "CAD", rate: "1.40", asOf: "2026-03-01" }]);
    expect(fx.convert("100", "USD", "CAD", "2026-02-15")!.amount.toFixed(2)).toBe("130.00");
    expect(fx.convert("100", "USD", "CAD", "2026-03-15")!.amount.toFixed(2)).toBe("140.00");
    expect(fx.convert("140", "CAD", "USD", "2026-03-15")!.amount.toFixed(2)).toBe("100.00");
    expect(fx.convert("100", "USD", "CAD", "2025-12-01")).toBeNull();
  });
});
