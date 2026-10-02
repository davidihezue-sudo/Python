// Vehicles inside the finance product. The vehicle module (maintenance, service history, repairs) stays the source of truth for vehicle facts.
// The ledger stays the single source of truth for money: a transaction tagged with a vehicle is that vehicle's cost, counted once.
// Vehicle costs are therefore computed only from ledger rows the actor may see AND only for vehicles the actor may see financials of.
import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { accessibleVehicles, requireVehicle } from "../services/access";
import { evaluateVehicleSchedules } from "../services/schedules";
import { money, ZERO, type Dec } from "./engine/decimal";
import { netExpense } from "./analytics";
import { loadCategories, loadReportTxs } from "./load";
import { isoDate } from "./common";
import type { FinCtx, View } from "./access";

export const vehicleOverviewQuery = z.object({ view: z.enum(["my", "household"]).default("household"), from: isoDate.optional(), to: isoDate.optional() });
const KM_PER_MI = 1.609344;

/** A vehicle id supplied on a record must be a vehicle the actor can see, in the same household. Never trusted blindly. */
export async function assertVehicleLink(ctx: FinCtx, vehicleId: string | null | undefined) {
  if (!vehicleId) return;
  const { vehicle } = await requireVehicle(ctx.actor, vehicleId, "view");
  if (vehicle.householdId !== ctx.householdId) throw new AppError("VALIDATION_ERROR", "That vehicle belongs to a different household");
}

export async function vehicleOptions(ctx: FinCtx) {
  const scope = await accessibleVehicles(ctx.actor, "view", { householdId: ctx.householdId });
  return scope.map((s) => ({ id: s.vehicle.id, name: s.vehicle.nickname || `${s.vehicle.year} ${s.vehicle.make} ${s.vehicle.model}`, year: s.vehicle.year, make: s.vehicle.make, model: s.vehicle.model }));
}

/** Per vehicle: upcoming maintenance, open repairs and the money spent on it. */
export async function vehicleOverview(ctx: FinCtx, q: z.infer<typeof vehicleOverviewQuery>) {
  const from = q.from ?? `${ctx.today.slice(0, 4)}-01-01`;
  const to = q.to ?? ctx.today;
  const view: View = q.view;
  const scope = await accessibleVehicles(ctx.actor, "view", { householdId: ctx.householdId });
  const ids = scope.map((s) => s.vehicle.id);
  const withCosts = scope.filter((s) => s.fin).map((s) => s.vehicle.id);
  const [{ txs }, cats] = ids.length ? await Promise.all([loadReportTxs(ctx, from, to, view, { vehicleId: { in: withCosts } }), loadCategories(ctx)]) : [{ txs: [] }, []];
  const catName = new Map(cats.map((c) => [c.id, c.name]));
  const distUnit = ctx.actor.prefs.distanceUnit;
  const out = [];
  let grand = ZERO;
  for (const s of scope) {
    const v = s.vehicle;
    const bundle = await evaluateVehicleSchedules(v.id, ctx.actor.prefs, s.fin);
    const enabled = bundle.items.filter((i) => i.enabled && i.status !== "UNKNOWN_HISTORY");
    const next = enabled.filter((i) => i.effectiveDueDate).sort((a, b) => (a.effectiveDueDate as string).localeCompare(b.effectiveDueDate as string))[0] ?? null;
    const openIssues = await db.repairIssue.count({ where: { vehicleId: v.id, deletedAt: null, status: { notIn: ["RESOLVED", "CLOSED"] } } });
    const mine = txs.filter((t) => t.vehicleId === v.id);
    let total = ZERO;
    const byCat = new Map<string, Dec>();
    const byMonth = new Map<string, Dec>();
    for (const t of mine) {
      const ne = netExpense(t);
      if (ne === null) continue;
      total = total.plus(ne);
      const k = t.categoryId ? (catName.get(t.categoryId) ?? "Uncategorised") : "Uncategorised";
      byCat.set(k, (byCat.get(k) ?? ZERO).plus(ne));
      byMonth.set(t.date.slice(0, 7), (byMonth.get(t.date.slice(0, 7)) ?? ZERO).plus(ne));
    }
    grand = grand.plus(total);
    // Distance driven in the period from recorded odometer readings (needs two readings, otherwise it is unknown, not zero).
    const readings = await db.odometerEntry.findMany({ where: { vehicleId: v.id, deletedAt: null, date: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) } }, orderBy: { date: "asc" }, select: { valueKm: true } });
    const kmDriven = readings.length >= 2 ? Number(readings[readings.length - 1].valueKm) - Number(readings[0].valueKm) : null;
    const dist = kmDriven !== null && kmDriven > 0 ? (distUnit === "MI" ? kmDriven / KM_PER_MI : kmDriven) : null;
    out.push({
      id: v.id, name: v.nickname || `${v.year} ${v.make} ${v.model}`, year: v.year, make: v.make, model: v.model, currentOdometerKm: v.currentOdometerKm === null ? null : Number(v.currentOdometerKm), isDemo: v.isDemo,
      canViewFinancials: s.fin, health: bundle.health, overdueCount: enabled.filter((i) => i.status === "OVERDUE").length, dueCount: enabled.filter((i) => i.status === "DUE_NOW" || i.status === "DUE_SOON").length, openIssues,
      nextService: next ? { name: next.name, status: next.status, summary: next.summary, dueDate: next.effectiveDueDate } : null,
      renewals: [["Insurance", v.insuranceRenewalDate], ["Registration", v.registrationExpiryDate], ["Inspection", v.nextInspectionDate]].filter(([, d]) => d).map(([label, d]) => ({ label: label as string, date: (d as Date).toISOString().slice(0, 10) })),
      costs: s.fin ? {
        total: money(total), transactions: mine.length,
        byCategory: [...byCat].map(([name, amount]) => ({ name, amount: money(amount) })).sort((a, b) => Number(b.amount) - Number(a.amount)),
        byMonth: [...byMonth].sort(([a], [b]) => a.localeCompare(b)).map(([month, amount]) => ({ month, amount: money(amount) })),
        distanceDriven: dist === null ? null : Math.round(dist), costPerDistance: dist === null ? null : money(total.div(dist)),
      } : null,
    });
  }
  return {
    view, from, to, currency: ctx.base, distanceUnit: distUnit, vehicles: out, totalCost: money(grand),
    notes: [
      "Costs are the ledger transactions you tagged with a vehicle. They are counted once, in the ledger, and never added to anything entered in the vehicle module.",
      "Cost per distance needs at least two odometer readings inside the period.",
      "Only transactions you are allowed to see are included. Another member's personal transactions never appear here.",
      ...(scope.some((s) => !s.fin) ? ["Some vehicles hide their costs from you because you do not have financial access to them."] : []),
    ],
  };
}

/** Maintenance and renewal dates for the money calendar. Items are neutral (no money moves) and carry an estimate only when you may see costs. */
export async function vehicleObligations(ctx: FinCtx, from: string, to: string) {
  const scope = await accessibleVehicles(ctx.actor, "view", { householdId: ctx.householdId });
  const out: { key: string; date: string; kind: "MAINTENANCE" | "VEHICLE_RENEWAL"; title: string; amount: string | null; direction: "neutral"; sourceType: "vehicle"; sourceId: string; status?: string; ownerMemberId: null; completed: false; note?: string }[] = [];
  for (const s of scope) {
    const v = s.vehicle;
    const name = v.nickname || `${v.year} ${v.make} ${v.model}`;
    const bundle = await evaluateVehicleSchedules(v.id, ctx.actor.prefs, s.fin, db, ctx.today);
    for (const i of bundle.items) {
      if (!i.enabled || !i.effectiveDueDate || i.status === "UNKNOWN_HISTORY") continue;
      // overdue items are pinned to today so they stay visible
      const date = i.effectiveDueDate < ctx.today ? ctx.today : i.effectiveDueDate;
      if (date < from || date > to) continue;
      out.push({ key: `veh:${i.id}:${date}`, date, kind: "MAINTENANCE", title: `${name}: ${i.name}`, amount: s.fin && i.estCostMax ? money(i.estCostMax) : null, direction: "neutral", sourceType: "vehicle", sourceId: v.id, status: i.status, ownerMemberId: null, completed: false, note: i.summary });
    }
    for (const [label, d] of [["Insurance renews", v.insuranceRenewalDate], ["Registration expires", v.registrationExpiryDate], ["Inspection due", v.nextInspectionDate]] as const) {
      const date = d ? d.toISOString().slice(0, 10) : null;
      if (date && date >= from && date <= to) out.push({ key: `vehren:${v.id}:${label}`, date, kind: "VEHICLE_RENEWAL", title: `${name}: ${label.toLowerCase()}`, amount: null, direction: "neutral", sourceType: "vehicle", sourceId: v.id, ownerMemberId: null, completed: false });
    }
  }
  return out;
}

