import { route } from "@/lib/http";
import { z } from "zod";
import { upcoming } from "@/server/services/reminders";

export const GET = route({ query: z.object({ vehicleId: z.string().optional(), horizonDays: z.coerce.number().int().min(7).max(730).default(120) }) }, async ({ actor, query }) => upcoming(actor, query));
