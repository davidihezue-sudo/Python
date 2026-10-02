import { route, pageQuery, boolish } from "@/lib/http";
import { z } from "zod";
import { listNotifications, updateNotifications } from "@/server/services/notifications";

export const GET = route({ query: z.object({ unread: boolish.optional(), includeDismissed: boolish.optional(), ...pageQuery }) }, async ({ actor, query }) => listNotifications(actor, query));
export const PATCH = route({ body: z.object({ ids: z.array(z.string()).max(200).optional(), all: z.boolean().optional(), action: z.enum(["read", "dismiss", "actioned"]) }) }, async ({ actor, body }) => updateNotifications(actor, body));
