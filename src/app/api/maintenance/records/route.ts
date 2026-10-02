import { route, pageQuery, optNum, optDateQ } from "@/lib/http";
import { z } from "zod";
import { recordCreateSchema } from "@/lib/validation";
import { createRecord, listRecords } from "@/server/services/records";

const q = z.object({
  vehicleId: z.string().optional(),
  kind: z.enum(["MAINTENANCE", "REPAIR"]).optional(),
  status: z.string().optional(),
  q: z.string().max(100).optional(),
  category: z.string().max(60).optional(),
  from: optDateQ,
  to: optDateQ,
  minKm: optNum,
  maxKm: optNum,
  minCost: optNum,
  maxCost: optNum,
  providerId: z.string().optional(),
  workPerformedBy: z.string().optional(),
  sort: z.enum(["date_desc", "date_asc", "cost_desc", "cost_asc", "km_desc", "km_asc"]).optional(),
  ...pageQuery,
});
export const GET = route({ query: q }, async ({ actor, query }) => listRecords(actor, query));
export const POST = route({ body: recordCreateSchema, status: 201, maxBody: 400_000 }, async ({ actor, body }) => createRecord(actor, body));
