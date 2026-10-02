import { route } from "@/lib/http";
import { forgotSchema } from "@/lib/validation";
import { resendVerification } from "@/server/services/auth";

export const POST = route({ auth: false, body: forgotSchema, rate: { limit: 3, windowSec: 3600, key: ({ ip, body }) => `ip:${ip}:${String(body?.email ?? "").toLowerCase()}` } }, async ({ body }) => resendVerification(body.email));
