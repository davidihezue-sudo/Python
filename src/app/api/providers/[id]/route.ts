import { route } from "@/lib/http";
import { providerSchema } from "@/lib/validation";
import { deleteProvider, updateProvider } from "@/server/services/inspections";

export const PATCH = route({ body: providerSchema.partial() }, async ({ actor, params, body }) => updateProvider(actor, params.id, body));
export const DELETE = route({}, async ({ actor, params }) => deleteProvider(actor, params.id));
