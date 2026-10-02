import { route, pageQuery, optDateQ } from "@/lib/http";
import { z } from "zod";
import { fuelSchema } from "@/lib/validation";
import { createFuel, listFuel } from "@/server/services/fuel";

export const GET = route({ query: z.object({ vehicleId: z.string().optional(), from: optDateQ, to: optDateQ, ...pageQuery }) }, async ({ actor, query }) => listFuel(actor, query));
export const POST = route({ body: fuelSchema, status: 201 }, async ({ actor, body }) => createFuel(actor, body));
