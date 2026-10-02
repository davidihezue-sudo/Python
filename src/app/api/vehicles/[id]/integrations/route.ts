import { route } from "@/lib/http";
import { z } from "zod";
import { createObdGateway, listIntegrations } from "@/server/integrations/diagnostics";

export const GET = route({}, async ({ actor, params }) => listIntegrations(actor, params.id));
export const POST = route({ body: z.object({ label: z.string().max(80).optional() }), status: 201 }, async ({ actor, params, body }) => createObdGateway(actor, params.id, body.label));
