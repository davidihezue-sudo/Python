import { route } from "@/lib/http";
import { reminderUpdateSchema } from "@/lib/validation";
import { deleteReminder, updateReminder } from "@/server/services/reminders";

export const PATCH = route({ body: reminderUpdateSchema }, async ({ actor, params, body }) => updateReminder(actor, params.id, body));
export const DELETE = route({}, async ({ actor, params }) => deleteReminder(actor, params.id));
