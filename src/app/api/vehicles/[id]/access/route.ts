import { route } from "@/lib/http";
import { vehicleAccessSchema } from "@/lib/validation";
import { setVehicleAccess } from "@/server/services/vehicles";

export const POST = route({ body: vehicleAccessSchema }, async ({ actor, params, body }) => setVehicleAccess(actor, params.id, body));
