import { route } from "@/lib/http";
import { z } from "zod";
import { profileSchema } from "@/lib/validation";
import { deleteAccount } from "@/server/services/auth";
import { getMe, updateProfile } from "@/server/services/users";
import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/session";

export const GET = route({}, async ({ actor }) => getMe(actor));
export const PATCH = route({ body: profileSchema }, async ({ actor, body }) => updateProfile(actor, body));
export const DELETE = route({ body: z.object({ password: z.string().optional(), email: z.string().optional() }), rate: { limit: 5, windowSec: 900 } }, async ({ actor, body }) => {
  await deleteAccount(actor, body);
  const res = NextResponse.json({ data: { ok: true } });
  res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
});
