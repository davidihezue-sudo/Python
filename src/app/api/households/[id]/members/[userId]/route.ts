import { route } from "@/lib/http";
import { memberUpdateSchema } from "@/lib/validation";
import { removeMember, updateMember } from "@/server/services/households";

export const PATCH = route({ body: memberUpdateSchema }, async ({ actor, body, params }) => updateMember(actor, params.id, params.userId, body));
export const DELETE = route({}, async ({ actor, params }) => removeMember(actor, params.id, params.userId));
