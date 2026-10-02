import { NextResponse } from "next/server";
import { route } from "@/lib/http";
import { destroySession, SESSION_COOKIE } from "@/lib/auth/session";

export const POST = route({ auth: false }, async ({ sessionToken }) => {
  await destroySession(sessionToken);
  const res = NextResponse.json({ data: { ok: true } });
  res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
});
