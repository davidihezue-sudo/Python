import { route } from "@/lib/http";
import { householdSchema } from "@/lib/validation";
import { createHousehold, listHouseholds } from "@/server/services/households";

export const GET = route({}, async ({ actor }) => listHouseholds(actor));
export const POST = route({ body: householdSchema, status: 201 }, async ({ actor, body }) => createHousehold(actor, body));
