import { route } from "@/lib/http";
import { partUpdateSchema } from "@/lib/validation";
import { deletePart, getPart, updatePart } from "@/server/services/parts";

export const GET = route({}, async ({ actor, params }) => getPart(actor, params.id));
export const PATCH = route({ body: partUpdateSchema }, async ({ actor, params, body }) => updatePart(actor, params.id, body));
export const DELETE = route({}, async ({ actor, params }) => deletePart(actor, params.id));
