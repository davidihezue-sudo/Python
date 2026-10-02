import { route } from "@/lib/http";
import { deleteInspection } from "@/server/services/inspections";

export const DELETE = route({}, async ({ actor, params }) => deleteInspection(actor, params.id));
