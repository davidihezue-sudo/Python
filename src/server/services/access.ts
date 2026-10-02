import type { Vehicle } from "@prisma/client";
import { db, type Db } from "@/lib/db";
import { AppError, forbidden, notFound } from "@/lib/errors";
import { can, type AccessInfo, type Capability } from "@/lib/permissions";
import type { Actor } from "../context";

/**
 * Central authorization. Every service that touches vehicle-scoped data MUST resolve the vehicle through
 * requireVehicle()/accessibleVehicles() so that IDs supplied by a client can never reach another household's data.
 * Missing access is reported as NOT_FOUND (not FORBIDDEN) so resource existence is not leaked.
 */
export async function getAccess(actor: Pick<Actor, "id">, vehicle: Pick<Vehicle, "id" | "householdId">, client: Db = db): Promise<AccessInfo | null> {
  const [member, va] = await Promise.all([
    client.householdMember.findUnique({ where: { householdId_userId: { householdId: vehicle.householdId, userId: actor.id } } }),
    client.vehicleAccess.findUnique({ where: { vehicleId_userId: { vehicleId: vehicle.id, userId: actor.id } } }),
  ]);
  if (!member) return null;
  return { householdRole: member.role, vehicleLevel: va?.level ?? null, canViewFinancials: va?.canViewFinancials ?? false };
}

export async function requireVehicle(actor: Pick<Actor, "id">, vehicleId: string, cap: Capability = "view", client: Db = db) {
  if (typeof vehicleId !== "string" || vehicleId.length < 5 || vehicleId.length > 40) throw notFound("Vehicle");
  const vehicle = await client.vehicle.findFirst({ where: { id: vehicleId, deletedAt: null } });
  if (!vehicle) throw notFound("Vehicle");
  const access = await getAccess(actor, vehicle, client);
  if (!access || !can(access, "view")) throw notFound("Vehicle");
  if (!can(access, cap)) throw forbidden(`You don't have permission to ${describeCap(cap)} this vehicle`);
  return { vehicle, access, fin: can(access, "viewFinancials") };
}

function describeCap(c: Capability) {
  return { view: "view", write: "add or change records for", viewFinancials: "view financial details of", editVehicle: "edit", manageAccess: "manage access to", delete: "delete" }[c];
}

export interface VehicleScope {
  vehicle: Vehicle;
  access: AccessInfo;
  fin: boolean;
}

/** All non-deleted vehicles the actor may access with the capability. */
export async function accessibleVehicles(actor: Pick<Actor, "id">, cap: Capability = "view", opts: { householdId?: string; vehicleId?: string } = {}, client: Db = db): Promise<VehicleScope[]> {
  const memberships = await client.householdMember.findMany({ where: { userId: actor.id, ...(opts.householdId ? { householdId: opts.householdId } : {}) } });
  if (!memberships.length) return [];
  const roleByHh = new Map(memberships.map((m) => [m.householdId, m.role]));
  const vehicles = await client.vehicle.findMany({
    where: { deletedAt: null, householdId: { in: [...roleByHh.keys()] }, ...(opts.vehicleId ? { id: opts.vehicleId } : {}) },
    orderBy: [{ createdAt: "asc" }],
  });
  const grants = await client.vehicleAccess.findMany({ where: { userId: actor.id, vehicleId: { in: vehicles.map((v) => v.id) } } });
  const gById = new Map(grants.map((g) => [g.vehicleId, g]));
  const out: VehicleScope[] = [];
  for (const v of vehicles) {
    const g = gById.get(v.id);
    const access: AccessInfo = { householdRole: roleByHh.get(v.householdId) ?? null, vehicleLevel: g?.level ?? null, canViewFinancials: g?.canViewFinancials ?? false };
    if (can(access, cap)) out.push({ vehicle: v, access, fin: can(access, "viewFinancials") });
  }
  return out;
}

/** Resolve either a single vehicle (validated) or all accessible vehicles when vehicleId is omitted/"all". */
export async function scopeVehicles(actor: Pick<Actor, "id">, vehicleId: string | null | undefined, cap: Capability = "view", client: Db = db): Promise<VehicleScope[]> {
  if (vehicleId && vehicleId !== "all") {
    const r = await requireVehicle(actor, vehicleId, cap, client);
    return [{ vehicle: r.vehicle, access: r.access, fin: r.fin }];
  }
  return accessibleVehicles(actor, cap, {}, client);
}

export async function requireHouseholdMember(actor: Pick<Actor, "id">, householdId: string, client: Db = db) {
  const m = await client.householdMember.findUnique({ where: { householdId_userId: { householdId, userId: actor.id } }, include: { household: true } });
  if (!m || m.household.deletedAt) throw notFound("Household");
  return m;
}

export async function requireHouseholdAdmin(actor: Pick<Actor, "id">, householdId: string, client: Db = db) {
  const m = await requireHouseholdMember(actor, householdId, client);
  if (m.role !== "ADMIN") throw forbidden("Only household administrators can do that");
  return m;
}

export function requirePlatformAdmin(actor: Actor) {
  if (actor.platformRole !== "PLATFORM_ADMIN") throw new AppError("FORBIDDEN", "Platform administrator access required");
}

export async function primaryHouseholdId(actor: Pick<Actor, "id">, client: Db = db): Promise<string> {
  const m = await client.householdMember.findFirst({ where: { userId: actor.id, role: "ADMIN", household: { deletedAt: null } }, orderBy: { createdAt: "asc" } });
  if (!m) throw forbidden("You need to administer a household to add vehicles");
  return m.householdId;
}
