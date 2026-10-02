import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { AppError, conflict, notFound } from "@/lib/errors";
import { dateToIso, isoToDate, todayInTz } from "@/lib/dates";
import { fromCents, toCents } from "@/lib/money";
import { budgetSchema, expenseSchema, expenseUpdateSchema } from "@/lib/validation";
import type { z } from "zod";
import type { Actor } from "../context";
import { budgetPeriod, budgetStatus } from "../engine/costs";
import { num, iso } from "../serialize";
import { accessibleVehicles, requireHouseholdAdmin, requireVehicle } from "./access";
import { audit } from "./audit";

const include = { vehicle: { select: { id: true, nickname: true, make: true, model: true, year: true } }, provider: { select: { name: true } }, documents: { where: { deletedAt: null }, select: { id: true, title: true, mimeType: true, category: true } } } satisfies Prisma.ExpenseInclude;
type ExpenseFull = Prisma.ExpenseGetPayload<{ include: typeof include }>;

export function expenseView(e: ExpenseFull) {
  return {
    id: e.id,
    vehicleId: e.vehicleId,
    vehicleName: e.vehicle.nickname || `${e.vehicle.year} ${e.vehicle.make} ${e.vehicle.model}`,
    date: iso(e.date),
    amount: Number(e.amount),
    tax: num(e.tax) ?? 0,
    currency: e.currency,
    category: e.category,
    vendor: e.vendor ?? e.provider?.name ?? null,
    providerId: e.providerId,
    description: e.description,
    paymentMethod: e.paymentMethod,
    notes: e.notes,
    maintenanceRecordId: e.maintenanceRecordId,
    repairIssueId: e.repairIssueId,
    fuelEntryId: e.fuelEntryId,
    linked: !!(e.maintenanceRecordId || e.fuelEntryId),
    documents: e.documents,
  };
}

export async function createExpense(actor: Actor, input: z.infer<typeof expenseSchema>) {
  const { vehicle } = await requireVehicle(actor, input.vehicleId, "viewFinancials");
  await requireVehicle(actor, input.vehicleId, "write");
  if (input.idempotencyKey) {
    const dup = await db.expense.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (dup) {
      if (dup.vehicleId !== vehicle.id) throw conflict("Idempotency key already used");
      return { id: dup.id, idempotentReplay: true };
    }
  }
  if (input.providerId) {
    const p = await db.serviceProvider.findFirst({ where: { id: input.providerId, householdId: vehicle.householdId, deletedAt: null } });
    if (!p) throw new AppError("VALIDATION_ERROR", "Unknown service provider");
  }
  if ((input.tax ?? 0) > input.amount) throw new AppError("VALIDATION_ERROR", "Tax cannot exceed the total amount");
  const e = await db.expense.create({
    data: { vehicleId: vehicle.id, date: isoToDate(input.date), amount: input.amount, tax: input.tax ?? 0, currency: input.currency ?? vehicle.currency, category: input.category, vendor: input.vendor ?? null, providerId: input.providerId ?? null, description: input.description ?? null, paymentMethod: input.paymentMethod ?? null, notes: input.notes ?? null, idempotencyKey: input.idempotencyKey ?? null, createdById: actor.id },
  });
  await audit(null, actor, { entity: "Expense", entityId: e.id, action: "create", vehicleId: vehicle.id, householdId: vehicle.householdId, after: { amount: input.amount, category: input.category } });
  return { id: e.id, idempotentReplay: false };
}

export async function updateExpense(actor: Actor, id: string, input: z.infer<typeof expenseUpdateSchema>) {
  const e = await db.expense.findFirst({ where: { id, deletedAt: null } });
  if (!e) throw notFound("Expense");
  const { vehicle } = await requireVehicle(actor, e.vehicleId, "viewFinancials");
  await requireVehicle(actor, e.vehicleId, "write");
  if (e.maintenanceRecordId || e.fuelEntryId) throw conflict("This expense was created from a service or fuel record — edit that record instead.");
  const data: Prisma.ExpenseUpdateInput = {};
  for (const [k, v] of Object.entries(input)) {
    if (v === undefined || k === "providerId") continue;
    (data as any)[k] = k === "date" ? isoToDate(v as string) : v;
  }
  if (input.providerId !== undefined) data.provider = input.providerId ? { connect: { id: input.providerId } } : { disconnect: true };
  const amount = input.amount ?? Number(e.amount);
  if ((input.tax ?? Number(e.tax)) > amount) throw new AppError("VALIDATION_ERROR", "Tax cannot exceed the total amount");
  await db.expense.update({ where: { id }, data });
  await audit(null, actor, { entity: "Expense", entityId: id, action: "update", vehicleId: vehicle.id, householdId: vehicle.householdId, before: { amount: Number(e.amount), category: e.category }, after: { amount, category: input.category ?? e.category } });
  return { id };
}

export async function deleteExpense(actor: Actor, id: string) {
  const e = await db.expense.findFirst({ where: { id, deletedAt: null } });
  if (!e) throw notFound("Expense");
  const { vehicle } = await requireVehicle(actor, e.vehicleId, "viewFinancials");
  await requireVehicle(actor, e.vehicleId, "write");
  if (e.maintenanceRecordId || e.fuelEntryId) throw conflict("This expense belongs to a service or fuel record — delete or edit that record instead.");
  await db.expense.update({ where: { id }, data: { deletedAt: new Date() } });
  await audit(null, actor, { entity: "Expense", entityId: id, action: "delete", vehicleId: vehicle.id, householdId: vehicle.householdId, before: { amount: Number(e.amount) } });
  return { ok: true };
}

export interface ExpenseQuery {
  vehicleId?: string;
  category?: string;
  from?: string;
  to?: string;
  q?: string;
  minAmount?: number;
  maxAmount?: number;
  sort?: "date_desc" | "date_asc" | "amount_desc" | "amount_asc";
  page?: number;
  pageSize?: number;
}

export async function listExpenses(actor: Actor, q: ExpenseQuery) {
  // Only vehicles whose financial data the actor may see
  const scope = await accessibleVehicles(actor, "viewFinancials", q.vehicleId && q.vehicleId !== "all" ? { vehicleId: q.vehicleId } : {});
  if (q.vehicleId && q.vehicleId !== "all" && scope.length === 0) {
    await requireVehicle(actor, q.vehicleId, "view"); // 404 if no access at all, otherwise forbidden
    throw new AppError("FORBIDDEN", "You don't have permission to view financial details for this vehicle");
  }
  const ids = scope.map((s) => s.vehicle.id);
  const where: Prisma.ExpenseWhereInput = {
    vehicleId: { in: ids },
    deletedAt: null,
    ...(q.category ? { category: q.category as any } : {}),
    ...(q.from || q.to ? { date: { ...(q.from ? { gte: isoToDate(q.from) } : {}), ...(q.to ? { lte: isoToDate(q.to) } : {}) } } : {}),
    ...(q.minAmount !== undefined || q.maxAmount !== undefined ? { amount: { ...(q.minAmount !== undefined ? { gte: q.minAmount } : {}), ...(q.maxAmount !== undefined ? { lte: q.maxAmount } : {}) } } : {}),
    ...(q.q ? { OR: [{ vendor: { contains: q.q, mode: "insensitive" } }, { description: { contains: q.q, mode: "insensitive" } }, { notes: { contains: q.q, mode: "insensitive" } }] } : {}),
  };
  const sort = q.sort ?? "date_desc";
  const orderBy: Prisma.ExpenseOrderByWithRelationInput[] = sort === "date_asc" ? [{ date: "asc" }] : sort === "amount_desc" ? [{ amount: "desc" }] : sort === "amount_asc" ? [{ amount: "asc" }] : [{ date: "desc" }, { createdAt: "desc" }];
  const page = Math.max(1, q.page ?? 1);
  const pageSize = Math.min(200, q.pageSize ?? 25);
  const [total, rows, agg] = await Promise.all([db.expense.count({ where }), db.expense.findMany({ where, include, orderBy, skip: (page - 1) * pageSize, take: pageSize }), db.expense.aggregate({ where, _sum: { amount: true, tax: true } })]);
  return { items: rows.map(expenseView), page, pageSize, total, totals: { amount: num(agg._sum.amount) ?? 0, tax: num(agg._sum.tax) ?? 0 } };
}

export async function getExpense(actor: Actor, id: string) {
  const e = await db.expense.findFirst({ where: { id, deletedAt: null }, include });
  if (!e) throw notFound("Expense");
  await requireVehicle(actor, e.vehicleId, "viewFinancials");
  return expenseView(e);
}

// ───────── budgets

export async function createBudget(actor: Actor, input: z.infer<typeof budgetSchema>) {
  let householdId: string;
  if (input.vehicleId) {
    const { vehicle } = await requireVehicle(actor, input.vehicleId, "viewFinancials");
    await requireVehicle(actor, input.vehicleId, "editVehicle");
    householdId = vehicle.householdId;
  } else {
    const hh = input.householdId ?? (await db.householdMember.findFirst({ where: { userId: actor.id, role: "ADMIN" } }))?.householdId;
    if (!hh) throw new AppError("FORBIDDEN", "Only household administrators can set household-wide budgets");
    await requireHouseholdAdmin(actor, hh);
    householdId = hh;
  }
  const dup = await db.budget.findFirst({ where: { householdId, vehicleId: input.vehicleId ?? null, period: input.period, year: input.year, month: input.period === "MONTHLY" ? input.month : null, deletedAt: null } });
  if (dup) throw conflict("A budget already exists for that period", { existingId: dup.id });
  const b = await db.budget.create({ data: { householdId, vehicleId: input.vehicleId ?? null, period: input.period, year: input.year, month: input.period === "MONTHLY" ? input.month ?? null : null, amount: input.amount, currency: input.currency ?? actor.prefs.currency, categories: input.categories, alertAtPercent: input.alertAtPercent } });
  await audit(null, actor, { entity: "Budget", entityId: b.id, action: "create", householdId, vehicleId: input.vehicleId ?? null, after: { amount: input.amount, period: input.period } });
  return { id: b.id };
}

export async function deleteBudget(actor: Actor, id: string) {
  const b = await db.budget.findFirst({ where: { id, deletedAt: null } });
  if (!b) throw notFound("Budget");
  if (b.vehicleId) await requireVehicle(actor, b.vehicleId, "editVehicle");
  else await requireHouseholdAdmin(actor, b.householdId);
  await db.budget.update({ where: { id }, data: { deletedAt: new Date() } });
  return { ok: true };
}

export async function updateBudget(actor: Actor, id: string, input: Partial<{ amount: number; categories: string[]; alertAtPercent: number[] }>) {
  const b = await db.budget.findFirst({ where: { id, deletedAt: null } });
  if (!b) throw notFound("Budget");
  if (b.vehicleId) await requireVehicle(actor, b.vehicleId, "editVehicle");
  else await requireHouseholdAdmin(actor, b.householdId);
  await db.budget.update({ where: { id }, data: { ...(input.amount !== undefined ? { amount: input.amount } : {}), ...(input.categories ? { categories: input.categories as any } : {}), ...(input.alertAtPercent ? { alertAtPercent: input.alertAtPercent } : {}) } });
  return { id };
}

/** Budgets the actor may see, each with live actual/remaining/utilization/projection. */
export async function listBudgets(actor: Actor, filter: { year?: number } = {}) {
  const scope = await accessibleVehicles(actor, "viewFinancials");
  const vehicleIds = scope.map((s) => s.vehicle.id);
  const hhIds = [...new Set(scope.map((s) => s.vehicle.householdId))];
  const adminHh = new Set(scope.filter((s) => s.access.householdRole === "ADMIN").map((s) => s.vehicle.householdId));
  const budgets = await db.budget.findMany({ where: { deletedAt: null, householdId: { in: hhIds }, ...(filter.year ? { year: filter.year } : {}), OR: [{ vehicleId: { in: vehicleIds } }, { vehicleId: null }] }, include: { vehicle: { select: { nickname: true, make: true, model: true, year: true } } }, orderBy: [{ year: "desc" }, { month: "desc" }] });
  const today = todayInTz(actor.prefs.timezone);
  const out = [];
  for (const b of budgets) {
    if (!b.vehicleId && !adminHh.has(b.householdId)) continue; // household-wide budgets: admins only
    const { start, end } = budgetPeriod(b.period, b.year, b.month);
    const scopeIds = b.vehicleId ? [b.vehicleId] : scope.filter((s) => s.vehicle.householdId === b.householdId).map((s) => s.vehicle.id);
    const rows = await db.expense.findMany({ where: { vehicleId: { in: scopeIds }, deletedAt: null, category: { in: b.categories }, date: { gte: isoToDate(start), lte: isoToDate(end) } }, select: { amount: true } });
    const actual = fromCents(rows.reduce((a, r) => a + toCents(Number(r.amount)), 0));
    const warnAt = [...b.alertAtPercent].sort((x, y) => x - y)[0] ?? 80;
    const st = budgetStatus({ amount: Number(b.amount), actual, periodStart: start, periodEnd: end, today, warnAtPct: warnAt });
    out.push({
      id: b.id,
      vehicleId: b.vehicleId,
      scopeLabel: b.vehicle ? b.vehicle.nickname || `${b.vehicle.year} ${b.vehicle.make} ${b.vehicle.model}` : "All household vehicles",
      period: b.period,
      year: b.year,
      month: b.month,
      amount: Number(b.amount),
      currency: b.currency,
      categories: b.categories,
      alertAtPercent: b.alertAtPercent,
      periodStart: start,
      periodEnd: end,
      ...st,
    });
  }
  return out;
}

export async function expenseLinkedSources(vehicleId: string) {
  return db.expense.count({ where: { vehicleId, deletedAt: null, OR: [{ maintenanceRecordId: { not: null } }, { fuelEntryId: { not: null } }] } });
}
export { dateToIso };
