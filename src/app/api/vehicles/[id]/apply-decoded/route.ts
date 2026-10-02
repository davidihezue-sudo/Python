import { route } from "@/lib/http";
import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { requireVehicle } from "@/server/services/access";
import { updateVehicle } from "@/server/services/vehicles";

const ALLOWED = ["make", "model", "year", "trim", "engineDisplacementL", "engineCode", "engineType", "fuelType", "transmission", "drivetrain", "bodyType"] as const;

// Applies ONLY the fields the user explicitly selected, and only values that came from the stored decode result.
export const POST = route({ body: z.object({ fields: z.array(z.enum(ALLOWED)).min(1) }) }, async ({ actor, params, body }) => {
  await requireVehicle(actor, params.id, "editVehicle");
  const spec = await db.vehicleSpecification.findUnique({ where: { vehicleId: params.id } });
  const decoded = (spec?.decoded ?? null) as Record<string, unknown> | null;
  if (!decoded) throw new AppError("BAD_REQUEST", "Run a VIN decode first");
  const patch: Record<string, unknown> = {};
  for (const f of body.fields) if (decoded[f] !== undefined) patch[f] = decoded[f];
  await updateVehicle(actor, params.id, patch as any);
  return { applied: Object.keys(patch) };
});
