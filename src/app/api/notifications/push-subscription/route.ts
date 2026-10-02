import { route } from "@/lib/http";
import { z } from "zod";
import { pushSubSchema } from "@/lib/validation";
import { removePushSubscription, savePushSubscription } from "@/server/services/notifications";
import { pushEnabled } from "@/lib/env";
import { AppError } from "@/lib/errors";

export const POST = route({ body: pushSubSchema, status: 201 }, async ({ actor, body, req }) => {
  if (!pushEnabled()) throw new AppError("BAD_REQUEST", "Web push is not configured on this server");
  return savePushSubscription(actor, body, req.headers.get("user-agent"));
});
export const DELETE = route({ body: z.object({ endpoint: z.string().url() }) }, async ({ actor, body }) => removePushSubscription(actor, body.endpoint));
