import { route } from "@/lib/http";
import { z } from "zod";
import { assignmentCreateSchema } from "@/lib/validation";
import { scopeVehicles } from "@/server/services/access";
import { createAssignment, listAllSchedules } from "@/server/services/schedules";
import { AppError } from "@/lib/errors";

export const GET = route({ query: z.object({ vehicleId: z.string().optional() }) }, async ({ actor, query }) => {
  const scope = await scopeVehicles(actor, query.vehicleId, "view");
  return listAllSchedules(actor, scope.map((s) => ({ id: s.vehicle.id, name: s.vehicle.nickname, fin: s.fin })));
});
export const POST = route({ body: assignmentCreateSchema, status: 201 }, async ({ actor, body }) => {
  if (!body.vehicleId) throw new AppError("VALIDATION_ERROR", "vehicleId is required");
  return createAssignment(actor, body.vehicleId, body);
});
