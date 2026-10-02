import { route } from "@/lib/http";
import { extractOcr } from "@/server/services/documents";

export const POST = route({ rate: { limit: 20, windowSec: 600 } }, async ({ actor, params }) => extractOcr(actor, params.id));
