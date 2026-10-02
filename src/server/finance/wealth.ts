// Investments, assets (property, vehicles, valuables) and household / personal net worth.
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { D, money, ZERO, type Dec } from "./engine/decimal";
import { computeNetWorth, netWorthHistory, compareNetWorth } from "./engine/networth";
import { addMonths, endOfMonth } from "./engine/dates";
import { audit } from "../services/audit";
import { currencyCode, dateIso, id, isoDate, moneyIn, nonNegMoney, optText, posMoney, text, toDate } from "./common";
import { clampToAccount, metaView, newRecordMeta, requireAccount, requireVisible, requireWriter, resolveVisibility, updateRecordMeta, visibilityFields, visWhere, type FinCtx, type View } from "./access";
import { loadBooks, nwInputs } from "./load";

// ───────────────────────── Investments
export const INVESTMENT_KINDS = ["RRSP", "TFSA", "FHSA", "RESP", "NON_REGISTERED", "PENSION", "EMPLOYER_PLAN", "OTHER"] as const;
export const investmentEntrySchema = z.object({ kind: z.enum(["CONTRIBUTION", "WITHDRAWAL", "INCOME", "FEE"]), date: isoDate, amount: posMoney, note: optText(300), fromAccountId: id.nullish() });
export const valuationSchema = z.object({ date: isoDate, marketValue: nonNegMoney, source: z.string().max(60).default("manual") });
export const investmentPatchSchema = z.object({ kind: z.enum(INVESTMENT_KINDS).optional(), investmentType: optText(80), allocation: z.array(z.object({ assetClass: z.string().max(40), percent: z.number().min(0).max(100) })).max(20).optional(), notes: optText(500) });

export async function listInvestments(ctx: FinCtx, view: View | "all" = "all") {
  const profiles = await db.investmentProfile.findMany({ where: { householdId: ctx.householdId, account: { deletedAt: null, ...visWhere(ctx, view) } }, include: { account: true, entries: { where: { deletedAt: null }, orderBy: { date: "desc" } }, valuations: { orderBy: { date: "desc" } } } });
  const items = profiles.map((p) => {
    const sum = (k: string) => p.entries.filter((e) => e.kind === k).reduce((a, e) => a.plus(D(e.amount)), ZERO);
    const latest = p.valuations[0];
    const contributions = sum("CONTRIBUTION"), withdrawals = sum("WITHDRAWAL"), income = sum("INCOME"), fees = sum("FEE");
    const netContrib = contributions.minus(withdrawals);
    const value = latest ? D(latest.marketValue) : null;
    return { id: p.id, accountId: p.accountId, name: p.account.name, institution: p.account.institution, kind: p.kind, investmentType: p.investmentType, currency: p.account.currency, allocation: p.allocation, notes: p.notes, currentValue: value ? money(value) : null, valuedOn: dateIso(latest?.date), valuationNote: latest ? `Manual valuation as of ${dateIso(latest.date)}. Not a live market price.` : "No valuation recorded yet", contributions: money(contributions), withdrawals: money(withdrawals), investmentIncome: money(income), fees: money(fees), netContributions: money(netContrib), changeInValue: value ? money(value.minus(netContrib)) : null, owner: ctx.members.find((m) => m.id === p.account.ownerMemberId)?.name ?? null, valuations: p.valuations.slice(0, 60).map((v) => ({ id: v.id, date: dateIso(v.date), value: money(v.marketValue), source: v.source })), entries: p.entries.slice(0, 60).map((e) => ({ id: e.id, kind: e.kind, date: dateIso(e.date), amount: money(e.amount), note: e.note })) };
  });
  const total = items.reduce((a, i) => a.plus(D(i.currentValue)), ZERO);
  const alloc = new Map<string, Dec>();
  for (const i of items) for (const a of (i.allocation as { assetClass: string; percent: number }[]) ?? []) alloc.set(a.assetClass, (alloc.get(a.assetClass) ?? ZERO).plus(D(i.currentValue).times(a.percent).div(100)));
  const byKind = new Map<string, Dec>();
  for (const i of items) byKind.set(i.kind, (byKind.get(i.kind) ?? ZERO).plus(D(i.currentValue)));
  const dates = new Set(items.flatMap((i) => i.valuations.map((v) => v.date as string)));
  const history = [...dates].sort().map((d) => ({ date: d, value: money(items.reduce((a, i) => { const v = i.valuations.find((x) => (x.date as string) <= d); return a.plus(D(v?.value)); }, ZERO)) }));
  return { items, totals: { totalValue: money(total), contributions: money(items.reduce((a, i) => a.plus(D(i.contributions)), ZERO)), withdrawals: money(items.reduce((a, i) => a.plus(D(i.withdrawals)), ZERO)), changeInValue: money(items.reduce((a, i) => a.plus(D(i.changeInValue)), ZERO)), currency: ctx.base, note: "Values are entered manually. This application does not fetch live market prices and does not project investment returns." }, allocation: [...alloc.entries()].map(([k, v]) => ({ assetClass: k, value: money(v) })), byAccountType: [...byKind.entries()].map(([k, v]) => ({ kind: k, value: money(v) })), history };
}
async function profileFor(ctx: FinCtx, profileId: string, write = true) {
  const p = await db.investmentProfile.findFirst({ where: { id: profileId, householdId: ctx.householdId }, include: { account: true } });
  if (!p) throw new AppError("NOT_FOUND", "Investment not found");
  await requireAccount(ctx, p.accountId, { write });
  return p;
}
export async function updateInvestment(ctx: FinCtx, profileId: string, patch: z.infer<typeof investmentPatchSchema>) {
  requireWriter(ctx);
  const p = await profileFor(ctx, profileId);
  await db.investmentProfile.update({ where: { id: p.id }, data: { ...(patch.kind ? { kind: patch.kind } : {}), ...(patch.investmentType !== undefined ? { investmentType: patch.investmentType } : {}), ...(patch.allocation ? { allocation: patch.allocation } : {}), ...(patch.notes !== undefined ? { notes: patch.notes } : {}) } });
  return { id: p.id };
}
/** A contribution from a source account moves money as a transfer (never an expense); withdrawals reverse it. */
export async function addInvestmentEntry(ctx: FinCtx, profileId: string, input: z.infer<typeof investmentEntrySchema>) {
  requireWriter(ctx);
  const p = await profileFor(ctx, profileId);
  let group: string | null = null;
  const e = await db.$transaction(async (tx) => {
    if (input.fromAccountId && (input.kind === "CONTRIBUTION" || input.kind === "WITHDRAWAL")) {
      const other = await requireAccount(ctx, input.fromAccountId, { write: true });
      group = randomUUID();
      const [src, dst] = input.kind === "CONTRIBUTION" ? [other, p.account] : [p.account, other];
      const base = { householdId: ctx.householdId, type: "TRANSFER" as const, date: toDate(input.date), description: `${input.kind === "CONTRIBUTION" ? "Contribution to" : "Withdrawal from"} ${p.account.name}`, transferGroupId: group, ownerMemberId: ctx.me.id, payerMemberId: ctx.me.id, createdById: ctx.actor.id, updatedById: ctx.actor.id };
      await tx.finTransaction.create({ data: { ...base, accountId: src.id, amount: money(D(input.amount).negated()), currency: src.currency, ...clampToAccount(src, resolveVisibility(ctx, {}, "savings")) } });
      await tx.finTransaction.create({ data: { ...base, accountId: dst.id, amount: money(input.amount), currency: dst.currency, ...clampToAccount(dst, resolveVisibility(ctx, {}, "savings")) } });
    }
    const row = await tx.investmentEntry.create({ data: { profileId: p.id, kind: input.kind, date: toDate(input.date), amount: input.amount, note: input.note ?? null, transferGroupId: group } });
    await audit(tx, ctx.actor, { entity: "Investment", entityId: p.id, action: `entry:${input.kind}`, householdId: ctx.householdId, after: { amount: input.amount } });
    return row;
  });
  return { id: e.id };
}
export async function deleteInvestmentEntry(ctx: FinCtx, profileId: string, entryId: string) {
  requireWriter(ctx);
  const p = await profileFor(ctx, profileId);
  const e = await db.investmentEntry.findFirst({ where: { id: entryId, profileId: p.id, deletedAt: null } });
  if (!e) throw new AppError("NOT_FOUND", "Entry not found");
  await db.$transaction(async (tx) => {
    await tx.investmentEntry.update({ where: { id: e.id }, data: { deletedAt: new Date() } });
    if (e.transferGroupId) await tx.finTransaction.updateMany({ where: { transferGroupId: e.transferGroupId, deletedAt: null }, data: { deletedAt: new Date(), updatedById: ctx.actor.id } });
  });
  return { ok: true };
}
export async function addValuation(ctx: FinCtx, profileId: string, input: z.infer<typeof valuationSchema>) {
  requireWriter(ctx);
  const p = await profileFor(ctx, profileId);
  await db.investmentValuation.upsert({ where: { profileId_date: { profileId: p.id, date: toDate(input.date) } }, create: { profileId: p.id, date: toDate(input.date), marketValue: input.marketValue, source: input.source }, update: { marketValue: input.marketValue, source: input.source } });
  await audit(null, ctx.actor, { entity: "Investment", entityId: p.id, action: "valuation", householdId: ctx.householdId, after: input });
  return { ok: true };
}

// ───────────────────────── Assets
export const assetSchema = z.object({
  name: text(100), kind: z.enum(["PROPERTY", "VEHICLE", "VALUABLE", "OTHER"]), currency: currencyCode.optional(), currentValue: nonNegMoney, valuationDate: isoDate.optional(), valuationSource: optText(100),
  details: z.object({ address: z.string().max(200).optional(), purchasePrice: moneyIn.optional(), purchaseDate: isoDate.optional(), annualPropertyTax: moneyIn.optional(), make: z.string().max(60).optional(), model: z.string().max(60).optional(), year: z.number().int().min(1900).max(2100).optional() }).default({}),
  vehicleId: id.nullish(), notes: optText(1000), assignToMemberId: id.nullish(), ...visibilityFields,
});
export const assetPatchSchema = assetSchema.partial().extend({ soldOn: isoDate.nullish() });
export const assetValuationSchema = z.object({ date: isoDate, value: nonNegMoney, source: optText(100) });

export async function listAssets(ctx: FinCtx, view: View | "all" = "all") {
  const rows = await db.asset.findMany({ where: { householdId: ctx.householdId, deletedAt: null, ...visWhere(ctx, view) }, include: { valuations: { orderBy: { date: "desc" } } }, orderBy: [{ kind: "asc" }, { name: "asc" }] });
  const items = rows.map((a) => ({ id: a.id, name: a.name, kind: a.kind, currency: a.currency, currentValue: money(a.currentValue), valuationDate: dateIso(a.valuationDate), valuationSource: a.valuationSource, details: a.details, vehicleId: a.vehicleId, notes: a.notes, soldOn: dateIso(a.soldOn), valuations: a.valuations.slice(0, 40).map((v) => ({ id: v.id, date: dateIso(v.date), value: money(v.value), source: v.source })), ...metaView(ctx, a) }));
  return { items, total: money(items.filter((i) => !i.soldOn).reduce((a, i) => a.plus(D(i.currentValue)), ZERO)), currency: ctx.base };
}
export async function createAsset(ctx: FinCtx, input: z.infer<typeof assetSchema>) {
  requireWriter(ctx);
  await (await import("./vehicles")).assertVehicleLink(ctx, input.vehicleId);
  const date = input.valuationDate ?? ctx.today;
  const a = await db.asset.create({ data: { householdId: ctx.householdId, ...newRecordMeta(ctx, input, "other"), name: input.name, kind: input.kind, currency: input.currency ?? ctx.base, currentValue: input.currentValue, valuationDate: toDate(date), valuationSource: input.valuationSource ?? null, details: input.details, vehicleId: input.vehicleId ?? null, notes: input.notes ?? null, valuations: { create: { date: toDate(date), value: input.currentValue, source: input.valuationSource ?? null } } } });
  await audit(null, ctx.actor, { entity: "Asset", entityId: a.id, action: "create", householdId: ctx.householdId, after: { name: a.name, value: money(a.currentValue) } });
  return { id: a.id };
}
export async function updateAsset(ctx: FinCtx, assetId: string, patch: z.infer<typeof assetPatchSchema>) {
  requireWriter(ctx);
  const a = requireVisible(ctx, await db.asset.findUnique({ where: { id: assetId } }), "Asset", { write: true });
  if (patch.vehicleId) await (await import("./vehicles")).assertVehicleLink(ctx, patch.vehicleId);
  const data: Record<string, unknown> = updateRecordMeta(ctx, a, patch, "other");
  for (const k of ["name", "kind", "currency", "valuationSource", "details", "vehicleId", "notes"] as const) if ((patch as Record<string, unknown>)[k] !== undefined) data[k] = (patch as Record<string, unknown>)[k];
  if (patch.soldOn !== undefined) data.soldOn = patch.soldOn ? toDate(patch.soldOn) : null;
  await db.asset.update({ where: { id: a.id }, data });
  return { id: a.id };
}
/** Adds a dated valuation (with its source). The asset's current value follows the most recent valuation. */
export async function addAssetValuation(ctx: FinCtx, assetId: string, input: z.infer<typeof assetValuationSchema>) {
  requireWriter(ctx);
  const a = requireVisible(ctx, await db.asset.findUnique({ where: { id: assetId } }), "Asset", { write: true });
  await db.$transaction(async (tx) => {
    await tx.assetValuation.upsert({ where: { assetId_date: { assetId: a.id, date: toDate(input.date) } }, create: { assetId: a.id, date: toDate(input.date), value: input.value, source: input.source ?? null }, update: { value: input.value, source: input.source ?? null } });
    const latest = await tx.assetValuation.findFirst({ where: { assetId: a.id }, orderBy: { date: "desc" } });
    if (latest) await tx.asset.update({ where: { id: a.id }, data: { currentValue: latest.value, valuationDate: latest.date, valuationSource: latest.source, updatedById: ctx.actor.id } });
    await audit(tx, ctx.actor, { entity: "Asset", entityId: a.id, action: "valuation", householdId: ctx.householdId, before: { value: money(a.currentValue) }, after: input });
  });
  return { ok: true };
}
export async function deleteAsset(ctx: FinCtx, assetId: string) {
  requireWriter(ctx);
  const a = requireVisible(ctx, await db.asset.findUnique({ where: { id: assetId } }), "Asset", { write: true });
  await db.asset.update({ where: { id: a.id }, data: { deletedAt: new Date(), updatedById: ctx.actor.id } });
  return { ok: true };
}

// ───────────────────────── Net worth
export const netWorthQuery = z.object({ view: z.enum(["my", "household"]).default("household"), months: z.coerce.number().int().min(2).max(120).default(12) });
export async function netWorth(ctx: FinCtx, q: z.infer<typeof netWorthQuery>) {
  const books = await loadBooks(ctx, { view: q.view });
  const inputs = { ...(await nwInputs(ctx, q.view)), txs: books.balanceTxs, baseCurrency: ctx.base, fx: books.fx };
  const now = computeNetWorth({ ...inputs, asOf: ctx.today });
  const history = netWorthHistory({ ...inputs, endDate: ctx.today, months: Math.max(q.months, 13) });
  const at = (m: number) => history[history.length - 1 - m]?.netWorth ?? null;
  const groups = new Map<string, Dec>();
  for (const l of now.lines) groups.set(`${l.side}:${l.group}`, (groups.get(`${l.side}:${l.group}`) ?? ZERO).plus(l.value));
  const cmp = (e: Dec | null) => { const c = compareNetWorth(now.netWorth, e); return c ? { change: money(c.change), percent: c.percent?.toString() ?? null } : null; };
  return {
    view: q.view, asOf: ctx.today, currency: ctx.base, assets: money(now.assets), liabilities: money(now.liabilities), netWorth: money(now.netWorth), monthOverMonth: cmp(at(1)), yearOverYear: cmp(at(12)),
    groups: [...groups.entries()].map(([k, v]) => ({ side: k.split(":")[0], group: k.split(":")[1], value: money(v) })),
    lines: now.lines.map((l) => ({ id: l.id, name: l.name, group: l.group, side: l.side, value: money(l.value), currency: l.currency, valuedOn: l.valuedOn, source: l.source })),
    history: history.slice(-q.months).map((p) => ({ month: p.month, date: p.date, assets: money(p.assets), liabilities: money(p.liabilities), netWorth: money(p.netWorth), change: p.changeFromPrevious ? money(p.changeFromPrevious) : null })),
    unconverted: now.unconverted, notes: ["Each account and asset is counted once. Investment accounts use their latest manual valuation instead of their ledger balance.", "A property and its mortgage are separate lines: the home is an asset and the mortgage is a liability.", q.view === "household" ? "Household net worth includes only accounts, assets and debts shared with the household." : "My net worth includes everything you own, shared or personal."],
  };
}
export { addMonths, endOfMonth, nonNegMoney };
