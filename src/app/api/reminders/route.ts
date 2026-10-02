import { route, boolish } from "@/lib/http";
import { z } from "zod";
import { reminderSchema } from "@/lib/validation";
import { createReminder, listReminders } from "@/server/services/reminders";

export const GET = route({ query: z.object({ vehicleId: z.string().optional(), includeDone: boolish.optional() }) }, async ({ actor, query }) => listReminders(actor, query.vehicleId, query.includeDone));
export const POST = route({ body: reminderSchema, status: 201 }, async ({ actor, body }) => createReminder(actor, body));
