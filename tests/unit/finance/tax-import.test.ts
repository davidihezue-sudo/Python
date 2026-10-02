import { describe, expect, it } from "vitest";
import { bracketTax, estimateTax, pickRuleYear, SEEDED_TAX_RULES, payrollEstimate } from "@/server/finance/engine/tax";
import { detectMapping, fingerprint, guessDateOrder, markDuplicates, normaliseRows, parseAmount, parseCsv, parseDate, suggestCategoryName } from "@/server/finance/engine/importer";

const fed = SEEDED_TAX_RULES.find((r) => r.country === "CA" && r.region === "" && r.year === 2025)!.data;
const ab = SEEDED_TAX_RULES.find((r) => r.region === "AB")!.data;

describe("tax estimation", () => {
  it("applies each bracket rate only to the slice inside it", () => {
    expect(bracketTax(0, fed.income.brackets).toFixed(2)).toBe("0.00");
    expect(bracketTax(50000, fed.income.brackets).toFixed(2)).toBe("7250.00");
    expect(bracketTax(100000, fed.income.brackets).toFixed(2)).toBe("17057.50");
    expect(bracketTax(-5, fed.income.brackets).toFixed(2)).toBe("0.00");
  });
  it("estimates payroll deductions within the configured limits", () => {
    const p = payrollEstimate(100000, fed.payroll!);
    expect(p.cpp.toFixed(2)).toBe("4430.10"); // 4034.10 base + 396.00 second ceiling
    expect(p.ei.toFixed(2)).toBe("1077.48");
  });
  it("RRSP deductions reduce taxable income; refund vs owing is separated from tax deducted", () => {
    const withRrsp = estimateTax({ employmentIncome: 90000, rrspContributions: 10000, taxDeducted: 19000 }, fed, ab);
    const without = estimateTax({ employmentIncome: 90000, taxDeducted: 19000 }, fed, ab);
    expect(withRrsp.taxableIncome.toFixed(2)).toBe("80000.00");
    expect(withRrsp.estimatedTax.lt(without.estimatedTax)).toBe(true);
    expect(without.estimatedRefund.isZero() || without.estimatedOwing.isZero()).toBe(true);
    const owing = estimateTax({ employmentIncome: 90000, taxDeducted: 100 }, fed, ab);
    expect(owing.estimatedOwing.gt(0)).toBe(true);
    expect(owing.estimatedOwing.minus(owing.estimatedTax.minus(100)).abs().lt("0.01")).toBe(true);
  });
  it("donation, tuition and medical credits reduce tax and never below zero", () => {
    const a = estimateTax({ employmentIncome: 60000, taxDeducted: 0 }, fed, null);
    const b = estimateTax({ employmentIncome: 60000, donations: 1000, tuition: 2000, medicalExpenses: 5000, taxDeducted: 0 }, fed, null);
    expect(b.federal.tax.lt(a.federal.tax)).toBe(true);
    expect(estimateTax({ employmentIncome: 5000, taxDeducted: 0 }, fed, ab).estimatedTax.toFixed(2)).toBe("0.00");
  });
  it("is honest about missing provincial rules and self-employment", () => {
    const e = estimateTax({ employmentIncome: 0, selfEmploymentIncome: 40000, taxDeducted: 0 }, fed, null);
    expect(e.warnings.join(" ")).toMatch(/No provincial/);
    expect(e.warnings.join(" ")).toMatch(/Self-employment/);
  });
  it("falls back to the latest earlier rule year and says so", () => {
    expect(pickRuleYear([{ year: 2024 }, { year: 2025 }], 2026)).toEqual({ set: { year: 2025 }, fellBackFrom: 2026 });
    expect(pickRuleYear([{ year: 2025 }], 2025).fellBackFrom).toBeNull();
    expect(pickRuleYear([{ year: 2025 }], 2020).set).toBeNull();
  });
});

describe("csv import", () => {
  it("parses quoted fields, embedded commas, escaped quotes, CRLF and BOM", () => {
    const r = parseCsv('﻿Date,Description,Amount\r\n2026-03-01,"Smith, J ""Bakery""",-12.50\r\n2026-03-02,Payroll,2500.00\r\n');
    expect(r.headers).toEqual(["Date", "Description", "Amount"]);
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0][1]).toBe('Smith, J "Bakery"');
  });
  it("detects semicolon and tab delimiters", () => {
    expect(parseCsv("a;b;c\n1;2;3").rows[0]).toEqual(["1", "2", "3"]);
    expect(parseCsv("a\tb\n1\t2").rows[0]).toEqual(["1", "2"]);
  });
  it("parses amounts in common bank formats", () => {
    expect(parseAmount("$1,234.56")!.toFixed(2)).toBe("1234.56");
    expect(parseAmount("(45.00)")!.toFixed(2)).toBe("-45.00");
    expect(parseAmount("45.00-")!.toFixed(2)).toBe("-45.00");
    expect(parseAmount("1.234,56")!.toFixed(2)).toBe("1234.56");
    expect(parseAmount("12.50 DR")!.toFixed(2)).toBe("-12.50");
    expect(parseAmount("abc")).toBeNull();
    expect(parseAmount("")).toBeNull();
  });
  it("parses and validates dates in several layouts", () => {
    expect(parseDate("2026-03-05", "YMD")).toBe("2026-03-05");
    expect(parseDate("03/05/2026", "MDY")).toBe("2026-03-05");
    expect(parseDate("03/05/2026", "DMY")).toBe("2026-05-03");
    expect(parseDate("Mar 5, 2026", "MDY")).toBe("2026-03-05");
    expect(parseDate("5 March 2026", "MDY")).toBe("2026-03-05");
    expect(parseDate("2026-02-30", "YMD")).toBeNull();
    expect(parseDate("nonsense", "YMD")).toBeNull();
    expect(guessDateOrder(["25/03/2026", "01/04/2026"])).toBe("DMY");
    expect(guessDateOrder(["03/25/2026"])).toBe("MDY");
    expect(guessDateOrder(["2026-03-25"])).toBe("YMD");
  });
  it("detects columns and normalises signed amounts and debit/credit layouts", () => {
    const a = parseCsv("Transaction Date,Description,Debit,Credit\n2026-03-01,Safeway,52.10,\n2026-03-02,Payroll,,2500.00");
    const m = detectMapping(a.headers, a.rows);
    expect(m).toMatchObject({ date: 0, description: 1, debit: 2, credit: 3 });
    const rows = normaliseRows(a.rows, m);
    expect(rows[0].amount!.toFixed(2)).toBe("-52.10");
    expect(rows[1].amount!.toFixed(2)).toBe("2500.00");
    expect(rows[0].typeHint).toBe("EXPENSE");
    expect(rows[1].typeHint).toBe("INCOME");
    const inv = normaliseRows([["2026-03-01", "Visa purchase", "40.00"]], { ...detectMapping(["Date", "Description", "Amount"], []), invertSign: true });
    expect(inv[0].amount!.toFixed(2)).toBe("-40.00");
  });
  it("reports row level errors instead of dropping rows silently", () => {
    const rows = normaliseRows([["bad date", "", "x"]], detectMapping(["Date", "Description", "Amount"], []));
    expect(rows[0].errors).toEqual(expect.arrayContaining(["Date could not be read", "Amount could not be read", "Description is empty"]));
  });
  it("detects duplicates against the ledger and inside the file, keeping genuine repeats", () => {
    const k = fingerprint("acc", "2026-03-01", "-4.50", "TIM HORTONS #1234");
    expect(k).toBe(fingerprint("acc", "2026-03-01", "-4.5", "tim hortons #9999"));
    expect(k).not.toBe(fingerprint("acc2", "2026-03-01", "-4.50", "TIM HORTONS"));
    const rows = [{ key: k }, { key: k }, { key: "other" }];
    expect(markDuplicates(rows, new Map([[k, 1]]))).toEqual([true, false, false]);
    expect(markDuplicates(rows, new Map())).toEqual([false, false, false]);
  });
  it("suggests categories from descriptions", () => {
    expect(suggestCategoryName("SAFEWAY #123")).toBe("Groceries");
    expect(suggestCategoryName("NETFLIX.COM")).toBe("Subscriptions");
    expect(suggestCategoryName("zzz unknown")).toBeNull();
  });
});
