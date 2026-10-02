import { route } from "@/lib/http";
import { changePasswordSchema } from "@/lib/validation";
import { changePassword } from "@/server/services/auth";
import { sha256 } from "@/lib/crypto";

export const POST = route({ body: changePasswordSchema, rate: { limit: 10, windowSec: 900 } }, async ({ actor, body, sessionToken }) => changePassword(actor, body, sessionToken ? sha256(sessionToken) : undefined));
