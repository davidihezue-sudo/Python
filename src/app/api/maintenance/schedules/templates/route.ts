import { route } from "@/lib/http";
import { z } from "zod";
import { scheduleTemplateSchema } from "@/lib/validation";
import { createHouseholdTemplate } from "@/server/services/schedules";

export const POST = route({ body: scheduleTemplateSchema.and(z.object({ householdId: z.string().min(5) })), status: 201 }, async ({ actor, body }) => createHouseholdTemplate(actor, body.householdId, body));
