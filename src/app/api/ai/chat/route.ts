import { route } from "@/lib/http";
import { aiChatSchema } from "@/lib/validation";
import { chat } from "@/server/services/ai";

export const POST = route({ body: aiChatSchema, rate: { limit: 30, windowSec: 600 } }, async ({ actor, body }) => chat(actor, body));
