import { route } from "@/lib/http";
import { resetSchema } from "@/lib/validation";
import { resetPassword } from "@/server/services/auth";

export const POST = route({ auth: false, body: resetSchema, rate: { limit: 10, windowSec: 3600, key: ({ ip }) => `ip:${ip}` } }, async ({ body }) => resetPassword(body.token, body.password));
