import { route } from "@/lib/http";
import { verifySchema } from "@/lib/validation";
import { verifyEmail } from "@/server/services/auth";

export const POST = route({ auth: false, body: verifySchema, rate: { limit: 20, windowSec: 600, key: ({ ip }) => `ip:${ip}` } }, async ({ body }) => verifyEmail(body.token));
