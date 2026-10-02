import { route } from "@/lib/http";
import { assignmentUpdateSchema } from "@/lib/validation";
import { deleteAssignment, getAssignment, updateAssignment } from "@/server/services/schedules";

export const GET = route({}, async ({ actor, params }) => getAssignment(actor, params.id));
export const PATCH = route({ body: assignmentUpdateSchema }, async ({ actor, params, body }) => updateAssignment(actor, params.id, body));
export const DELETE = route({}, async ({ actor, params }) => deleteAssignment(actor, params.id));
