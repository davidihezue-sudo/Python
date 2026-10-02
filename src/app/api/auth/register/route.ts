import { route } from "@/lib/http";
import { registerSchema } from "@/lib/validation";
import { register } from "@/server/services/auth";

export const POST = route(
  { auth: false, body: registerSchema, status: 202, rate: { limit: 8, windowSec: 600, key: ({ ip }) => `ip:${ip}` } },
  async ({ body }) => {
    const r = await register(body);
    return { ok: true, requiresVerification: r.requiresVerification, message: r.requiresVerification ? "Check your email to verify your address." : "Account created. You can sign in." };
  },
);
