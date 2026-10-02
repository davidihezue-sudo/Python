import { route } from "@/lib/http";
import { z } from "zod";
import { componentHistory } from "@/server/services/parts";

export const GET = route({ query: z.object({ vehicleId: z.string().min(5), component: z.string().optional() }) }, async ({ actor, query }) => componentHistory(actor, query.vehicleId, query.component));
