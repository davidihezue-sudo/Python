import { route } from "@/lib/http";
import { inviteSchema } from "@/lib/validation";
import { createInvite } from "@/server/services/households";

export const POST = route({ body: inviteSchema, status: 201, rate: { limit: 20, windowSec: 3600 } }, async ({ actor, body, params }) => createInvite(actor, params.id, body));
