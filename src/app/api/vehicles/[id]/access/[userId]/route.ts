import { route } from "@/lib/http";
import { removeVehicleAccess } from "@/server/services/vehicles";

export const DELETE = route({}, async ({ actor, params }) => removeVehicleAccess(actor, params.id, params.userId));
