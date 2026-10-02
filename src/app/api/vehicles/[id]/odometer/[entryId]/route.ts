import { route } from "@/lib/http";
import { odometerUpdateSchema } from "@/lib/validation";
import { deleteReading, updateReading } from "@/server/services/odometer";

export const PATCH = route({ body: odometerUpdateSchema }, async ({ actor, params, body }) => updateReading(actor, params.entryId, body));
export const DELETE = route({}, async ({ actor, params }) => deleteReading(actor, params.entryId));
