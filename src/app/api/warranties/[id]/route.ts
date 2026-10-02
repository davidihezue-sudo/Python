import { route } from "@/lib/http";
import { warrantySchema } from "@/lib/validation";
import { deleteWarranty, updateWarranty } from "@/server/services/parts";

export const PATCH = route({ body: warrantySchema.partial() }, async ({ actor, params, body }) => updateWarranty(actor, params.id, body));
export const DELETE = route({}, async ({ actor, params }) => deleteWarranty(actor, params.id));
