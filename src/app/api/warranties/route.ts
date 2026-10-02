import { route } from "@/lib/http";
import { z } from "zod";
import { warrantySchema } from "@/lib/validation";
import { createWarranty, listWarranties } from "@/server/services/parts";

export const GET = route({ query: z.object({ vehicleId: z.string().optional() }) }, async ({ actor, query }) => listWarranties(actor, query.vehicleId));
export const POST = route({ body: warrantySchema, status: 201 }, async ({ actor, body }) => createWarranty(actor, body));
