import { route } from "@/lib/http";
import { revokeIntegration } from "@/server/integrations/diagnostics";

export const DELETE = route({}, async ({ actor, params }) => revokeIntegration(actor, params.id));
