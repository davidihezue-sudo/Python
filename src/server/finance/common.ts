// Shared validators, serialisers and small helpers for the finance services.
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { isIsoDate } from "@/lib/dates";
import { D, money } from "./engine/decimal";

export const id = z.string().min(5).max(40);
export const isoDate = z.string().refine(isIsoDate, "Enter a valid date (YYYY-MM-DD)");
export const optIso = isoDate.nullish();
export const currencyCode = z.string().regex(/^[A-Z]{3}$/, "Use a three letter currency code such as CAD");
const MONEY_RE = /^-?\d{1,12}(\.\d{1,2})?$/;

/** Money input: a string or number with at most two decimals. Returned as a canonical 2dp string (never a float). */
export const moneyIn = z.union([z.string(), z.number()]).transform((v, ctx) => {
  const s = typeof v === "number" ? (Number.isFinite(v) ? String(v) : "x") : v.trim().replace(/[$,\s]/g, "");
  if (!MONEY_RE.test(s)) {
    ctx.addIssue({ code: "custom", message: "Enter an amount with at most two decimal places" });
    return z.NEVER;
  }
  return money(s);
});
export const posMoney = moneyIn.refine((s) => D(s).gt(0), "Amount must be greater than zero");
export const nonNegMoney = moneyIn.refine((s) => !D(s).isNegative(), "Amount cannot be negative");
export const rateIn = z.union([z.string(), z.number()]).transform((v, ctx) => {
  const n = typeof v === "string" ? Number(v) : v;
  if (!Number.isFinite(n) || n < 0 || n > 100) {
    ctx.addIssue({ code: "custom", message: "Enter a percentage between 0 and 100" });
    return z.NEVER;
  }
  return String(Math.round(n * 10000) / 10000);
});
export const text = (max = 200) => z.string().trim().min(1).max(max);
/** Optional text. Omitted stays undefined (so partial updates leave it alone); an empty string or null clears it to null. */
export const optText = (max = 2000) => z.string().trim().max(max).nullish().transform((v) => (v === undefined ? undefined : v ? v : null));

export const FREQUENCIES = ["WEEKLY", "BIWEEKLY", "SEMI_MONTHLY", "MONTHLY", "QUARTERLY", "SEMI_ANNUALLY", "ANNUALLY", "IRREGULAR", "ONE_TIME"] as const;
export const frequency = z.enum(FREQUENCIES);

export const pageQ = { page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(200).default(50) };
export const csvList = z.string().optional().transform((v) => (v ? v.split(",").map((x) => x.trim()).filter(Boolean) : undefined));

// ───── serialisers (wire format: money as strings, dates as ISO strings)
export const ms = (v: Prisma.Decimal | string | number | null | undefined): string | null => (v === null || v === undefined ? null : money(v));
export const ms0 = (v: Prisma.Decimal | string | number | null | undefined): string => money(v ?? 0);
export const dateIso = (d: Date | null | undefined): string | null => (d ? d.toISOString().slice(0, 10) : null);
export const toDate = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);
export const opt = <T, R>(v: T | null | undefined, f: (x: T) => R): R | null => (v === null || v === undefined ? null : f(v));

/** Serialises Dec values anywhere in a result tree to 2dp money strings (rates and ratios are kept at their own precision by callers). */
export function wire<T>(v: T): unknown {
  if (v === null || v === undefined) return v;
  if (typeof v === "object" && "toFixed" in (v as object) && "isZero" in (v as object)) return (v as unknown as { toString(): string }).toString();
  if (Array.isArray(v)) return v.map(wire);
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") return Object.fromEntries(Object.entries(v as object).map(([k, x]) => [k, wire(x)]));
  return v;
}
export const m2 = (d: { toDecimalPlaces(n: number): { toFixed(n: number): string } } | null | undefined) => (d ? d.toDecimalPlaces(2).toFixed(2) : null);
