import { route } from "@/lib/http";
import { prefsSchema } from "@/lib/validation";
import { updatePreferences } from "@/server/services/users";

export const PATCH = route({ body: prefsSchema }, async ({ actor, body }) => {
  await updatePreferences(actor, body as any);
  return { ok: true };
});
