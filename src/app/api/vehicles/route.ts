import { route } from "@/lib/http";
import { z } from "zod";
import { vehicleCreateSchema } from "@/lib/validation";
import { createVehicle, listVehicles } from "@/server/services/vehicles";

export const GET = route({ query: z.object({ householdId: z.string().optional() }) }, async ({ actor, query }) => listVehicles(actor, query));
export const POST = route({ body: vehicleCreateSchema, status: 201, rate: { limit: 60, windowSec: 60 } }, async ({ actor, body }) => createVehicle(actor, body));
