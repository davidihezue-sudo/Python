import { route } from "@/lib/http";
import { fuelUpdateSchema } from "@/lib/validation";
import { deleteFuel, updateFuel } from "@/server/services/fuel";

export const PATCH = route({ body: fuelUpdateSchema }, async ({ actor, params, body }) => updateFuel(actor, params.id, body));
export const DELETE = route({}, async ({ actor, params }) => deleteFuel(actor, params.id));
