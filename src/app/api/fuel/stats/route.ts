import { route, optDateQ } from "@/lib/http";
import { z } from "zod";
import { fuelStats } from "@/server/services/fuel";

export const GET = route({ query: z.object({ vehicleId: z.string().min(5), from: optDateQ, to: optDateQ }) }, async ({ actor, query }) => fuelStats(actor, query.vehicleId, query));
