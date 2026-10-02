import { route } from "@/lib/http";
import { deleteConversation, getConversation } from "@/server/services/ai";

export const GET = route({}, async ({ actor, params }) => getConversation(actor, params.id));
export const DELETE = route({}, async ({ actor, params }) => deleteConversation(actor, params.id));
