import { route } from "@/lib/http";
import { applyLibrarySchema } from "@/lib/validation";
import { applyLibraryForActor } from "@/server/services/schedules";

export const POST = route({ body: applyLibrarySchema }, async ({ actor, params, body }) => applyLibraryForActor(actor, params.id, body.keys));
