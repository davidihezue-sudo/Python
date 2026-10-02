import { route } from "@/lib/http";
import { forgotSchema } from "@/lib/validation";
import { forgotPassword } from "@/server/services/auth";

export const POST = route({ auth: false, body: forgotSchema, rate: { limit: 5, windowSec: 3600, key: ({ ip, body }) => `ip:${ip}:${String(body?.email ?? "").toLowerCase()}` } }, async ({ body }) => forgotPassword(body.email));
