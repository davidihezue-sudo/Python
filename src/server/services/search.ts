import { db } from "@/lib/db";
import type { Actor } from "../context";
import { iso } from "../serialize";
import { accessibleVehicles } from "./access";

export interface SearchHit {
  type: "vehicle" | "service" | "repair" | "part" | "document" | "receipt" | "expense";
  id: string;
  title: string;
  subtitle: string;
  href: string;
}

const RECEIPT_CATS = ["MAINTENANCE_INVOICE", "REPAIR_RECEIPT", "PARTS_RECEIPT"] as const;

/** Global search across everything the actor may see. Results respect per-vehicle financial permissions. */
export async function globalSearch(actor: Actor, raw: string, limit = 6) {
  const q = raw.trim();
  if (q.length < 2) return { query: q, groups: [] as { label: string; items: SearchHit[] }[] };
  const scope = await accessibleVehicles(actor, "view");
  const ids = scope.map((s) => s.vehicle.id);
  const finIds = scope.filter((s) => s.fin).map((s) => s.vehicle.id);
  const noFin = scope.filter((s) => !s.fin).map((s) => s.vehicle.id);
  const ci = { contains: q, mode: "insensitive" as const };
  const [vehicles, records, issues, parts, docs, expenses] = await Promise.all([
    db.vehicle.findMany({ where: { id: { in: ids }, OR: [{ nickname: ci }, { make: ci }, { model: ci }, { vin: ci }, { registrationNumber: ci }, { trim: ci }] }, take: limit }),
    db.maintenanceRecord.findMany({ where: { vehicleId: { in: ids }, deletedAt: null, OR: [{ title: ci }, { description: ci }, { notes: ci }, { mechanicName: ci }, { items: { some: { OR: [{ name: ci }, { partName: ci }, { partNumber: ci }] } } }] }, include: { vehicle: { select: { nickname: true } } }, orderBy: { serviceDate: "desc" }, take: limit }),
    db.repairIssue.findMany({ where: { vehicleId: { in: ids }, deletedAt: null, OR: [{ title: ci }, { description: ci }, { symptoms: ci }, { componentKey: ci }, { codes: { some: { code: ci } } }] }, include: { vehicle: { select: { nickname: true } } }, orderBy: { discoveredAt: "desc" }, take: limit }),
    db.part.findMany({ where: { vehicleId: { in: ids }, deletedAt: null, OR: [{ name: ci }, { manufacturer: ci }, { partNumber: ci }, { supplier: ci }] }, include: { vehicle: { select: { nickname: true } } }, take: limit }),
    db.document.findMany({ where: { vehicleId: { in: ids }, deletedAt: null, OR: [{ title: ci }, { fileName: ci }, { description: ci }], ...(noFin.length ? { NOT: { vehicleId: { in: noFin }, category: { in: ["MAINTENANCE_INVOICE", "REPAIR_RECEIPT", "PARTS_RECEIPT", "PURCHASE", "INSURANCE"] } } } : {}) }, include: { vehicle: { select: { nickname: true } } }, orderBy: { createdAt: "desc" }, take: limit * 2 }),
    finIds.length ? db.expense.findMany({ where: { vehicleId: { in: finIds }, deletedAt: null, OR: [{ vendor: ci }, { description: ci }] }, include: { vehicle: { select: { nickname: true } } }, orderBy: { date: "desc" }, take: limit }) : Promise.resolve([]),
  ]);
  const groups: { label: string; items: SearchHit[] }[] = [
    { label: "Vehicles", items: vehicles.map((v) => ({ type: "vehicle" as const, id: v.id, title: v.nickname, subtitle: `${v.year} ${v.make} ${v.model}${v.vin ? " · " + v.vin : ""}`, href: `/vehicles/${v.id}` })) },
    { label: "Service records", items: records.map((r) => ({ type: "service" as const, id: r.id, title: r.title, subtitle: `${r.vehicle.nickname} · ${iso(r.serviceDate)}`, href: `/service-history?record=${r.id}` })) },
    { label: "Repairs & issues", items: issues.map((r) => ({ type: "repair" as const, id: r.id, title: r.title, subtitle: `${r.vehicle.nickname} · ${r.status.toLowerCase().replace("_", " ")}`, href: `/repairs?issue=${r.id}` })) },
    { label: "Parts", items: parts.map((r) => ({ type: "part" as const, id: r.id, title: r.name, subtitle: `${r.vehicle.nickname}${r.partNumber ? " · " + r.partNumber : ""}`, href: `/parts?part=${r.id}` })) },
    { label: "Receipts", items: docs.filter((d) => (RECEIPT_CATS as readonly string[]).includes(d.category)).slice(0, limit).map((d) => ({ type: "receipt" as const, id: d.id, title: d.title, subtitle: `${d.vehicle?.nickname ?? ""} · ${d.category.toLowerCase().replace(/_/g, " ")}`, href: `/documents?doc=${d.id}` })) },
    { label: "Documents", items: docs.filter((d) => !(RECEIPT_CATS as readonly string[]).includes(d.category)).slice(0, limit).map((d) => ({ type: "document" as const, id: d.id, title: d.title, subtitle: `${d.vehicle?.nickname ?? ""} · ${d.category.toLowerCase().replace(/_/g, " ")}`, href: `/documents?doc=${d.id}` })) },
    { label: "Expenses", items: expenses.map((e) => ({ type: "expense" as const, id: e.id, title: e.vendor ?? e.description ?? "Expense", subtitle: `${e.vehicle.nickname} · ${iso(e.date)} · ${e.category.toLowerCase().replace(/_/g, " ")}`, href: `/expenses?expense=${e.id}` })) },
  ].filter((g) => g.items.length);
  return { query: q, groups };
}
