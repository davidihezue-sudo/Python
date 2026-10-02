import { route } from "@/lib/http";
import { z } from "zod";
import { inspectionSchema } from "@/lib/validation";
import { createInspection, listInspections } from "@/server/services/inspections";

export const GET = route({ query: z.object({ vehicleId: z.string().optional() }) }, async ({ actor, query }) => listInspections(actor, query.vehicleId));
export const POST = route({ body: inspectionSchema, status: 201 }, async ({ actor, body }) => createInspection(actor, body));
