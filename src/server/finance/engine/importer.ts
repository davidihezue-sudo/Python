// CSV import pipeline: parse, map columns, normalise rows, detect duplicates. Pure functions, no database access.
import { createHash } from "node:crypto";
import { D, Dec, ZERO, type Dec as DecT } from "./decimal";
import { isIsoDate } from "@/lib/dates";

export function parseCsv(text: string, delimiter?: string): { headers: string[]; rows: string[][]; delimiter: string } {
  const src = text.replace(/^﻿/, "");
  const delim = delimiter ?? detectDelimiter(src);
  const rows: string[][] = [];
  let row: string[] = [],
    field = "",
    inQ = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQ) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else inQ = false;
      } else field += c;
    } else if (c === '"') inQ = true;
    else if (c === delim) {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((x) => x.trim() !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((x) => x.trim() !== "")) rows.push(row);
  const headers = (rows.shift() ?? []).map((h) => h.trim());
  return { headers, rows: rows.map((r) => r.map((x) => x.trim())), delimiter: delim };
}
function detectDelimiter(s: string): string {
  const first = s.split(/\r?\n/, 1)[0] ?? "";
  const counts = [",", ";", "\t", "|"].map((d) => [d, first.split(d).length - 1] as const);
  return counts.sort((a, b) => b[1] - a[1])[0][1] > 0 ? counts.sort((a, b) => b[1] - a[1])[0][0] : ",";
}

export type DateOrder = "YMD" | "DMY" | "MDY";
export interface ColumnMapping {
  date: number | null;
  description: number | null;
  amount: number | null;
  debit: number | null;
  credit: number | null;
  type: number | null;
  account: number | null;
  category: number | null;
  postingDate: number | null;
  /** When the file's positive numbers are money leaving the account (some card exports), flip the sign. */
  invertSign: boolean;
  dateOrder: DateOrder;
}
const H = (h: string) => h.toLowerCase().replace(/[^a-z]/g, "");
export function detectMapping(headers: string[], sample: string[][]): ColumnMapping {
  const find = (...names: string[]) => {
    const i = headers.findIndex((h) => names.includes(H(h)));
    return i >= 0 ? i : null;
  };
  const m: ColumnMapping = {
    date: find("date", "transactiondate", "trandate", "txndate", "datetime", "bookingdate", "posteddate") ?? find("posted"),
    postingDate: find("postingdate", "posteddate", "postdate", "settlementdate"),
    description: find("description", "details", "memo", "payee", "merchant", "name", "narrative", "transactiondescription", "reference"),
    amount: find("amount", "transactionamount", "value", "amountcad", "amountusd"),
    debit: find("debit", "withdrawal", "withdrawals", "moneyout", "paidout", "debitamount"),
    credit: find("credit", "deposit", "deposits", "moneyin", "paidin", "creditamount"),
    type: find("type", "transactiontype", "debitcredit", "drcr", "creditdebit"),
    account: find("account", "accountname", "accountnumber", "accountno"),
    category: find("category", "categoryname"),
    invertSign: false,
    dateOrder: "YMD",
  };
  if (m.postingDate === m.date) m.postingDate = null;
  const dates = m.date === null ? [] : sample.map((r) => r[m.date as number]).filter(Boolean);
  m.dateOrder = guessDateOrder(dates);
  return m;
}

export function guessDateOrder(dates: string[]): DateOrder {
  let ymd = 0,
    firstOver12 = 0,
    secondOver12 = 0;
  for (const d of dates) {
    if (/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}/.test(d)) ymd++;
    const m = /^(\d{1,2})[-/.](\d{1,2})[-/.]\d{2,4}/.exec(d);
    if (m) {
      if (+m[1] > 12) firstOver12++;
      if (+m[2] > 12) secondOver12++;
    }
  }
  if (ymd >= Math.max(1, dates.length / 2)) return "YMD";
  if (firstOver12 > 0 && secondOver12 === 0) return "DMY";
  if (secondOver12 > 0 && firstOver12 === 0) return "MDY";
  return "MDY";
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
export function parseDate(raw: string, order: DateOrder): string | null {
  const s = raw.trim().replace(/T.*$/, "").replace(/\s+\d{1,2}:\d{2}.*$/, "");
  if (!s) return null;
  let y: number, mo: number, d: number;
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s);
  if (m) [y, mo, d] = [+m[1], +m[2], +m[3]];
  else if ((m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/.exec(s))) {
    const yy = +m[3] < 100 ? 2000 + +m[3] : +m[3];
    if (order === "DMY") [d, mo, y] = [+m[1], +m[2], yy];
    else [mo, d, y] = [+m[1], +m[2], yy];
  } else if ((m = /^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(s))) {
    mo = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1;
    [d, y] = [+m[2], +m[3]];
  } else if ((m = /^(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})$/.exec(s))) {
    mo = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1;
    [d, y] = [+m[1], +m[3]];
  } else return null;
  const iso = `${String(y).padStart(4, "0")}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return isIsoDate(iso) ? iso : null;
}

/** Parses "$1,234.56", "(45.00)", "45.00-", "1.234,56", "CR"/"DR" suffixes. Returns null when it is not a number. */
export function parseAmount(raw: string): DecT | null {
  let s = raw.trim();
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1);
  }
  if (/\bDR\b/i.test(s)) neg = true;
  s = s.replace(/\b(CR|DR)\b/gi, "").replace(/[A-Za-z$€£¥\s]/g, "");
  if (s.endsWith("-")) {
    neg = !neg;
    s = s.slice(0, -1);
  }
  if (s.startsWith("-")) {
    neg = !neg;
    s = s.slice(1);
  } else if (s.startsWith("+")) s = s.slice(1);
  // European style "1.234,56": the last separator is the decimal mark
  const lastComma = s.lastIndexOf(","),
    lastDot = s.lastIndexOf(".");
  if (lastComma > lastDot && s.length - lastComma - 1 <= 2) s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(/,/g, "");
  if (!/^\d*\.?\d+$|^\d+\.$/.test(s)) return null;
  const v = new Dec(s);
  return neg ? v.negated() : v;
}

export interface ParsedRow {
  line: number;
  date: string | null;
  postingDate: string | null;
  description: string;
  amount: DecT | null; // signed from the account's perspective after sign handling
  accountName: string | null;
  categoryName: string | null;
  typeHint: "INCOME" | "EXPENSE" | "TRANSFER" | "REFUND" | null;
  errors: string[];
}
const TYPE_HINT: [RegExp, ParsedRow["typeHint"]][] = [[/refund|return|reversal/i, "REFUND"], [/transfer|e-?transfer to|payment.*thank|credit card payment/i, "TRANSFER"], [/payroll|salary|deposit|direct dep|interest paid|income/i, "INCOME"]];

export function normaliseRows(rows: string[][], map: ColumnMapping): ParsedRow[] {
  const cell = (r: string[], i: number | null) => (i === null ? "" : (r[i] ?? ""));
  return rows.map((r, idx) => {
    const errors: string[] = [];
    const date = parseDate(cell(r, map.date), map.dateOrder);
    if (!date) errors.push("Date could not be read");
    const postingDate = map.postingDate === null ? null : parseDate(cell(r, map.postingDate), map.dateOrder);
    let amount: DecT | null = null;
    if (map.amount !== null) amount = parseAmount(cell(r, map.amount));
    else if (map.debit !== null || map.credit !== null) {
      const deb = parseAmount(cell(r, map.debit)),
        cred = parseAmount(cell(r, map.credit));
      if (deb && !deb.isZero()) amount = deb.abs().negated();
      else if (cred && !cred.isZero()) amount = cred.abs();
      else if (deb || cred) amount = ZERO;
    }
    if (amount === null) errors.push("Amount could not be read");
    else {
      if (map.invertSign) amount = amount.negated();
      const t = cell(r, map.type);
      if (t && map.amount !== null && /^(debit|dr|withdrawal|expense|purchase|payment)$/i.test(t.trim())) amount = amount.abs().negated();
      else if (t && map.amount !== null && /^(credit|cr|deposit|income|refund)$/i.test(t.trim())) amount = amount.abs();
      if (amount.isZero()) errors.push("Amount is zero");
    }
    const description = cell(r, map.description).replace(/\s+/g, " ").trim();
    if (!description) errors.push("Description is empty");
    let typeHint: ParsedRow["typeHint"] = null;
    for (const [re, t] of TYPE_HINT) if (re.test(description)) { typeHint = t; break; }
    if (!typeHint && amount) typeHint = amount.isNegative() ? "EXPENSE" : "INCOME";
    return { line: idx + 2, date, postingDate, description, amount, accountName: cell(r, map.account) || null, categoryName: cell(r, map.category) || null, typeHint, errors };
  });
}

const norm = (s: string) => s.toLowerCase().replace(/\d{4,}/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
/** Fingerprint of a transaction for duplicate detection. Identical rows in one file get a sequence number so true repeats survive. */
export function fingerprint(accountId: string, date: string, amount: DecT | string, description: string): string {
  return createHash("sha256").update(`${accountId}|${date}|${D(amount).toFixed(2)}|${norm(description)}`).digest("hex").slice(0, 32);
}
/** Marks each parsed row as duplicate when the (fingerprint, occurrence) pair already exists in the ledger or earlier in the same file. */
export function markDuplicates(rows: { key: string }[], existingCounts: Map<string, number>): boolean[] {
  const seen = new Map<string, number>();
  return rows.map((r) => {
    const n = (seen.get(r.key) ?? 0) + 1;
    seen.set(r.key, n);
    return n <= (existingCounts.get(r.key) ?? 0);
  });
}

// Built-in keyword suggestions map to category NAMES; the service resolves them to the household's category ids.
export const KEYWORD_CATEGORIES: [RegExp, string][] = [
  [/safeway|loblaw|sobeys|costco|walmart supercentre|save-on|superstore|no frills|grocer|co-?op food|farm boy|metro\b/i, "Groceries"],
  [/starbucks|tim hortons|mcdonald|restaurant|pizza|sushi|a&w|subway|cafe|coffee|bistro|grill|doordash|skip the dishes|uber eats/i, "Restaurants"],
  [/shell|esso|petro|husky|chevron|fas gas|gas bar|fuel/i, "Fuel"],
  [/netflix|spotify|disney|crave|prime video|apple\.com\/bill|youtube premium|icloud|dropbox|adobe/i, "Subscriptions"],
  [/telus|rogers|bell\b|fido|koodo|shaw|freedom mobile|virgin plus/i, "Phone and internet"],
  [/enmax|epcor|hydro|fortis|atco|direct energy|utilities|water bill/i, "Utilities"],
  [/insurance|intact|desjardins|co-operators|aviva|manulife|sun life|belair/i, "Insurance"],
  [/rent\b|landlord|property mgmt/i, "Rent"],
  [/mortgage/i, "Mortgage"],
  [/pharmacy|shoppers drug|rexall|london drugs|dental|dentist|physio|clinic/i, "Health"],
  [/uber\b|lyft|transit|parking|petro-?canada car wash|impark/i, "Transportation"],
  [/amazon|best buy|ikea|home depot|canadian tire|winners|marks/i, "Shopping"],
  [/payroll|salary|direct deposit/i, "Salary"],
];
export function suggestCategoryName(description: string): string | null {
  for (const [re, name] of KEYWORD_CATEGORIES) if (re.test(description)) return name;
  return null;
}
