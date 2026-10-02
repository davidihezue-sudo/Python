import { route } from "@/lib/http";
import { db } from "@/lib/db";
import { requireVehicle } from "@/server/services/access";
import { decodeVin } from "@/server/integrations/vin";
import { AppError } from "@/lib/errors";

// Returns decoded SUGGESTIONS compared with what is stored. Nothing is applied until the user chooses fields (apply-decoded).
export const POST = route({ rate: { limit: 20, windowSec: 600 } }, async ({ actor, params }) => {
  const { vehicle } = await requireVehicle(actor, params.id, "editVehicle");
  if (!vehicle.vin) throw new AppError("BAD_REQUEST", "Add a VIN to this vehicle first");
  const result = await decodeVin(vehicle.vin);
  const spec = await db.vehicleSpecification.findUnique({ where: { vehicleId: vehicle.id } });
  if (result.available) {
    await db.vehicleSpecification.upsert({ where: { vehicleId: vehicle.id }, create: { vehicleId: vehicle.id, decoder: result.provider, decodedAt: new Date(), decoded: result.spec as any }, update: { decoder: result.provider, decodedAt: new Date(), decoded: result.spec as any } });
  }
  const confirmed = new Set(spec?.confirmedFields ?? []);
  const diff = Object.entries(result.spec).map(([field, value]) => ({ field, decoded: value, current: (vehicle as any)[field] ?? null, confirmedByUser: confirmed.has(field), same: String((vehicle as any)[field] ?? "") === String(value) }));
  return { ...result, diff };
});
