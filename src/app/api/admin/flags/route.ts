import { route } from "@/lib/http";
import { z } from "zod";
import { listFlags, setFlag } from "@/server/services/admin";

export const GET = route({}, async ({ actor }) => listFlags(actor));
export const PATCH = route({ body: z.object({ key: z.string().min(1).max(60), enabled: z.boolean() }) }, async ({ actor, body }) => setFlag(actor, body.key, body.enabled));
