import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { addMonths, diffDays, isoToDate, resolveRange, startOfYear, todayInTz, type IsoDate, type RangeKey } from "@/lib/dates";
import { formatDistance } from "@/lib/units";
import { formatMoney, fromCents, toCents } from "@/lib/money";
import type { Actor } from "../context";
import { costPerDistance, spendByCategory, spendByMonth, spendByProvider, spendByYear, type ExpenseRow } from "../engine/costs";
import { generateInsights } from "../engine/insights";
import { monthlyDistance, type Reading } from "../engine/mileage";
import { maintenanceHealth } from "../engine/schedule";
import { num, iso } from "../serialize";
import { scopeVehicles, type VehicleScope } from "./access";
import { loadReadings, evaluateVehicleSchedules } from "./schedules";
import { listWarranties } from "./parts";
import { upcoming } from "./reminders";

export interface RangeQuery {
  vehicleId?: string;
  range?: RangeKey;
  from?: IsoDate;
  to?: IsoDate;
  exclude?: string[];
}

async function expenseRows(scope: VehicleScope[], range: { from: IsoDate | null; to: IsoDate }, prefCurrency: string) {
  const ids = scope.filter((s) => s.fin).map((s) => s.vehicle.id);
  if (!ids.length) return { rows: [] as (ExpenseRow & { vehicleId: string })[], currency: prefCurrency, otherCurrency: 0, hasFinancialAccess: false };
  const where: Prisma.ExpenseWhereInput = { vehicleId: { in: ids }, deletedAt: null, date: { ...(range.from ? { gte: isoToDate(range.from) } : {}), lte: isoToDate(range.to) } };
  const all = await db.expense.findMany({ where, include: { provider: { select: { name: true } } }, orderBy: { date: "asc" } });
  const counts = new Map<string, number>();
  for (const e of all) counts.set(e.currency, (counts.get(e.currency) ?? 0) + 1);
  const currency = counts.has(prefCurrency) || counts.size === 0 ? prefCurrency : [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const rows = all.filter((e) => e.currency === currency).map((e) => ({ vehicleId: e.vehicleId, date: iso(e.date) as IsoDate, amount: Number(e.amount), category: e.category, vendor: e.vendor, providerId: e.providerId, providerName: e.provider?.name ?? null, currency }));
  return { rows, currency, otherCurrency: all.length - rows.length, hasFinancialAccess: true };
}

async function perVehicleCostPerKm(scope: VehicleScope[], rows: (ExpenseRow & { vehicleId: string })[], range: { from: IsoDate | null; to: IsoDate }, filter: { include?: string[]; exclude?: string[] }) {
  let cost = 0;
  let dist = 0;
  let excluded = { count: 0, amount: 0 };
  let partial = false;
  let any = false;
  const notes: string[] = [];
  for (const s of scope.filter((x) => x.fin)) {
    const readings = await loadReadings(db, s.vehicle.id);
    const r = costPerDistance(rows.filter((e) => e.vehicleId === s.vehicle.id), readings, { from: range.from, to: range.to }, filter);
    if (r.costPerKm === null) {
      if (rows.some((e) => e.vehicleId === s.vehicle.id)) notes.push(`${s.vehicle.nickname}: ${r.note}`);
      continue;
    }
    any = true;
    cost += toCents(r.totalCost);
    dist += r.distanceKm ?? 0;
    excluded = { count: excluded.count + r.excludedOutsideCoverage.count, amount: fromCents(toCents(excluded.amount) + toCents(r.excludedOutsideCoverage.amount)) };
    if (r.coverage !== "full") partial = true;
  }
  return { costPerKm: any && dist > 0 ? fromCents(cost) / dist : null, totalCost: fromCents(cost), distanceKm: any ? dist : null, excludedOutsideCoverage: excluded, partialCoverage: partial, notes };
}

export async function getExpenseAnalytics(actor: Actor, q: RangeQuery) {
  const scope = await scopeVehicles(actor, q.vehicleId, "view");
  const today = todayInTz(actor.prefs.timezone);
  const range = resolveRange(q.range ?? "12m", today, { from: q.from, to: q.to });
  const { rows, currency, otherCurrency, hasFinancialAccess } = await expenseRows(scope, range, actor.prefs.currency);
  const exclude = q.exclude ?? [];
  const forCalc = rows.filter((r) => !exclude.includes(r.category));
  const total = fromCents(forCalc.reduce((a, r) => a + toCents(r.amount), 0));
  const sumCat = (c: string) => fromCents(rows.filter((r) => r.category === c).reduce((a, r) => a + toCents(r.amount), 0));
  const maintenance = sumCat("MAINTENANCE");
  const repairs = sumCat("REPAIRS");
  const firstDate = rows[0]?.date ?? range.from ?? today;
  const startRef = range.from && range.from > firstDate ? range.from : firstDate;
  const months = Math.max(1, diffDays(range.to, startRef) / 30.4375);
  const repairRows = rows.filter((r) => r.category === "REPAIRS");
  const monthFrom = range.from ?? firstDate;
  const [cpkTotal, cpkMaint, cpkRepair, odo, repairByComp] = await Promise.all([
    perVehicleCostPerKm(scope, rows, range, { exclude }),
    perVehicleCostPerKm(scope, rows, range, { include: ["MAINTENANCE"] }),
    perVehicleCostPerKm(scope, rows, range, { include: ["REPAIRS"] }),
    q.vehicleId && q.vehicleId !== "all" ? loadReadings(db, q.vehicleId) : Promise.resolve([] as Reading[]),
    hasFinancialAccess ? repairCostByComponent(scope.filter((s) => s.fin).map((s) => s.vehicle.id), range) : Promise.resolve([]),
  ]);
  const yearAll = spendByYear(rows);
  return {
    range: { key: q.range ?? "12m", from: range.from, to: range.to, label: range.label },
    currency,
    hasFinancialAccess,
    otherCurrencyExpenses: otherCurrency,
    exclude,
    totals: { all: total, maintenance, repairs, fuel: sumCat("FUEL"), insurance: sumCat("INSURANCE"), count: rows.length },
    averages: {
      monthlyOwnership: fromCents(Math.round(toCents(total) / months)),
      monthlyMaintenance: fromCents(Math.round(toCents(maintenance) / months)),
      annualOwnership: fromCents(Math.round((toCents(total) / months) * 12)),
      averageRepairCost: repairRows.length ? fromCents(Math.round(repairRows.reduce((a, r) => a + toCents(r.amount), 0) / repairRows.length)) : null,
      monthsCovered: Math.round(months * 10) / 10,
    },
    costPerDistance: {
      totalOwnership: cpkTotal,
      maintenanceOnly: cpkMaint,
      repairOnly: cpkRepair,
      note: "Cost per distance = expenses ÷ distance driven in the period covered by odometer readings. Expenses outside that coverage are excluded so the figure is never inflated.",
    },
    byCategory: spendByCategory(rows),
    byProvider: spendByProvider(rows).slice(0, 12),
    byYear: yearAll,
    byMonth: spendByMonth(rows, monthFrom, range.to).map((m) => ({ ...m, maintenance: sumMonth(rows, m.month, ["MAINTENANCE"]), repairs: sumMonth(rows, m.month, ["REPAIRS"]), other: sumMonth(rows, m.month, null, ["MAINTENANCE", "REPAIRS"]) })),
    repairByComponent: repairByComp,
    mileageMonthly: monthlyDistance(odo),
  };
}

function sumMonth(rows: ExpenseRow[], month: string, include: string[] | null, exclude: string[] = []) {
  return fromCents(rows.filter((r) => r.date.startsWith(month) && (!include || include.includes(r.category)) && !exclude.includes(r.category)).reduce((a, r) => a + toCents(r.amount), 0));
}

async function repairCostByComponent(vehicleIds: string[], range: { from: IsoDate | null; to: IsoDate }) {
  const recs = await db.maintenanceRecord.findMany({ where: { vehicleId: { in: vehicleIds }, kind: "REPAIR", status: "COMPLETED", deletedAt: null, serviceDate: { ...(range.from ? { gte: isoToDate(range.from) } : {}), lte: isoToDate(range.to) } }, include: { repairIssue: true, items: { include: { category: true } } } });
  const m = new Map<string, { component: string; total: number; count: number }>();
  for (const r of recs) {
    const key = r.repairIssue?.componentKey ?? r.items.find((i) => i.componentKey)?.componentKey ?? r.items.find((i) => i.category)?.category?.name ?? "uncategorised";
    const cur = m.get(key) ?? { component: key, total: 0, count: 0 };
    cur.total = fromCents(toCents(cur.total) + toCents(Number(r.totalCost)));
    cur.count++;
    m.set(key, cur);
  }
  return [...m.values()].sort((a, b) => b.total - a.total);
}

// ───────── Dashboard

export async function getDashboard(actor: Actor, q: RangeQuery) {
  const scope = await scopeVehicles(actor, q.vehicleId, "view");
  const today = todayInTz(actor.prefs.timezone);
  const unit = actor.prefs.distanceUnit;
  const yearStart = startOfYear(today);
  const bundles = await Promise.all(scope.map(async (s) => ({ s, b: await evaluateVehicleSchedules(s.vehicle.id, actor.prefs, s.fin, db, today) })));
  const finIds = scope.filter((s) => s.fin).map((s) => s.vehicle.id);
  const ids = scope.map((s) => s.vehicle.id);
  const [openIssues, thisYear, lifetime, recent, issues] = await Promise.all([
    db.repairIssue.count({ where: { vehicleId: { in: ids }, deletedAt: null, status: { notIn: ["RESOLVED", "CLOSED"] } } }),
    finIds.length ? db.expense.groupBy({ by: ["category", "currency"], where: { vehicleId: { in: finIds }, deletedAt: null, date: { gte: isoToDate(yearStart), lte: isoToDate(today) }, category: { in: ["MAINTENANCE", "REPAIRS"] } }, _sum: { amount: true } }) : Promise.resolve([]),
    finIds.length ? db.expense.groupBy({ by: ["currency"], where: { vehicleId: { in: finIds }, deletedAt: null }, _sum: { amount: true } }) : Promise.resolve([]),
    db.maintenanceRecord.findMany({ where: { vehicleId: { in: ids }, deletedAt: null, status: "COMPLETED" }, orderBy: [{ serviceDate: "desc" }, { createdAt: "desc" }], take: 8, include: { vehicle: { select: { nickname: true } } } }),
    db.repairIssue.findMany({ where: { vehicleId: { in: ids }, deletedAt: null, status: { notIn: ["RESOLVED", "CLOSED"] } }, orderBy: [{ severity: "desc" }, { discoveredAt: "desc" }], take: 8, include: { vehicle: { select: { nickname: true } } } }),
  ]);
  const pickCur = (list: { currency: string }[]) => (list.some((x) => x.currency === actor.prefs.currency) ? actor.prefs.currency : list[0]?.currency ?? actor.prefs.currency);
  const cur = pickCur([...thisYear, ...lifetime]);
  const sumYear = (cat: string) => thisYear.filter((x) => x.category === cat && x.currency === cur).reduce((a, x) => a + Number(x._sum.amount ?? 0), 0);
  const allActive = bundles.flatMap(({ b }) => b.items.filter((i) => i.enabled));
  const combinedKm = scope.reduce((a, s) => a + (s.vehicle.currentOdometerKm !== null ? Number(s.vehicle.currentOdometerKm) : 0), 0);

  const expense = await getExpenseAnalytics(actor, q);
  const up = await upcoming(actor, { vehicleId: q.vehicleId, horizonDays: 120 });
  const warranties = (await listWarranties(actor, q.vehicleId)).filter((w) => w.status === "expiring" || (w.status === "expired" && (w.daysRemaining ?? -999) > -30)).slice(0, 6);

  // Insights per vehicle
  const insights = [];
  for (const { s, b } of bundles) {
    const [repl, w12, w24, openCount, wr] = await Promise.all([
      db.installedPart.groupBy({ by: ["componentKey"], where: { vehicleId: s.vehicle.id, part: { deletedAt: null } }, _count: { _all: true } }),
      s.fin ? db.expense.aggregate({ where: { vehicleId: s.vehicle.id, deletedAt: null, category: { in: ["MAINTENANCE", "REPAIRS"] }, currency: cur, date: { gt: isoToDate(addMonths(today, -12)), lte: isoToDate(today) } }, _sum: { amount: true } }) : Promise.resolve(null),
      s.fin ? db.expense.aggregate({ where: { vehicleId: s.vehicle.id, deletedAt: null, category: { in: ["MAINTENANCE", "REPAIRS"] }, currency: cur, date: { gt: isoToDate(addMonths(today, -24)), lte: isoToDate(addMonths(today, -12)) } }, _sum: { amount: true } }) : Promise.resolve(null),
      db.repairIssue.count({ where: { vehicleId: s.vehicle.id, deletedAt: null, status: { notIn: ["RESOLVED", "CLOSED"] } } }),
      listWarranties(actor, s.vehicle.id),
    ]);
    const recent24 = await db.installedPart.groupBy({ by: ["componentKey"], where: { vehicleId: s.vehicle.id, part: { deletedAt: null }, installedAt: { gt: isoToDate(addMonths(today, -24)) } }, _count: { _all: true } });
    const r24 = new Map(recent24.map((r) => [r.componentKey, r._count._all]));
    insights.push(
      ...generateInsights({
        vehicleId: s.vehicle.id,
        vehicleName: s.vehicle.nickname,
        today,
        schedules: b.items.map((i) => ({ id: i.id, name: i.name, status: i.status, summary: i.summary, effectiveDueDate: i.effectiveDueDate, estimatedMonthsToKm: i.estimatedMonthsToKm, estimateBasis: i.estimateBasis, enabled: i.enabled })),
        replacements: repl.map((r) => ({ componentKey: r.componentKey, count: r._count._all, withinMonths24: r24.get(r.componentKey) ?? 0 })).filter((r) => r.count > 1).map((r) => ({ ...r, count: r.count })),
        spendLast12: s.fin ? Number(w12?._sum.amount ?? 0) : null,
        spendPrev12: s.fin ? Number(w24?._sum.amount ?? 0) : null,
        fmtMoney: (n) => formatMoney(n, cur),
        warranties: wr.filter((w) => w.endDate).map((w) => ({ name: w.name, endDate: w.endDate as string })),
        openIssues: openCount,
        avgMonthlyKmText: b.usage.avgMonthlyKm ? formatDistance(b.usage.avgMonthlyKm, unit) : null,
        hasOdometer: b.currentKm !== null,
      }),
    );
  }
  const health = maintenanceHealth(allActive.map((i) => ({ status: i.status, priority: i.priority })));
  return {
    scope: q.vehicleId && q.vehicleId !== "all" ? "vehicle" : "household",
    today,
    kpis: {
      vehicles: scope.length,
      combinedKm,
      upcomingMaintenance: allActive.filter((i) => ["UPCOMING", "DUE_SOON", "DUE_NOW", "INSPECTION_REQUIRED"].includes(i.status)).length,
      overdueMaintenance: allActive.filter((i) => i.status === "OVERDUE").length,
      outstandingRepairs: openIssues,
      maintenanceSpendYtd: finIds.length ? sumYear("MAINTENANCE") : null,
      repairSpendYtd: finIds.length ? sumYear("REPAIRS") : null,
      lifetimeSpend: finIds.length ? lifetime.filter((x) => x.currency === cur).reduce((a, x) => a + Number(x._sum.amount ?? 0), 0) : null,
      currency: cur,
      health,
    },
    vehicles: bundles.map(({ s, b }) => {
      const en = b.items.filter((i) => i.enabled);
      const next = en.find((i) => !["UNKNOWN_HISTORY"].includes(i.status) && i.effectiveDueDate !== null) ?? en.find((i) => i.status !== "UNKNOWN_HISTORY") ?? null;
      return {
        id: s.vehicle.id,
        name: s.vehicle.nickname,
        subtitle: `${s.vehicle.year} ${s.vehicle.make} ${s.vehicle.model}`,
        photoUrl: s.vehicle.photoDocumentId ? `/api/documents/${s.vehicle.photoDocumentId}/file` : null,
        currentKm: b.currentKm,
        health: b.health,
        nextService: next ? { name: next.name, status: next.status, summary: next.summary, dueDate: next.effectiveDueDate } : null,
        overdue: en.filter((i) => i.status === "OVERDUE").length,
        unknown: en.filter((i) => i.status === "UNKNOWN_HISTORY").length,
        isDemo: s.vehicle.isDemo,
      };
    }),
    upcoming: up.slice(0, 10),
    recentActivity: recent.map((r) => ({ id: r.id, title: r.title, date: iso(r.serviceDate), vehicleName: r.vehicle.nickname, kind: r.kind, odometerKm: num(r.odometerKm), totalCost: scope.find((x) => x.vehicle.id === r.vehicleId)?.fin ? num(r.totalCost) : null, currency: r.currency })),
    openIssues: issues.map((i) => ({ id: i.id, title: i.title, severity: i.severity, status: i.status, vehicleName: i.vehicle.nickname, discoveredAt: iso(i.discoveredAt) })),
    warranties,
    insights: insights.slice(0, 12),
    expense,
    hasDemo: scope.some((s) => s.vehicle.isDemo),
  };
}

export type Dashboard = Awaited<ReturnType<typeof getDashboard>>;
export { diffDays };
