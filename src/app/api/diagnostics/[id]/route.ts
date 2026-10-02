import { route } from "@/lib/http";
import { dtcSchema } from "@/lib/validation";
import { deleteCode, updateCode } from "@/server/services/repairs";

export const PATCH = route({ body: dtcSchema.partial() }, async ({ actor, params, body }) => updateCode(actor, params.id, body));
export const DELETE = route({}, async ({ actor, params }) => deleteCode(actor, params.id));
