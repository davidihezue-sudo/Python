import { route } from "@/lib/http";
import { z } from "zod";
import { listLibrary } from "@/server/services/schedules";

export const GET = route({ query: z.object({ householdId: z.string().optional() }) }, async ({ actor, query }) => listLibrary(actor, query.householdId));
