import { route } from "@/lib/http";
import { assignmentCreateSchema } from "@/lib/validation";
import { createAssignment, listVehicleSchedules } from "@/server/services/schedules";

export const GET = route({}, async ({ actor, params }) => listVehicleSchedules(actor, params.id));
export const POST = route({ body: assignmentCreateSchema, status: 201 }, async ({ actor, params, body }) => createAssignment(actor, params.id, body));
