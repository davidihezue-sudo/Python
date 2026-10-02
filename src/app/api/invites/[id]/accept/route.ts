import { route } from "@/lib/http";
import { acceptInvite } from "@/server/services/households";

export const POST = route({ rate: { limit: 20, windowSec: 600 } }, async ({ actor, params }) => acceptInvite(actor, params.id));
