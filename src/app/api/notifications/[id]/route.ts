import { route } from "@/lib/http";
import { deleteNotification } from "@/server/services/notifications";

export const DELETE = route({}, async ({ actor, params }) => deleteNotification(actor, params.id));
