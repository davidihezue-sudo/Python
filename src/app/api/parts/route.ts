import { route, pageQuery } from "@/lib/http";
import { z } from "zod";
import { partSchema } from "@/lib/validation";
import { createPart, listParts } from "@/server/services/parts";

export const GET = route({ query: z.object({ vehicleId: z.string().optional(), status: z.string().optional(), component: z.string().optional(), q: z.string().max(100).optional(), ...pageQuery }) }, async ({ actor, query }) => listParts(actor, query));
export const POST = route({ body: partSchema, status: 201 }, async ({ actor, body }) => createPart(actor, body));
