import { route, optDateQ } from "@/lib/http";
import { z } from "zod";
import { getDashboard } from "@/server/services/analytics";

export const GET = route({ query: z.object({ vehicleId: z.string().optional(), range: z.enum(["30d", "90d", "ytd", "12m", "all", "custom"]).default("12m"), from: optDateQ, to: optDateQ, exclude: z.string().optional() }) }, async ({ actor, query }) => getDashboard(actor, { ...query, exclude: query.exclude ? query.exclude.split(",").filter(Boolean) : [] }));
