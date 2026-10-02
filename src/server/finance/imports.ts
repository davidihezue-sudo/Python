// CSV import and CSV exports. Imports are previewed, mapped and reviewed before anything is written, and can be undone as a batch.
import { z } from "zod";
import { db } from "@/lib/db";
import { AppError, forbidden } from "@/lib/errors";
import { D, money } from "./engine/decimal";
import { detectMapping, fingerprint, markDuplicates, normaliseRows, parseCsv, suggestCategoryName, type ColumnMapping } from "./engine/importer";
import { audit } from "../services/audit";
import { dateIso, id, isoDate, toDate } from "./common";
import { clampToAccount, requireAccount, requireWriter, resolveVisibility, visWhere, type FinCtx } from "./access";
import { loadCategories } from "./load";
import { upsertMerchant } from "./categories";
import type { ReportData } from "../services/reports";

const MAX_ROWS = 5000;
const idxOrNull = z.number().int().min(0).max(200).nullable();
export const mappingSchema = z.object({ date: idxOrNull, description: idxOrNull, amount: idxOrNull, debit: idxOrNull, credit: idxOrNull, type: idxOrNull, account: idxOrNull, category: idxOrNull, postingDate: idxOrNull, invertSign: z.boolean().default(false), dateOrder: z.enum(["YMD", "DMY", "MDY"]).default("YMD") });
export const previewSchema = z.object({ csv: z.string().min(1).max(8_000_000), delimiter: z.string().max(1).optional() });
export const analyzeSchema = z.object({ csv: z.string().min(1).max(8_000_000), delimiter: z.string().max(1).optional(), mapping: mappingSchema, accountId: id });

export function previewCsv(input: z.infer<typeof previewSchema>) {
  const p = parseCsv(input.csv, input.delimiter);
  if (!p.headers.length || !p.rows.length) throw new AppError("VALIDATION_ERROR", "The file has no data rows");
  if (p.rows.length > MAX_ROWS) throw new AppError("VALIDATION_ERROR", `Import at most ${MAX_ROWS} rows at a time. Split the file by date range.`);
  return { headers: p.headers, sample: p.rows.slice(0, 15), rowCount: p.rows.length, delimiter: p.delimiter, suggestedMapping: detectMapping(p.headers, p.rows.slice(0, 50)) };
}

const TYPE_OPTIONS = ["INCOME", "EXPENSE", "REFUND", "SKIP"] as const;
/** Normalises rows, suggests categories and flags duplicates against the account's ledger and within the file. Nothing is written. */
export async function analyzeCsv(ctx: FinCtx, input: z.infer<typeof analyzeSchema>) {
  const acct = await requireAccount(ctx, input.accountId, { write: true });
  const p = parseCsv(input.csv, input.delimiter);
  if (p.rows.length > MAX_ROWS) throw new AppError("VALIDATION_ERROR", `Import at most ${MAX_ROWS} rows at a time`);
  const rows = normaliseRows(p.rows, input.mapping as ColumnMapping);
  const cats = await loadCategories(ctx);
  const byName = new Map<string, string>();
  for (const c of cats) byName.set(`${c.kind}:${c.name.toLowerCase()}`, c.id);
  const merchants = await db.finMerchant.findMany({ where: { householdId: ctx.householdId, defaultCategoryId: { not: null } } });
  const keys = rows.map((r) => (r.date && r.amount ? fingerprint(acct.id, r.date, r.amount.toFixed(2), r.description) : `bad:${r.line}`));
  const dates = rows.map((r) => r.date).filter(Boolean) as string[];
  const existing = new Map<string, number>();
  if (dates.length) {
    const lo = dates.reduce((a, b) => (a < b ? a : b)), hi = dates.reduce((a, b) => (a > b ? a : b));
    const have = await db.finTransaction.findMany({ where: { householdId: ctx.householdId, accountId: acct.id, deletedAt: null, date: { gte: toDate(lo), lte: toDate(hi) } }, select: { date: true, amount: true, description: true } });
    for (const h of have) { const k = fingerprint(acct.id, dateIso(h.date)!, h.amount.toString(), h.description); existing.set(k, (existing.get(k) ?? 0) + 1); }
  }
  const dup = markDuplicates(keys.map((key) => ({ key })), existing);
  const out = rows.map((r, i) => {
    const type = r.errors.length ? "SKIP" : r.typeHint === "TRANSFER" ? "SKIP" : dup[i] ? "SKIP" : (r.typeHint ?? "EXPENSE");
    const kind = type === "INCOME" ? "INCOME" : "EXPENSE";
    let catId: string | null = null, catName: string | null = null;
    if (r.categoryName) { catId = byName.get(`${kind}:${r.categoryName.toLowerCase()}`) ?? null; catName = r.categoryName; }
    if (!catId) {
      const m = merchants.find((x) => r.description.toLowerCase().includes(x.name.toLowerCase()));
      if (m?.defaultCategoryId) { catId = m.defaultCategoryId; catName = cats.find((c) => c.id === catId)?.name ?? null; }
    }
    if (!catId) { const guess = suggestCategoryName(r.description); if (guess) { const k = guess === "Salary" ? `INCOME:salary` : `EXPENSE:${guess.toLowerCase()}`; catId = byName.get(k) ?? cats.find((c) => c.name.toLowerCase() === guess.toLowerCase() && c.kind === kind)?.id ?? null; catName = catId ? guess : null; } }
    return { line: r.line, date: r.date, description: r.description, amount: r.amount ? money(r.amount) : null, type, suggestedType: r.typeHint, categoryId: catId, categoryName: catName, duplicate: dup[i], possibleTransfer: r.typeHint === "TRANSFER", errors: r.errors, key: keys[i] };
  });
  return { accountId: acct.id, accountName: acct.name, currency: acct.currency, rows: out, summary: { total: out.length, ready: out.filter((r) => r.type !== "SKIP").length, duplicates: out.filter((r) => r.duplicate).length, errors: out.filter((r) => r.errors.length).length, possibleTransfers: out.filter((r) => r.possibleTransfer).length }, typeOptions: TYPE_OPTIONS, notes: ["Rows that look like transfers or card payments are skipped by default. Import them as transfers from the Transfers screen so they are not counted as income or expenses.", "Rows already in the account (same date, amount and description) are marked as duplicates and skipped."] };
}

export const commitSchema = z.object({
  accountId: id, fileName: z.string().max(200).default("import.csv"), mapping: mappingSchema.optional(),
  rows: z.array(z.object({ line: z.number().int(), date: isoDate, description: z.string().min(1).max(200), amount: z.string(), type: z.enum(TYPE_OPTIONS), categoryId: id.nullish(), key: z.string().max(80).optional(), duplicate: z.boolean().optional() })).min(1).max(MAX_ROWS),
  skipDuplicates: z.boolean().default(true),
});
export async function commitImport(ctx: FinCtx, input: z.infer<typeof commitSchema>) {
  requireWriter(ctx);
  const acct = await requireAccount(ctx, input.accountId, { write: true });
  if (acct.status !== "ACTIVE") throw new AppError("CONFLICT", "This account is closed");
  const cats = await loadCategories(ctx);
  const catKind = new Map(cats.map((c) => [c.id, c.kind]));
  const vis = clampToAccount(acct, resolveVisibility(ctx, {}, "transactions"));
  const joint = !acct.ownerMemberId;
  const opening = dateIso(acct.openingDate)!;
  // recheck duplicates server side: the client's flag is never trusted
  const keys = input.rows.map((r) => fingerprint(acct.id, r.date, D(r.amount).abs().toFixed(2), r.description));
  void keys;
  let imported = 0, duplicates = 0, skipped = 0, failed = 0;
  const problems: { line: number; reason: string }[] = [];
  const batch = await db.importBatch.create({ data: { householdId: ctx.householdId, accountId: acct.id, fileName: input.fileName, rowCount: input.rows.length, mapping: (input.mapping ?? {}) as never, createdById: ctx.actor.id } });
  const existing = new Map<string, number>();
  const dates = input.rows.map((r) => r.date);
  const lo = dates.reduce((a, b) => (a < b ? a : b)), hi = dates.reduce((a, b) => (a > b ? a : b));
  for (const h of await db.finTransaction.findMany({ where: { householdId: ctx.householdId, accountId: acct.id, deletedAt: null, date: { gte: toDate(lo), lte: toDate(hi) } }, select: { date: true, amount: true, description: true } })) { const k = fingerprint(acct.id, dateIso(h.date)!, h.amount.toString(), h.description); existing.set(k, (existing.get(k) ?? 0) + 1); }
  const seen = new Map<string, number>();
  for (const r of input.rows) {
    if (r.type === "SKIP") { skipped++; continue; }
    let amt: ReturnType<typeof D>;
    try { amt = D(r.amount); } catch { failed++; problems.push({ line: r.line, reason: "Amount is not a number" }); continue; }
    if (amt.isZero()) { failed++; problems.push({ line: r.line, reason: "Amount is zero" }); continue; }
    if (r.date < opening) { failed++; problems.push({ line: r.line, reason: `Dated before the account opened (${opening})` }); continue; }
    const mag = amt.abs();
    const signed = r.type === "EXPENSE" ? mag.negated() : mag;
    const key = fingerprint(acct.id, r.date, money(signed), r.description);
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    if (input.skipDuplicates && n <= (existing.get(key) ?? 0)) { duplicates++; continue; }
    const want = r.type === "INCOME" ? "INCOME" : "EXPENSE";
    const category = r.categoryId && catKind.get(r.categoryId) === want ? r.categoryId : null;
    const merchantId = await upsertMerchant(ctx.householdId, r.description.slice(0, 60), category);
    await db.finTransaction.create({ data: { householdId: ctx.householdId, accountId: acct.id, type: r.type, amount: money(signed), currency: acct.currency, date: toDate(r.date), description: r.description, categoryId: category, merchantId, ownerMemberId: ctx.me.id, payerMemberId: r.type === "INCOME" ? ctx.me.id : joint ? null : ctx.me.id, allocationMode: r.type === "EXPENSE" && joint ? "HOUSEHOLD" : "OWNER", ...vis, createdById: ctx.actor.id, updatedById: ctx.actor.id, importBatchId: batch.id, importHash: key } });
    imported++;
  }
  await db.importBatch.update({ where: { id: batch.id }, data: { importedCount: imported, duplicateCount: duplicates, skippedCount: skipped } });
  await audit(null, ctx.actor, { entity: "ImportBatch", entityId: batch.id, action: "commit", householdId: ctx.householdId, after: { imported, duplicates, skipped, failed } });
  return { batchId: batch.id, imported, duplicates, skipped, failed, problems: problems.slice(0, 50) };
}

export async function listBatches(ctx: FinCtx) {
  const rows = await db.importBatch.findMany({ where: { householdId: ctx.householdId, createdById: ctx.actor.id }, orderBy: { createdAt: "desc" }, take: 50 });
  return rows.map((b) => ({ id: b.id, fileName: b.fileName, accountId: b.accountId, rowCount: b.rowCount, imported: b.importedCount, duplicates: b.duplicateCount, skipped: b.skippedCount, status: b.status, createdAt: b.createdAt.toISOString() }));
}
/** Removes everything an import created. Only the person who imported can undo it. */
export async function undoBatch(ctx: FinCtx, batchId: string) {
  requireWriter(ctx);
  const b = await db.importBatch.findFirst({ where: { id: batchId, householdId: ctx.householdId } });
  if (!b) throw new AppError("NOT_FOUND", "Import not found");
  if (b.createdById !== ctx.actor.id) throw forbidden("Only the person who ran an import can undo it");
  if (b.status === "UNDONE") throw new AppError("CONFLICT", "This import was already undone");
  const r = await db.$transaction(async (tx) => {
    const n = await tx.finTransaction.updateMany({ where: { importBatchId: b.id, deletedAt: null }, data: { deletedAt: new Date(), updatedById: ctx.actor.id } });
    await tx.importBatch.update({ where: { id: b.id }, data: { status: "UNDONE" } });
    await audit(tx, ctx.actor, { entity: "ImportBatch", entityId: b.id, action: "undo", householdId: ctx.householdId, after: { removed: n.count } });
    return n.count;
  });
  return { removed: r };
}

// ───────────────────────── exports
export const EXPORT_ENTITIES = ["transactions", "expenses", "income", "accounts", "budgets", "debts", "goals"] as const;
export const exportQuery = z.object({ view: z.enum(["my", "household"]).default("my"), from: isoDate.optional(), to: isoDate.optional(), format: z.enum(["csv", "xlsx", "json"]).default("csv") });
/** Exports only what the actor is allowed to see, in the chosen view. */
export async function exportEntity(ctx: FinCtx, entity: (typeof EXPORT_ENTITIES)[number], q: z.infer<typeof exportQuery>): Promise<ReportData> {
  const { buildFinanceReport } = await import("./reports");
  const base = { view: q.view, from: q.from, to: q.to, format: "json" as const };
  const make = (rep: ReportData, title: string): ReportData => ({ ...rep, title });
  switch (entity) {
    case "transactions":
      return make(await buildFinanceReport(ctx, { ...base, type: "transactions" }), "Transactions");
    case "expenses": {
      const { allTransactions } = await import("./transactions");
      const t = await allTransactions(ctx, { view: q.view, from: q.from, to: q.to, types: ["EXPENSE", "REFUND", "REIMBURSEMENT"], sort: "date_asc" });
      const rep = await buildFinanceReport(ctx, { ...base, type: "transactions" });
      rep.rows = t.items.map((x) => ({ date: x.date, description: x.description, category: x.categoryName ?? "", account: x.accountName, type: x.type.toLowerCase(), owner: x.owner?.name ?? "", payer: x.paidByHousehold ? "Household" : x.payer?.name ?? "", entered: x.enteredBy?.name ?? "", amount: Number(x.amount) }));
      return make(rep, "Expenses");
    }
    case "income": {
      const { listIncome } = await import("./income");
      const rows = await listIncome(ctx, q.view);
      const rep = await buildFinanceReport(ctx, { ...base, type: "income-monthly" });
      rep.columns = [{ key: "name", label: "Source" }, { key: "owner", label: "Member" }, { key: "kind", label: "Type" }, { key: "frequency", label: "Frequency" }, { key: "gross", label: "Gross per payment", format: "money", align: "right" }, { key: "net", label: "Net per payment", format: "money", align: "right" }, { key: "mg", label: "Monthly gross", format: "money", align: "right" }, { key: "mn", label: "Monthly net", format: "money", align: "right" }, { key: "sharing", label: "Sharing" }];
      rep.rows = rows.map((r) => ({ name: r.name, owner: r.owner?.name ?? "", kind: r.kind.toLowerCase().replace(/_/g, " "), frequency: r.frequency.toLowerCase().replace(/_/g, "-"), gross: Number(r.grossAmount), net: Number(r.netAmount), mg: r.monthlyGross ? Number(r.monthlyGross) : null, mn: r.monthlyNet ? Number(r.monthlyNet) : null, sharing: r.visibility.toLowerCase() }));
      rep.summary = [];
      return make(rep, "Income sources");
    }
    case "accounts": return make(await buildFinanceReport(ctx, { ...base, type: "account-balances" }), "Accounts");
    case "debts": return make(await buildFinanceReport(ctx, { ...base, type: "debt" }), "Debts");
    case "goals": return make(await buildFinanceReport(ctx, { ...base, type: "savings" }), "Goals");
    case "budgets": {
      const { listBudgets, budgetReport } = await import("./budgets");
      const rep = await buildFinanceReport(ctx, { ...base, type: "budget-performance" });
      rep.rows = [];
      for (const b of (await listBudgets(ctx)).slice(0, 24)) for (const l of (await budgetReport(ctx, b.id)).lines) rep.rows.push({ category: `${b.name}: ${l.category}`, budgeted: Number(l.available), actual: Number(l.actual), remaining: Number(l.remaining), pct: l.percentUsed ? Number(l.percentUsed) : null, forecast: Number(l.forecast), previous: Number(l.previousActual), state: l.state });
      rep.summary = [];
      return make(rep, "Budgets");
    }
  }
}
export { visWhere };
