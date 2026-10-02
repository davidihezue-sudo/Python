import { route } from "@/lib/http";
import { householdSchema } from "@/lib/validation";
import { updateHousehold } from "@/server/services/households";

export const PATCH = route({ body: householdSchema.partial() }, async ({ actor, body, params }) => updateHousehold(actor, params.id, body));
