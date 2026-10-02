import { route } from "@/lib/http";
import { vehicleUpdateSchema } from "@/lib/validation";
import { deleteVehicle, getVehicle, updateVehicle } from "@/server/services/vehicles";

export const GET = route({}, async ({ actor, params }) => getVehicle(actor, params.id));
export const PATCH = route({ body: vehicleUpdateSchema }, async ({ actor, params, body }) => updateVehicle(actor, params.id, body));
export const DELETE = route({}, async ({ actor, params }) => deleteVehicle(actor, params.id));
