import { NextResponse } from "next/server";
import { z } from "zod";
import { route } from "@/lib/http";
import { loginSchema } from "@/lib/validation";
import { login } from "@/server/services/auth";
import { SESSION_COOKIE, cookieOptions } from "@/lib/auth/session";

export const POST = route(
  { auth: false, body: loginSchema, rate: { limit: 10, windowSec: 900, key: ({ ip, body }) => `ip:${ip}:${String(body?.email ?? "").toLowerCase()}` } },
  async ({ body, ip, req }) => {
    const s = await login(body.email, body.password, { ip, userAgent: req.headers.get("user-agent") });
    const res = NextResponse.json({ data: { ok: true, name: s.actor.name } });
    res.cookies.set(SESSION_COOKIE, s.token, cookieOptions(s.expiresAt));
    return res;
  },
);
export type _ = z.infer<typeof loginSchema>;
