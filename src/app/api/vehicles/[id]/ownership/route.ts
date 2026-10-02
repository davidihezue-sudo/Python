import { route } from "@/lib/http";
import { ownershipSchema } from "@/lib/validation";
import { addOwnership } from "@/server/services/vehicles";

export const POST = route({ body: ownershipSchema, status: 201 }, async ({ actor, params, body }) => addOwnership(actor, params.id, body));
