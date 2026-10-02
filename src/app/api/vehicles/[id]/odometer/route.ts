import { route } from "@/lib/http";
import { odometerSchema } from "@/lib/validation";
import { addReading, getOdometerOverview } from "@/server/services/odometer";

export const GET = route({}, async ({ actor, params }) => getOdometerOverview(actor, params.id));
export const POST = route({ body: odometerSchema, status: 201 }, async ({ actor, params, body }) => addReading(actor, params.id, body));
