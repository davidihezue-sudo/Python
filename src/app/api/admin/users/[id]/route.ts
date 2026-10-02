import { route } from "@/lib/http";
import { z } from "zod";
import { setUserDisabled } from "@/server/services/admin";

export const PATCH = route({ body: z.object({ disabled: z.boolean() }) }, async ({ actor, params, body }) => setUserDisabled(actor, params.id, body.disabled));
