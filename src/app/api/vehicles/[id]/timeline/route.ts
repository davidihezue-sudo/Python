import { route } from "@/lib/http";
import { z } from "zod";
import { vehicleTimeline } from "@/server/services/vehicles";

export const GET = route({ query: z.object({ limit: z.coerce.number().int().min(1).max(100).default(40) }) }, async ({ actor, params, query }) => vehicleTimeline(actor, params.id, query.limit));
