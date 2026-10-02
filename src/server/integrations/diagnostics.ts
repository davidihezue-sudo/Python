// Diagnostics provider abstraction. The core application never depends on any of these; they only add data.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { isoToDate } from "@/lib/dates";
import { lookupDtc } from "@/lib/dtc";
import type { Actor } from "../context";
import { requireVehicle } from "../services/access";
import { audit } from "../services/audit";
import { recordReading } from "../services/odometer";

export interface DiagnosticProvider {
  id: string;
  label: string;
  kind: "manual" | "obd_adapter" | "oem_api" | "third_party";
  status(): { available: boolean; reason: string };
  capabilities: string[];
}

export const PROVIDERS: DiagnosticProvider[] = [
  { id: "manual", label: "Manual entry", kind: "manual", status: () => ({ available: true, reason: "Always available - enter trouble codes and mileage by hand." }), capabilities: ["dtc", "odometer"] },
  {
    id: "obd-gateway",
    label: "OBD-II gateway (Bluetooth / Wi-Fi adapter bridge)",
    kind: "obd_adapter",
    status: () => ({ available: true, reason: "Create an ingest token below, then have your adapter bridge (phone app, ESP32, Raspberry Pi…) POST readings to /api/integrations/obd/ingest. Family Finance Hub does not talk to the adapter directly." }),
    capabilities: ["dtc", "odometer", "live-data"],
  },
  {
    id: "bmw-connected-drive",
    label: "BMW ConnectedDrive / BMW CarData",
    kind: "oem_api",
    status: () => ({ available: false, reason: "Not implemented. BMW offers vehicle-data access only through its own official programmes (availability depends on the vehicle, market and account). Family Finance Hub will never ask for your BMW credentials or use unofficial/undocumented APIs. The provider interface is ready for an official integration." }),
    capabilities: [],
  },
];

const ingestSchema = z.object({
  dtcs: z.array(z.object({ code: z.string().min(2).max(12), detectedAt: z.string().optional(), status: z.enum(["ACTIVE", "CLEARED"]).default("ACTIVE"), description: z.string().max(300).optional() })).max(50).default([]),
  odometerKm: z.number().min(0).max(5_000_000).optional(),
  readings: z
    .object({ rpm: z.number().optional(), coolantTempC: z.number().optional(), speedKph: z.number().optional(), engineLoadPct: z.number().optional(), intakeTempC: z.number().optional(), batteryVolts: z.number().optional() })
    .partial()
    .optional(),
  deviceName: z.string().max(80).optional(),
});

const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

export async function createObdGateway(actor: Actor, vehicleId: string, label?: string) {
  const { vehicle } = await requireVehicle(actor, vehicleId, "editVehicle");
  const token = `avobd_${randomBytes(24).toString("base64url")}`;
  const integ = await db.integration.create({ data: { householdId: vehicle.householdId, vehicleId, provider: "OBD_GATEWAY", label: label ?? "OBD-II gateway", status: "ACTIVE", config: { tokenHash: hashToken(token) } } });
  await audit(null, actor, { entity: "Integration", entityId: integ.id, action: "create", vehicleId, householdId: vehicle.householdId, after: { provider: "OBD_GATEWAY" } });
  // The token is shown exactly once and only its hash is stored.
  return { id: integ.id, token };
}

export async function listIntegrations(actor: Actor, vehicleId: string) {
  await requireVehicle(actor, vehicleId, "view");
  const rows = await db.integration.findMany({ where: { vehicleId }, orderBy: { createdAt: "desc" } });
  return rows.map((i) => ({ id: i.id, provider: i.provider, label: i.label, status: i.status, lastSyncAt: i.lastSyncAt?.toISOString() ?? null, lastError: i.lastError, latest: (i.config as any)?.latest ?? null }));
}

export async function revokeIntegration(actor: Actor, id: string) {
  const i = await db.integration.findUnique({ where: { id } });
  if (!i?.vehicleId) throw new AppError("NOT_FOUND", "Integration not found");
  const { vehicle } = await requireVehicle(actor, i.vehicleId, "editVehicle");
  await db.integration.delete({ where: { id } });
  await audit(null, actor, { entity: "Integration", entityId: id, action: "delete", vehicleId: vehicle.id, householdId: vehicle.householdId });
  return { ok: true };
}

/** Authenticated by bearer token (no session). Writes DTCs / odometer through the same validated paths as manual entry. */
export async function ingestObd(token: string, payload: unknown) {
  if (!token.startsWith("avobd_")) throw new AppError("UNAUTHENTICATED", "Invalid integration token");
  const h = hashToken(token);
  const candidates = await db.integration.findMany({ where: { provider: "OBD_GATEWAY", status: "ACTIVE" } });
  const integ = candidates.find((c) => {
    const stored = String((c.config as any)?.tokenHash ?? "");
    return stored.length === h.length && timingSafeEqual(Buffer.from(stored), Buffer.from(h));
  });
  if (!integ || !integ.vehicleId) throw new AppError("UNAUTHENTICATED", "Invalid integration token");
  const data = ingestSchema.parse(payload);
  const vehicle = await db.vehicle.findFirst({ where: { id: integ.vehicleId, deletedAt: null } });
  if (!vehicle) throw new AppError("NOT_FOUND", "Vehicle not found");
  const today = new Date().toISOString().slice(0, 10);
  let dtcsCreated = 0;
  let odometer: string | null = null;
  await db.$transaction(async (tx) => {
    for (const d of data.dtcs) {
      const code = d.code.toUpperCase().replace(/\s+/g, "");
      const open = await tx.diagnosticCode.findFirst({ where: { vehicleId: vehicle.id, code, status: "ACTIVE", deletedAt: null } });
      if (d.status === "CLEARED") {
        if (open) await tx.diagnosticCode.update({ where: { id: open.id }, data: { status: "CLEARED", resolvedAt: isoToDate(today) } });
        continue;
      }
      if (open) continue;
      await tx.diagnosticCode.create({ data: { vehicleId: vehicle.id, code, description: d.description ?? lookupDtc(code).description ?? null, detectedAt: isoToDate((d.detectedAt ?? today).slice(0, 10)), odometerKm: data.odometerKm ?? vehicle.currentOdometerKm, source: "OBD_ADAPTER", severity: "MODERATE" } });
      dtcsCreated++;
    }
    if (data.odometerKm !== undefined) {
      try {
        await recordReading(tx, null, vehicle, { date: today, valueKm: data.odometerKm, source: "INTEGRATION", note: data.deviceName ?? "OBD gateway" });
        odometer = "recorded";
      } catch (e) {
        odometer = e instanceof AppError ? `rejected: ${e.message}` : "error";
      }
    }
    await tx.integration.update({ where: { id: integ.id }, data: { lastSyncAt: new Date(), lastError: null, config: { ...(integ.config as object), latest: { ...((integ.config as any)?.latest ?? {}), at: new Date().toISOString(), ...(data.readings ?? {}), ...(data.odometerKm !== undefined ? { odometerKm: data.odometerKm } : {}) } } } });
  });
  return { dtcsCreated, odometer };
}
