import { route } from "@/lib/http";
import { z } from "zod";
import { providerSchema } from "@/lib/validation";
import { createProvider, listProviders } from "@/server/services/inspections";

export const GET = route({ query: z.object({ householdId: z.string().optional() }) }, async ({ actor, query }) => listProviders(actor, query.householdId));
export const POST = route({ body: providerSchema, status: 201 }, async ({ actor, body }) => createProvider(actor, body));
