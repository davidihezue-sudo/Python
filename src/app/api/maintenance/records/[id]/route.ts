import { route } from "@/lib/http";
import { recordUpdateSchema } from "@/lib/validation";
import { z } from "zod";
import { deleteRecord, getRecord, updateRecord } from "@/server/services/records";

export const GET = route({}, async ({ actor, params }) => getRecord(actor, params.id));
export const PATCH = route({ body: recordUpdateSchema.and(z.object({ confirmOdometerCorrection: z.boolean().optional() })), maxBody: 400_000 }, async ({ actor, params, body }) => updateRecord(actor, params.id, body as any));
export const DELETE = route({}, async ({ actor, params }) => deleteRecord(actor, params.id));
