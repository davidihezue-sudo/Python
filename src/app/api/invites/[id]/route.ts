import { route } from "@/lib/http";
import { getInvitePreview, revokeInvite } from "@/server/services/households";

// GET: public preview by token (the path segment is the secret token). DELETE: admin revokes by invite id.
export const GET = route({ auth: false, rate: { limit: 30, windowSec: 600, key: ({ ip }) => `ip:${ip}` } }, async ({ params }) => getInvitePreview(params.id));
export const DELETE = route({}, async ({ actor, params }) => revokeInvite(actor, params.id));
