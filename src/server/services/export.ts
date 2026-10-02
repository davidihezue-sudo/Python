import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import type { Actor } from "../context";
import { num, iso, ts } from "../serialize";
import { accessibleVehicles } from "./access";

/** Machine-readable export of everything the user can access (financial data only where permitted). */
export async function exportAccountData(actor: Actor) {
  const user = await db.user.findUniqueOrThrow({ where: { id: actor.id }, include: { preference: true } });
  const memberships = await db.householdMember.findMany({ where: { userId: actor.id }, include: { household: true } });
  const scope = await accessibleVehicles(actor, "view");
  const vehicles = [];
  for (const s of scope) {
    const id = s.vehicle.id;
    const fin = can(s.access, "viewFinancials");
    const [odometer, assignments, records, issues, codes, parts, installed, fuel, expenses, docs, warranties, inspections, reminders] = await Promise.all([
      db.odometerEntry.findMany({ where: { vehicleId: id, deletedAt: null }, orderBy: { date: "asc" } }),
      db.maintenanceScheduleAssignment.findMany({ where: { vehicleId: id, deletedAt: null }, include: { category: true } }),
      db.maintenanceRecord.findMany({ where: { vehicleId: id, deletedAt: null }, include: { items: true, provider: true }, orderBy: { serviceDate: "asc" } }),
      db.repairIssue.findMany({ where: { vehicleId: id, deletedAt: null } }),
      db.diagnosticCode.findMany({ where: { vehicleId: id, deletedAt: null } }),
      db.part.findMany({ where: { vehicleId: id, deletedAt: null } }),
      db.installedPart.findMany({ where: { vehicleId: id } }),
      db.fuelEntry.findMany({ where: { vehicleId: id, deletedAt: null } }),
      fin ? db.expense.findMany({ where: { vehicleId: id, deletedAt: null } }) : Promise.resolve([]),
      db.document.findMany({ where: { vehicleId: id, deletedAt: null } }),
      db.warranty.findMany({ where: { vehicleId: id, deletedAt: null } }),
      db.inspection.findMany({ where: { vehicleId: id, deletedAt: null } }),
      db.reminder.findMany({ where: { vehicleId: id } }),
    ]);
    const m = (n: unknown) => (fin ? num(n as any) : null);
    vehicles.push({
      vehicle: { ...s.vehicle, purchasePrice: m(s.vehicle.purchasePrice), currentOdometerKm: num(s.vehicle.currentOdometerKm), purchaseOdometerKm: num(s.vehicle.purchaseOdometerKm), engineDisplacementL: num(s.vehicle.engineDisplacementL) },
      odometer: odometer.map((o) => ({ date: iso(o.date), valueKm: Number(o.valueKm), source: o.source, note: o.note })),
      schedules: assignments.map((a) => ({ name: a.name, category: a.category.name, trigger: a.triggerType, intervalKm: num(a.intervalKm), intervalMonths: a.intervalMonths, source: a.sourceType, lastCompletedAt: iso(a.lastCompletedAt), lastCompletedKm: num(a.lastCompletedKm), enabled: a.enabled })),
      maintenanceAndRepairRecords: records.map((r) => ({ id: r.id, kind: r.kind, status: r.status, title: r.title, date: iso(r.serviceDate), odometerKm: num(r.odometerKm), workPerformedBy: r.workPerformedBy, provider: r.provider?.name ?? null, labor: m(r.laborCost), parts: m(r.partsCost), tax: m(r.tax), discount: m(r.discount), total: m(r.totalCost), currency: r.currency, notes: r.notes, items: r.items.map((i) => ({ name: i.name, partName: i.partName, partNumber: i.partNumber, quantity: Number(i.quantity), unitCost: m(i.unitCost), laborCost: m(i.laborCost), completed: i.completed })) })),
      issues: issues.map((i) => ({ ...i, estimatedCost: m(i.estimatedCost), actualCost: m(i.actualCost), odometerKm: num(i.odometerKm) })),
      diagnosticCodes: codes.map((c) => ({ ...c, odometerKm: num(c.odometerKm) })),
      parts: parts.map((p) => ({ ...p, purchasePrice: m(p.purchasePrice), expectedLifeKm: num(p.expectedLifeKm) })),
      installations: installed.map((i) => ({ ...i, installedKm: num(i.installedKm), removedKm: num(i.removedKm), installLaborCost: m(i.installLaborCost) })),
      fuel: fuel.map((f) => ({ date: iso(f.date), odometerKm: Number(f.odometerKm), litres: Number(f.quantityL), totalCost: m(f.totalCost), station: f.station, fullTank: f.fullTank })),
      expenses: expenses.map((e) => ({ date: iso(e.date), amount: Number(e.amount), tax: Number(e.tax), currency: e.currency, category: e.category, vendor: e.vendor, description: e.description })),
      documents: docs.map((d) => ({ id: d.id, title: d.title, category: d.category, fileName: d.fileName, mimeType: d.mimeType, sizeBytes: d.sizeBytes, uploadedAt: ts(d.createdAt), downloadUrl: `/api/documents/${d.id}/file?download=1` })),
      warranties: warranties.map((w) => ({ ...w, endKm: num(w.endKm) })),
      inspections,
      reminders,
    });
  }
  return {
    exportedAt: new Date().toISOString(),
    format: "autovault-export-v1",
    notes: "Odometer values are in kilometres. Documents are listed with download URLs (sign in to download the files).",
    account: { id: user.id, email: user.email, name: user.name, createdAt: ts(user.createdAt), preferences: user.preference },
    households: memberships.map((m) => ({ id: m.householdId, name: m.household.name, role: m.role })),
    vehicles,
  };
}
