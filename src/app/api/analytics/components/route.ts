import { route } from "@/lib/http";
import { z } from "zod";
import { costByComponent } from "@/server/services/records";

export const GET = route({ query: z.object({ vehicleId: z.string().optional() }) }, async ({ actor, query }) => costByComponent(actor, query.vehicleId));
