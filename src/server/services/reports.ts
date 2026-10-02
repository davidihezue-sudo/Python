import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { addMonths, diffDays, isoToDate, resolveRange, todayInTz, type IsoDate } from "@/lib/dates";
import { fromCents, toCents } from "@/lib/money";
import { distanceLabel, fuelEconomyLabel, kmToUnit, litresPer100kmToUnit, litresToUnit, volumeLabel } from "@/lib/units";
import type { Actor } from "../context";
import { computeFuelStats } from "../engine/fuel";
import { costPerDistance } from "../engine/costs";
import { num, iso } from "../serialize";
import { accessibleVehicles, requireVehicle, scopeVehicles, type VehicleScope } from "./access";
import { loadReadings, evaluateVehicleSchedules } from "./schedules";
import { listWarranties } from "./parts";

export type ReportType = "service-history" | "annual-summary" | "repair-history" | "expense-statement" | "costs-by-category" | "cost-per-distance" | "parts-history" | "upcoming-forecast" | "warranty" | "fuel-consumption" | "household-expenses";

export interface Column {
  key: string;
  label: string;
  align?: "left" | "right";
  format?: "text" | "money" | "distance" | "date" | "number" | "percent";
  sensitivity?: "cost" | "provider";
  width?: number;
}
export interface ReportData {
  type: ReportType;
  title: string;
  subtitle?: string;
  generatedAt: string;
  generatedFor: string;
  vehicles: { name: string; make: string; model: string; year: number; trim?: string | null; vin?: string | null; registration?: string | null; odometer?: string | null }[];
  privacy: { hideVin: boolean; hideCosts: boolean; hideProviders: boolean };
  units: { distance: string; currency: string };
  columns: Column[];
  rows: Record<string, string | number | null>[];
  summary: { label: string; value: string | number; sensitivity?: "cost" }[];
  notes: string[];
}

export interface ReportParams {
  type: ReportType;
  vehicleId?: string;
  year?: number;
  from?: IsoDate;
  to?: IsoDate;
  hideVin?: boolean;
  hideCosts?: boolean;
  hideProviders?: boolean;
}

export const REPORT_CATALOG: { type: ReportType; label: string; description: string; needsVehicle: boolean; needsYear?: boolean; financial?: boolean; shareable: boolean }[] = [
  { type: "service-history", label: "Complete service history", description: "Every completed service and repair with dates, odometer, work done, parts, provider and cost. Ideal for a mechanic, dealer, insurer or buyer.", needsVehicle: true, shareable: true },
  { type: "annual-summary", label: "Annual maintenance summary", description: "Month-by-month maintenance and repair totals for a chosen year.", needsVehicle: true, needsYear: true, financial: true, shareable: false },
  { type: "repair-history", label: "Lifetime repair history", description: "Reported issues and completed repairs with outcome and cost.", needsVehicle: true, shareable: true },
  { type: "expense-statement", label: "Vehicle expense statement", description: "All expenses in a period with totals by category.", needsVehicle: true, financial: true, shareable: false },
  { type: "costs-by-category", label: "Maintenance costs by category", description: "Where the money went — by expense category and by maintenance category.", needsVehicle: true, financial: true, shareable: false },
  { type: "cost-per-distance", label: "Cost per kilometre / mile", description: "Maintenance-only, repair-only and total cost per distance by year, using only periods covered by odometer readings.", needsVehicle: true, financial: true, shareable: false },
  { type: "parts-history", label: "Parts replacement history", description: "Every part ever installed for each component, with installation/removal odometer and warranty.", needsVehicle: true, shareable: true },
  { type: "upcoming-forecast", label: "Upcoming maintenance forecast", description: "Items due within the next 12 months with estimated dates and any cost estimates you entered.", needsVehicle: true, shareable: false },
  { type: "warranty", label: "Warranty report", description: "Vehicle and part warranties with remaining coverage.", needsVehicle: false, shareable: true },
  { type: "fuel-consumption", label: "Fuel consumption report", description: "Fill-ups with computed economy and totals.", needsVehicle: true, shareable: false },
  { type: "household-expenses", label: "Household vehicle expense report", description: "Spending across all vehicles you can see financial data for.", needsVehicle: false, financial: true, shareable: false },
];

const cap = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, " ");
const vehicleName = (v: { nickname: string; year: number; make: string; model: string }) => v.nickname || `${v.year} ${v.make} ${v.model}`;

function vehicleSummary(s: VehicleScope, actor: Actor) {
  const v = s.vehicle;
  return { name: vehicleName(v), make: v.make, model: v.model, year: v.year, trim: v.trim, vin: v.vin, registration: v.registrationNumber, odometer: v.currentOdometerKm !== null ? `${Math.round(kmToUnit(Number(v.currentOdometerKm), actor.prefs.distanceUnit)).toLocaleString("en-CA")} ${distanceLabel(actor.prefs.distanceUnit)}` : null };
}

export async function buildReport(actor: Actor, p: ReportParams): Promise<ReportData> {
  const meta = REPORT_CATALOG.find((r) => r.type === p.type);
  if (!meta) throw new AppError("BAD_REQUEST", "Unknown report type");
  const today = todayInTz(actor.prefs.timezone);
  const unit = actor.prefs.distanceUnit;
  const dLabel = distanceLabel(unit);
  const dist = (km: number | null) => (km === null ? null : Math.round(kmToUnit(km, unit)));
  let scope: VehicleScope[];
  if (meta.needsVehicle) {
    if (!p.vehicleId || p.vehicleId === "all") throw new AppError("VALIDATION_ERROR", "Choose a vehicle for this report");
    scope = await scopeVehicles(actor, p.vehicleId, "view");
  } else scope = await scopeVehicles(actor, p.vehicleId, "view");
  if (!scope.length) throw new AppError("NOT_FOUND", "No vehicles available for this report");
  const finScope = scope.filter((s) => s.fin);
  if (meta.financial && !finScope.length) throw new AppError("FORBIDDEN", "You don't have permission to view financial details for the selected vehicle(s)");
  const canCosts = finScope.length > 0 && scope.every((s) => s.fin);
  const privacy = { hideVin: p.hideVin ?? actor.prefs.shareHideVin, hideCosts: p.hideCosts ?? actor.prefs.shareHideCosts, hideProviders: p.hideProviders ?? actor.prefs.shareHideProviders };
  if (!canCosts) privacy.hideCosts = true;
  const base = { type: p.type, generatedAt: new Date().toISOString(), generatedFor: actor.name, vehicles: scope.map((s) => vehicleSummary(s, actor)), privacy, units: { distance: dLabel, currency: actor.prefs.currency }, notes: ["Generated by AutoVault from owner-recorded data. It is not a manufacturer, dealer or inspection record."] };
  const ids = scope.map((s) => s.vehicle.id);
  const finIds = finScope.map((s) => s.vehicle.id);
  const cur = actor.prefs.currency;
  const dateFilter = (from?: IsoDate, to?: IsoDate) => (from || to ? { ...(from ? { gte: isoToDate(from) } : {}), ...(to ? { lte: isoToDate(to) } : {}) } : undefined);
  const multi = scope.length > 1;
  const vcol: Column[] = multi ? [{ key: "vehicle", label: "Vehicle" }] : [];
  const vname = new Map(scope.map((s) => [s.vehicle.id, vehicleName(s.vehicle)]));

  switch (p.type) {
    case "service-history": {
      const range = dateFilter(p.from, p.to);
      const recs = await db.maintenanceRecord.findMany({ where: { vehicleId: { in: ids }, deletedAt: null, status: "COMPLETED", ...(range ? { serviceDate: range } : {}) }, include: { items: true, provider: true }, orderBy: [{ serviceDate: "asc" }, { createdAt: "asc" }] });
      const rows = recs.map((r) => ({
        vehicle: vname.get(r.vehicleId) ?? "",
        date: iso(r.serviceDate),
        odometer: dist(num(r.odometerKm)),
        type: r.kind === "REPAIR" ? "Repair" : "Maintenance",
        service: r.title,
        details: r.items.map((i) => `${i.name}${i.completed ? "" : " (not completed)"}`).join("; ") || r.description || "",
        parts: r.items.filter((i) => i.partName).map((i) => `${Number(i.quantity)}× ${i.partName}${i.partManufacturer ? ` (${i.partManufacturer}${i.partNumber ? ` ${i.partNumber}` : ""})` : i.partNumber ? ` (${i.partNumber})` : ""}`).join("; "),
        performedBy: cap(r.workPerformedBy),
        provider: r.provider?.name ?? r.mechanicName ?? "",
        cost: scope.find((s) => s.vehicle.id === r.vehicleId)?.fin ? num(r.totalCost) : null,
      }));
      const total = fromCents(recs.filter((r) => finIds.includes(r.vehicleId)).reduce((a, r) => a + toCents(Number(r.totalCost)), 0));
      return {
        ...base,
        title: "Service History",
        subtitle: p.from || p.to ? `${p.from ?? "start"} to ${p.to ?? today}` : "All recorded services",
        columns: [...vcol, { key: "date", label: "Date", format: "date", width: 62 }, { key: "odometer", label: `Odometer (${dLabel})`, format: "number", align: "right", width: 62 }, { key: "type", label: "Type", width: 55 }, { key: "service", label: "Service", width: 110 }, { key: "details", label: "Work performed", width: 150 }, { key: "parts", label: "Parts", width: 120 }, { key: "performedBy", label: "Done by", width: 70 }, { key: "provider", label: "Provider", sensitivity: "provider", width: 80 }, { key: "cost", label: `Cost (${cur})`, format: "money", align: "right", sensitivity: "cost", width: 60 }],
        rows,
        summary: [{ label: "Services recorded", value: rows.length }, { label: "Total cost", value: total, sensitivity: "cost" }],
      };
    }
    case "annual-summary": {
      const year = p.year ?? Number(today.slice(0, 4));
      const recs = await db.expense.findMany({ where: { vehicleId: { in: finIds }, deletedAt: null, currency: cur, date: { gte: isoToDate(`${year}-01-01`), lte: isoToDate(`${year}-12-31`) }, category: { in: ["MAINTENANCE", "REPAIRS", "TIRES"] } } });
      const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);
      const rows = months.map((m) => {
        const inM = recs.filter((r) => iso(r.date)?.startsWith(m));
        const s = (c: string) => fromCents(inM.filter((r) => r.category === c).reduce((a, r) => a + toCents(Number(r.amount)), 0));
        return { month: m, maintenance: s("MAINTENANCE"), repairs: s("REPAIRS"), tires: s("TIRES"), total: fromCents(inM.reduce((a, r) => a + toCents(Number(r.amount)), 0)), count: inM.length };
      });
      return { ...base, title: `Annual Maintenance Summary ${year}`, columns: [{ key: "month", label: "Month" }, { key: "maintenance", label: "Maintenance", format: "money", align: "right", sensitivity: "cost" }, { key: "repairs", label: "Repairs", format: "money", align: "right", sensitivity: "cost" }, { key: "tires", label: "Tires", format: "money", align: "right", sensitivity: "cost" }, { key: "total", label: "Total", format: "money", align: "right", sensitivity: "cost" }, { key: "count", label: "Items", format: "number", align: "right" }], rows, summary: [{ label: `Total ${year}`, value: fromCents(rows.reduce((a, r) => a + toCents(r.total as number), 0)), sensitivity: "cost" }, { label: "Expense entries", value: recs.length }] };
    }
    case "repair-history": {
      const [issues, recs] = await Promise.all([db.repairIssue.findMany({ where: { vehicleId: { in: ids }, deletedAt: null }, orderBy: { discoveredAt: "asc" } }), db.maintenanceRecord.findMany({ where: { vehicleId: { in: ids }, deletedAt: null, kind: "REPAIR", status: "COMPLETED", repairIssueId: null }, orderBy: { serviceDate: "asc" } })]);
      const finSet = new Set(finIds);
      const rows = [
        ...issues.map((i) => ({ vehicle: vname.get(i.vehicleId) ?? "", date: iso(i.discoveredAt), odometer: dist(num(i.odometerKm)), item: i.title, component: i.componentKey ?? "", severity: cap(i.severity), status: cap(i.status), resolution: i.resolution ?? "", cost: finSet.has(i.vehicleId) ? num(i.actualCost) ?? num(i.estimatedCost) : null })),
        ...recs.map((r) => ({ vehicle: vname.get(r.vehicleId) ?? "", date: iso(r.serviceDate), odometer: dist(num(r.odometerKm)), item: r.title, component: "", severity: "", status: "Completed", resolution: r.description ?? "", cost: finSet.has(r.vehicleId) ? num(r.totalCost) : null })),
      ].sort((a, b) => String(a.date).localeCompare(String(b.date)));
      return { ...base, title: "Repair History", columns: [...vcol, { key: "date", label: "Date", format: "date" }, { key: "odometer", label: `Odometer (${dLabel})`, format: "number", align: "right" }, { key: "item", label: "Issue / repair", width: 140 }, { key: "component", label: "Component" }, { key: "severity", label: "Severity" }, { key: "status", label: "Status" }, { key: "resolution", label: "Resolution", width: 140 }, { key: "cost", label: `Cost (${cur})`, format: "money", align: "right", sensitivity: "cost" }], rows, summary: [{ label: "Entries", value: rows.length }, { label: "Total repair cost", value: fromCents(rows.reduce((a, r) => a + toCents(r.cost as number | null), 0)), sensitivity: "cost" }] };
    }
    case "expense-statement": {
      const range = dateFilter(p.from, p.to);
      const exps = await db.expense.findMany({ where: { vehicleId: { in: finIds }, deletedAt: null, currency: cur, ...(range ? { date: range } : {}) }, include: { provider: { select: { name: true } } }, orderBy: { date: "asc" } });
      const rows = exps.map((e) => ({ vehicle: vname.get(e.vehicleId) ?? "", date: iso(e.date), category: cap(e.category), vendor: e.vendor ?? e.provider?.name ?? "", description: e.description ?? "", tax: Number(e.tax), amount: Number(e.amount) }));
      const byCat = new Map<string, number>();
      for (const e of exps) byCat.set(e.category, (byCat.get(e.category) ?? 0) + toCents(Number(e.amount)));
      return { ...base, title: "Vehicle Expense Statement", subtitle: p.from || p.to ? `${p.from ?? "start"} to ${p.to ?? today}` : "All time", columns: [...vcol, { key: "date", label: "Date", format: "date" }, { key: "category", label: "Category" }, { key: "vendor", label: "Vendor", sensitivity: "provider" }, { key: "description", label: "Description", width: 150 }, { key: "tax", label: "Tax", format: "money", align: "right", sensitivity: "cost" }, { key: "amount", label: `Amount (${cur})`, format: "money", align: "right", sensitivity: "cost" }], rows, summary: [{ label: "Total spent", value: fromCents(exps.reduce((a, e) => a + toCents(Number(e.amount)), 0)), sensitivity: "cost" }, ...[...byCat.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ label: cap(k), value: fromCents(v), sensitivity: "cost" as const }))] };
    }
    case "costs-by-category": {
      const range = dateFilter(p.from, p.to);
      const exps = await db.expense.findMany({ where: { vehicleId: { in: finIds }, deletedAt: null, currency: cur, ...(range ? { date: range } : {}) } });
      const total = exps.reduce((a, e) => a + toCents(Number(e.amount)), 0);
      const m = new Map<string, { c: number; n: number }>();
      for (const e of exps) {
        const x = m.get(e.category) ?? { c: 0, n: 0 };
        x.c += toCents(Number(e.amount));
        x.n++;
        m.set(e.category, x);
      }
      const rows = [...m.entries()].sort((a, b) => b[1].c - a[1].c).map(([k, v]) => ({ category: cap(k), count: v.n, amount: fromCents(v.c), share: total ? Math.round((v.c / total) * 1000) / 10 : 0 }));
      return { ...base, title: "Costs by Category", columns: [{ key: "category", label: "Category" }, { key: "count", label: "Entries", format: "number", align: "right" }, { key: "amount", label: `Amount (${cur})`, format: "money", align: "right", sensitivity: "cost" }, { key: "share", label: "Share", format: "percent", align: "right", sensitivity: "cost" }], rows, summary: [{ label: "Total", value: fromCents(total), sensitivity: "cost" }] };
    }
    case "cost-per-distance": {
      const rows: Record<string, string | number | null>[] = [];
      for (const s of finScope) {
        const readings = await loadReadings(db, s.vehicle.id);
        const exps = await db.expense.findMany({ where: { vehicleId: s.vehicle.id, deletedAt: null, currency: cur }, select: { date: true, amount: true, category: true } });
        const er = exps.map((e) => ({ date: iso(e.date) as IsoDate, amount: Number(e.amount), category: e.category }));
        const years = [...new Set([...er.map((e) => e.date.slice(0, 4)), ...readings.map((r) => r.date.slice(0, 4))])].sort();
        for (const y of years) {
          const range = { from: `${y}-01-01`, to: `${y}-12-31` };
          const t = costPerDistance(er, readings, range, {});
          const m = costPerDistance(er, readings, range, { include: ["MAINTENANCE"] });
          const r = costPerDistance(er, readings, range, { include: ["REPAIRS"] });
          const perUnit = (x: number | null) => (x === null ? null : Math.round(x * (unit === "MI" ? 1.609344 : 1) * 1000) / 1000);
          rows.push({ vehicle: vehicleName(s.vehicle), year: y, distance: dist(t.distanceKm), totalCost: t.totalCost, total: perUnit(t.costPerKm), maintenance: perUnit(m.costPerKm), repair: perUnit(r.costPerKm), coverage: t.coverage === "none" ? "insufficient mileage data" : t.coverage === "partial" ? `partial (${t.coveredFrom} → ${t.coveredTo})` : "full year" });
        }
      }
      return { ...base, title: `Cost per ${unit === "MI" ? "Mile" : "Kilometre"}`, columns: [...vcol, { key: "year", label: "Year" }, { key: "distance", label: `Distance (${dLabel})`, format: "number", align: "right" }, { key: "totalCost", label: `Total cost (${cur})`, format: "money", align: "right", sensitivity: "cost" }, { key: "total", label: `Total / ${dLabel}`, format: "number", align: "right", sensitivity: "cost" }, { key: "maintenance", label: `Maintenance / ${dLabel}`, format: "number", align: "right", sensitivity: "cost" }, { key: "repair", label: `Repairs / ${dLabel}`, format: "number", align: "right", sensitivity: "cost" }, { key: "coverage", label: "Odometer coverage" }], rows, summary: [], notes: [...base.notes, "Only periods covered by odometer readings are calculated; expenses outside the covered span are excluded to avoid misleading figures."] };
    }
    case "parts-history": {
      const inst = await db.installedPart.findMany({ where: { vehicleId: { in: ids }, part: { deletedAt: null } }, include: { part: true }, orderBy: [{ componentKey: "asc" }, { installedAt: "asc" }] });
      const rows = inst.map((i) => ({ vehicle: vname.get(i.vehicleId) ?? "", component: i.componentKey.replace(/_/g, " "), part: i.part.name, manufacturer: i.part.manufacturer ?? "", partNumber: i.part.partNumber ?? "", origin: cap(i.part.origin), installed: iso(i.installedAt), installedKm: dist(num(i.installedKm)), removed: iso(i.removedAt) ?? "in service", removedKm: dist(num(i.removedKm)), warrantyEnd: iso(i.part.warrantyEnd), price: scope.find((s) => s.vehicle.id === i.vehicleId)?.fin ? num(i.part.purchasePrice) : null }));
      return { ...base, title: "Parts Replacement History", columns: [...vcol, { key: "component", label: "Component" }, { key: "part", label: "Part", width: 120 }, { key: "manufacturer", label: "Manufacturer" }, { key: "partNumber", label: "Part #" }, { key: "origin", label: "OEM/Aftermarket" }, { key: "installed", label: "Installed", format: "date" }, { key: "installedKm", label: `Install ${dLabel}`, format: "number", align: "right" }, { key: "removed", label: "Removed" }, { key: "removedKm", label: `Removed ${dLabel}`, format: "number", align: "right" }, { key: "warrantyEnd", label: "Warranty end", format: "date" }, { key: "price", label: `Price (${cur})`, format: "money", align: "right", sensitivity: "cost" }], rows, summary: [{ label: "Installations", value: rows.length }] };
    }
    case "upcoming-forecast": {
      const horizon = addMonths(today, 12);
      const rows: Record<string, string | number | null>[] = [];
      let estMin = 0;
      let estMax = 0;
      for (const s of scope) {
        const b = await evaluateVehicleSchedules(s.vehicle.id, actor.prefs, s.fin, db, today);
        for (const i of b.items.filter((x) => x.enabled)) {
          const due = i.effectiveDueDate;
          const include = ["OVERDUE", "DUE_NOW", "DUE_SOON", "INSPECTION_REQUIRED"].includes(i.status) || (due !== null && due <= horizon);
          if (!include || i.status === "UNKNOWN_HISTORY") continue;
          if (s.fin) {
            estMin += toCents(i.estCostMin);
            estMax += toCents(i.estCostMax ?? i.estCostMin);
          }
          rows.push({ vehicle: vname.get(s.vehicle.id) ?? "", item: i.name, status: cap(i.status), due: due, dueDistance: i.nextDueKm !== null ? dist(i.nextDueKm) : null, basis: i.estimateBasis.map((b2) => ({ USER_SCHEDULE: "your schedule", MANUFACTURER: "manufacturer data", HISTORICAL_DRIVING: "your driving history", GENERAL_SUGGESTION: "generic suggestion" })[b2]).join(" + "), estCost: s.fin ? (i.estCostMin !== null || i.estCostMax !== null ? `${i.estCostMin ?? "?"}–${i.estCostMax ?? i.estCostMin ?? "?"}` : "not estimated") : null });
        }
      }
      rows.sort((a, b) => String(a.due ?? "9999").localeCompare(String(b.due ?? "9999")));
      return { ...base, title: "Upcoming Maintenance Forecast", subtitle: `Next 12 months (to ${horizon})`, columns: [...vcol, { key: "item", label: "Item", width: 130 }, { key: "status", label: "Status" }, { key: "due", label: "Est. due", format: "date" }, { key: "dueDistance", label: `Due at (${dLabel})`, format: "number", align: "right" }, { key: "basis", label: "Estimate based on", width: 140 }, { key: "estCost", label: `Est. cost (${cur})`, align: "right", sensitivity: "cost" }], rows, summary: [{ label: "Items", value: rows.length }, { label: "Estimated cost (where entered)", value: estMin || estMax ? `${fromCents(estMin)}–${fromCents(estMax)}` : "no estimates entered", sensitivity: "cost" }], notes: [...base.notes, "Dates are estimates from your schedules and recent driving rate; they are not manufacturer requirements unless a schedule is marked as manufacturer data."] };
    }
    case "warranty": {
      const items = await listWarranties(actor, p.vehicleId);
      const rows = items.map((w) => ({ vehicle: w.vehicleName, name: w.name, type: cap(w.type), provider: w.provider ?? "", start: w.startDate, end: w.endDate, endKm: dist(w.endKm), status: cap(w.status.replace("-", " ")), remaining: w.daysRemaining !== null ? (w.daysRemaining >= 0 ? `${w.daysRemaining} days` : `expired ${-w.daysRemaining} days ago`) : "" }));
      return { ...base, title: "Warranty Report", columns: [...vcol.length || !p.vehicleId || p.vehicleId === "all" ? [{ key: "vehicle", label: "Vehicle" }] : [], { key: "name", label: "Warranty", width: 130 }, { key: "type", label: "Type" }, { key: "provider", label: "Provider", sensitivity: "provider" }, { key: "start", label: "Start", format: "date" }, { key: "end", label: "End", format: "date" }, { key: "endKm", label: `Limit (${dLabel})`, format: "number", align: "right" }, { key: "status", label: "Status" }, { key: "remaining", label: "Remaining" }], rows, summary: [{ label: "Warranties", value: rows.length }] };
    }
    case "fuel-consumption": {
      const range = dateFilter(p.from, p.to);
      const fe = await db.fuelEntry.findMany({ where: { vehicleId: { in: ids }, deletedAt: null, ...(range ? { date: range } : {}) }, orderBy: [{ date: "asc" }, { odometerKm: "asc" }] });
      const u = actor.prefs.fuelEconomyUnit;
      const segByVeh = new Map<string, Map<string, number>>();
      for (const s of scope) {
        const rowsV = fe.filter((f) => f.vehicleId === s.vehicle.id);
        const segs = computeFuelStats(rowsV.map((r) => ({ id: r.id, date: iso(r.date) as IsoDate, odometerKm: Number(r.odometerKm), litres: Number(r.quantityL), totalCost: Number(r.totalCost), fullTank: r.fullTank, missedPrevious: r.missedPrevious })));
        segByVeh.set(s.vehicle.id, new Map(segs.segments.filter((x) => x.endId).map((x) => [x.endId as string, x.litresPer100Km])));
      }
      const rows = fe.map((f) => {
        const l100 = segByVeh.get(f.vehicleId)?.get(f.id);
        const fin = scope.find((s) => s.vehicle.id === f.vehicleId)?.fin;
        return { vehicle: vname.get(f.vehicleId) ?? "", date: iso(f.date), odometer: dist(Number(f.odometerKm)), quantity: Math.round(litresToUnit(Number(f.quantityL), actor.prefs.volumeUnit) * 100) / 100, price: fin ? Number(f.totalCost) : null, station: f.station ?? "", fill: f.fullTank ? "Full" : "Partial", economy: l100 !== undefined ? Math.round(litresPer100kmToUnit(l100, u) * 100) / 100 : null };
      });
      const stats = computeFuelStats(fe.map((r) => ({ date: iso(r.date) as IsoDate, odometerKm: Number(r.odometerKm), litres: Number(r.quantityL), totalCost: Number(r.totalCost), fullTank: r.fullTank, missedPrevious: r.missedPrevious })));
      return { ...base, title: "Fuel Consumption", columns: [...vcol, { key: "date", label: "Date", format: "date" }, { key: "odometer", label: `Odometer (${dLabel})`, format: "number", align: "right" }, { key: "quantity", label: `Quantity (${volumeLabel(actor.prefs.volumeUnit)})`, format: "number", align: "right" }, { key: "price", label: `Cost (${cur})`, format: "money", align: "right", sensitivity: "cost" }, { key: "station", label: "Station" }, { key: "fill", label: "Fill" }, { key: "economy", label: fuelEconomyLabel(u), format: "number", align: "right" }], rows, summary: [{ label: "Fill-ups", value: rows.length }, { label: `Average economy (${fuelEconomyLabel(u)})`, value: stats.avgLitresPer100Km !== null ? Math.round(litresPer100kmToUnit(stats.avgLitresPer100Km, u) * 100) / 100 : "not enough full-tank fill-ups" }, { label: "Total fuel cost", value: canCosts ? stats.totalCost : 0, sensitivity: "cost" }], notes: [...base.notes, "Economy is calculated between consecutive full-tank fill-ups."] };
    }
    case "household-expenses": {
      const range = dateFilter(p.from, p.to);
      const exps = await db.expense.findMany({ where: { vehicleId: { in: finIds }, deletedAt: null, currency: cur, ...(range ? { date: range } : {}) } });
      const cats = [...new Set(exps.map((e) => e.category))].sort();
      const rows = finScope.map((s) => {
        const mine = exps.filter((e) => e.vehicleId === s.vehicle.id);
        const row: Record<string, string | number | null> = { vehicle: vehicleName(s.vehicle) };
        for (const c of cats) row[c] = fromCents(mine.filter((e) => e.category === c).reduce((a, e) => a + toCents(Number(e.amount)), 0));
        row.total = fromCents(mine.reduce((a, e) => a + toCents(Number(e.amount)), 0));
        return row;
      });
      return { ...base, vehicles: finScope.map((s) => vehicleSummary(s, actor)), title: "Household Vehicle Expenses", subtitle: p.from || p.to ? `${p.from ?? "start"} to ${p.to ?? today}` : "All time", columns: [{ key: "vehicle", label: "Vehicle" }, ...cats.map((c) => ({ key: c, label: cap(c), format: "money" as const, align: "right" as const, sensitivity: "cost" as const })), { key: "total", label: "Total", format: "money", align: "right", sensitivity: "cost" }], rows, summary: [{ label: "Household total", value: fromCents(rows.reduce((a, r) => a + toCents(r.total as number), 0)), sensitivity: "cost" }] };
    }
  }
}

/** Applies the user's sharing choices: strips costs / provider names / VIN before the report leaves the app. */
export function applyPrivacy(r: ReportData): ReportData {
  const strip = (c: Column) => (r.privacy.hideCosts && c.sensitivity === "cost") || (r.privacy.hideProviders && c.sensitivity === "provider");
  const columns = r.columns.filter((c) => !strip(c));
  const keys = new Set(columns.map((c) => c.key));
  return {
    ...r,
    columns,
    rows: r.rows.map((row) => Object.fromEntries(Object.entries(row).filter(([k]) => keys.has(k)))),
    summary: r.summary.filter((s) => !(r.privacy.hideCosts && s.sensitivity === "cost")),
    vehicles: r.vehicles.map((v) => ({ ...v, vin: r.privacy.hideVin ? null : v.vin, registration: r.privacy.hideVin ? null : v.registration })),
  };
}

export async function generateReport(actor: Actor, p: ReportParams) {
  return applyPrivacy(await buildReport(actor, p));
}
export { diffDays, requireVehicle, accessibleVehicles };
