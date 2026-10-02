import { route } from "@/lib/http";
import { listConversations } from "@/server/services/ai";

export const GET = route({}, async ({ actor }) => listConversations(actor));
