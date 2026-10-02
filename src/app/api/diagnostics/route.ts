import { route } from "@/lib/http";
import { z } from "zod";
import { dtcSchema, id } from "@/lib/validation";
import { createCode, listCodes } from "@/server/services/repairs";

export const GET = route({ query: z.object({ vehicleId: z.string().optional() }) }, async ({ actor, query }) => listCodes(actor, query.vehicleId));
export const POST = route({ body: dtcSchema.and(z.object({ vehicleId: id })), status: 201 }, async ({ actor, body }) => createCode(actor, body as any));
