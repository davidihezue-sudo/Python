import { route } from "@/lib/http";
import { z } from "zod";
import { isoDate, km } from "@/lib/validation";
import { importReadings } from "@/server/services/odometer";

export const POST = route({ body: z.object({ rows: z.array(z.object({ date: isoDate, valueKm: km, note: z.string().max(300).nullish() })).min(1).max(1000) }), maxBody: 400_000, rate: { limit: 10, windowSec: 600 } }, async ({ actor, params, body }) => importReadings(actor, params.id, body.rows));
