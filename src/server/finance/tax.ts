// Tax records and estimates. Rules are DATA (TaxRuleSet rows), not code, so jurisdictions and years can be updated independently.
// Estimates are planning aids, never official calculations.
import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { D, money, ZERO, type Dec } from "./engine/decimal";
import { estimateTax, pickRuleYear, SEEDED_TAX_RULES, type TaxRuleData } from "./engine/tax";
import { audit } from "../services/audit";
import { currencyCode, dateIso, id, isoDate, nonNegMoney, optText, toDate } from "./common";
import { metaView, newRecordMeta, requireAdminOnly, requireVisible, requireWriter, updateRecordMeta, visibilityFields, visWhere, memberRef, type FinCtx } from "./access";
import { listIncome } from "./income";

export const TAX_KINDS = ["EMPLOYMENT_INCOME", "SELF_EMPLOYMENT_INCOME", "TAX_DEDUCTED", "PENSION_CONTRIBUTION", "RRSP_CONTRIBUTION", "FHSA_CONTRIBUTION", "CHARITABLE_DONATION", "MEDICAL_EXPENSE", "TUITION", "EMPLOYMENT_EXPENSE", "OTHER_DEDUCTION", "OTHER"] as const;
export const taxRecordSchema = z.object({ taxYear: z.number().int().min(2000).max(2100), kind: z.enum(TAX_KINDS), amount: nonNegMoney, currency: currencyCode.optional(), date: isoDate.nullish(), description: optText(200), notes: optText(500), assignToMemberId: id.nullish(), ...visibilityFields });
export const taxRecordPatchSchema = taxRecordSchema.partial();

const KIND_LABEL: Record<string, string> = { EMPLOYMENT_INCOME: "Employment income", SELF_EMPLOYMENT_INCOME: "Self-employment income", TAX_DEDUCTED: "Income tax deducted at source", PENSION_CONTRIBUTION: "Pension contributions", RRSP_CONTRIBUTION: "RRSP contributions", FHSA_CONTRIBUTION: "FHSA contributions", CHARITABLE_DONATION: "Charitable donations", MEDICAL_EXPENSE: "Eligible medical expenses", TUITION: "Tuition amounts", EMPLOYMENT_EXPENSE: "Employment expenses", OTHER_DEDUCTION: "Other deductions", OTHER: "Other" };

export async function listTaxRecords(ctx: FinCtx, year: number) {
  const rows = await db.taxRecord.findMany({ where: { householdId: ctx.householdId, deletedAt: null, taxYear: year, ...visWhere(ctx, "all") }, orderBy: [{ kind: "asc" }, { date: "asc" }] });
  return rows.map((r) => ({ id: r.id, taxYear: r.taxYear, kind: r.kind, label: KIND_LABEL[r.kind], amount: money(r.amount), currency: r.currency, date: dateIso(r.date), description: r.description, notes: r.notes, ...metaView(ctx, r) }));
}
export async function createTaxRecord(ctx: FinCtx, input: z.infer<typeof taxRecordSchema>) {
  requireWriter(ctx);
  const r = await db.taxRecord.create({ data: { householdId: ctx.householdId, ...newRecordMeta(ctx, { visibility: "PERSONAL", ...input }, "other"), taxYear: input.taxYear, kind: input.kind, amount: input.amount, currency: input.currency ?? ctx.base, date: input.date ? toDate(input.date) : null, description: input.description ?? null, notes: input.notes ?? null } });
  await audit(null, ctx.actor, { entity: "TaxRecord", entityId: r.id, action: "create", householdId: ctx.householdId, after: { kind: r.kind, year: r.taxYear } });
  return { id: r.id };
}
export async function updateTaxRecord(ctx: FinCtx, recordId: string, patch: z.infer<typeof taxRecordPatchSchema>) {
  requireWriter(ctx);
  const r = requireVisible(ctx, await db.taxRecord.findUnique({ where: { id: recordId } }), "Tax record", { write: true });
  const data: Record<string, unknown> = updateRecordMeta(ctx, r, patch, "other");
  for (const k of ["taxYear", "kind", "amount", "currency", "description", "notes"] as const) if ((patch as Record<string, unknown>)[k] !== undefined) data[k] = (patch as Record<string, unknown>)[k];
  if (patch.date !== undefined) data.date = patch.date ? toDate(patch.date) : null;
  await db.taxRecord.update({ where: { id: r.id }, data });
  return { id: r.id };
}
export async function deleteTaxRecord(ctx: FinCtx, recordId: string) {
  requireWriter(ctx);
  const r = requireVisible(ctx, await db.taxRecord.findUnique({ where: { id: recordId } }), "Tax record", { write: true });
  await db.taxRecord.update({ where: { id: r.id }, data: { deletedAt: new Date() } });
  return { ok: true };
}

// ───── rule sets
export const ruleSetSchema = z.object({
  region: z.string().max(10).default(""), year: z.number().int().min(2000).max(2100), source: z.string().min(3).max(300),
  data: z.object({
    kind: z.literal("INCOME_TAX"), currency: currencyCode,
    income: z.object({ name: z.string().max(60), brackets: z.array(z.object({ upTo: z.number().positive().nullable(), rate: z.number().min(0).max(100) })).min(1).max(12), basicPersonalAmount: z.number().min(0), creditRate: z.number().min(0).max(100), donation: z.object({ firstTier: z.number().min(0), firstTierRate: z.number().min(0).max(100), rate: z.number().min(0).max(100) }).optional(), medical: z.object({ thresholdPct: z.number().min(0).max(100), thresholdMax: z.number().min(0) }).optional() }),
    payroll: z.object({ cpp: z.object({ rate: z.number(), exemption: z.number(), maxPensionable: z.number(), additionalRate: z.number().optional(), additionalMax: z.number().optional() }), ei: z.object({ rate: z.number(), maxInsurable: z.number() }) }).optional(),
    notes: z.array(z.string().max(300)).max(10).optional(),
  }),
});
export async function ensureGlobalTaxRules() {
  for (const s of SEEDED_TAX_RULES) {
    const exists = await db.taxRuleSet.findFirst({ where: { householdId: null, country: s.country, region: s.region, year: s.year } });
    if (!exists) await db.taxRuleSet.create({ data: { householdId: null, country: s.country, region: s.region, year: s.year, data: s.data as never, source: s.source } });
  }
}
async function rulesFor(ctx: FinCtx, region: string, year: number) {
  await ensureGlobalTaxRules();
  const rows = await db.taxRuleSet.findMany({ where: { country: ctx.household.countryCode, region, OR: [{ householdId: ctx.householdId }, { householdId: null }] } });
  // a household override of the same year wins over the global default
  const byYear = new Map<number, (typeof rows)[number]>();
  for (const r of rows.sort((a, b) => (a.householdId ? 1 : 0) - (b.householdId ? 1 : 0))) byYear.set(r.year, r);
  const pick = pickRuleYear([...byYear.values()], year);
  return { set: pick.set ? { ...pick.set, data: pick.set.data as unknown as TaxRuleData } : null, fellBackFrom: pick.fellBackFrom };
}
export async function listRuleSets(ctx: FinCtx) {
  await ensureGlobalTaxRules();
  const rows = await db.taxRuleSet.findMany({ where: { country: ctx.household.countryCode, OR: [{ householdId: ctx.householdId }, { householdId: null }] }, orderBy: [{ year: "desc" }, { region: "asc" }] });
  return rows.map((r) => ({ id: r.id, region: r.region, year: r.year, source: r.source, override: !!r.householdId, data: r.data, updatedAt: r.updatedAt.toISOString() }));
}
/** Household administrators can override a rule set for their own household without affecting anyone else. */
export async function saveRuleSet(ctx: FinCtx, input: z.infer<typeof ruleSetSchema>) {
  requireAdminOnly(ctx);
  const existing = await db.taxRuleSet.findFirst({ where: { householdId: ctx.householdId, country: ctx.household.countryCode, region: input.region, year: input.year } });
  const data = { data: input.data as never, source: input.source };
  const r = existing ? await db.taxRuleSet.update({ where: { id: existing.id }, data }) : await db.taxRuleSet.create({ data: { householdId: ctx.householdId, country: ctx.household.countryCode, region: input.region, year: input.year, ...data } });
  await audit(null, ctx.actor, { entity: "TaxRuleSet", entityId: r.id, action: "save", householdId: ctx.householdId, after: { region: input.region, year: input.year } });
  return { id: r.id };
}

export const taxSummaryQuery = z.object({ year: z.coerce.number().int().min(2000).max(2100).default(new Date().getUTCFullYear()), region: z.string().max(10).optional() });
/** Annual summary and estimate. Only tax records the actor can see are used, so this never mixes in another member's private data. */
export async function taxSummary(ctx: FinCtx, q: z.infer<typeof taxSummaryQuery>) {
  const records = await db.taxRecord.findMany({ where: { householdId: ctx.householdId, deletedAt: null, taxYear: q.year, ...visWhere(ctx, "all") } });
  const sumKind = (rs: typeof records, k: string) => rs.filter((r) => r.kind === k).reduce((a, r) => a.plus(D(r.amount)), ZERO);
  const owners = [...new Set(records.map((r) => r.ownerMemberId))];
  const region = q.region ?? ctx.household.region ?? "";
  const fed = await rulesFor(ctx, "", q.year);
  const prov = region ? await rulesFor(ctx, region.toUpperCase(), q.year) : { set: null, fellBackFrom: null };
  const income = await listIncome(ctx, "my");
  const suggestion = income.filter((i) => i.active && i.annualGross).reduce((a, i) => a.plus(D(i.annualGross)), ZERO);

  const perMember = [];
  for (const o of owners) {
    const rs = records.filter((r) => r.ownerMemberId === o);
    const est = fed.set ? estimateTax({ employmentIncome: sumKind(rs, "EMPLOYMENT_INCOME"), selfEmploymentIncome: sumKind(rs, "SELF_EMPLOYMENT_INCOME"), rrspContributions: sumKind(rs, "RRSP_CONTRIBUTION"), fhsaContributions: sumKind(rs, "FHSA_CONTRIBUTION"), pensionContributions: sumKind(rs, "PENSION_CONTRIBUTION"), employmentExpenses: sumKind(rs, "EMPLOYMENT_EXPENSE"), otherDeductions: sumKind(rs, "OTHER_DEDUCTION"), donations: sumKind(rs, "CHARITABLE_DONATION"), medicalExpenses: sumKind(rs, "MEDICAL_EXPENSE"), tuition: sumKind(rs, "TUITION"), taxDeducted: sumKind(rs, "TAX_DEDUCTED") }, fed.set.data, prov.set?.data ?? null) : null;
    const w = (v: Dec) => money(v);
    perMember.push({
      member: memberRef(ctx, o), byKind: TAX_KINDS.map((k) => ({ kind: k, label: KIND_LABEL[k], amount: money(sumKind(rs, k)) })).filter((x) => !D(x.amount).isZero()),
      estimate: est ? { totalIncome: w(est.totalIncome), totalDeductions: w(est.totalDeductions), taxableIncome: w(est.taxableIncome), federalTax: w(est.federal.tax), provincialTax: est.provincial ? w(est.provincial.tax) : null, payrollEstimate: est.payrollEstimate ? { cpp: w(est.payrollEstimate.cpp), ei: w(est.payrollEstimate.ei) } : null, estimatedTax: w(est.estimatedTax), actualTaxDeducted: w(est.taxDeducted), estimatedRefund: w(est.estimatedRefund), estimatedOwing: w(est.estimatedOwing), averageRate: est.averageRate?.toString() ?? null, marginalRate: est.marginalRate?.toString() ?? null, warnings: est.warnings } : null,
    });
  }
  return {
    year: q.year, country: ctx.household.countryCode, region: region || null, currency: ctx.base, members: perMember, suggestedAnnualGrossFromIncome: money(suggestion),
    rules: { federal: fed.set ? { year: fed.set.year, source: fed.set.source, fellBackFromYear: fed.fellBackFrom } : null, provincial: prov.set ? { year: prov.set.year, source: prov.set.source, fellBackFromYear: prov.fellBackFrom } : null },
    distinction: { actualTaxDeducted: "Tax your employer or payer actually withheld, as recorded by you.", estimatedLiability: "Tax calculated from the rules loaded for your region. An estimate only.", estimatedRefund: "Actual tax deducted minus estimated liability, when positive.", estimatedOwing: "Estimated liability minus actual tax deducted, when positive." },
    disclaimer: "This is a planning estimate, not an official tax calculation. Not every expense is deductible, and credits and rules vary. Check the figures with your tax authority or a qualified preparer.",
  };
}
export { AppError };
