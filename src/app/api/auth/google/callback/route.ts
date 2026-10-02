import { NextResponse } from "next/server";
import { route } from "@/lib/http";
import { env, googleEnabled } from "@/lib/env";
import { verifyJson } from "@/lib/crypto";
import { loginWithGoogle } from "@/server/services/auth";
import { SESSION_COOKIE, cookieOptions } from "@/lib/auth/session";
import { logger } from "@/lib/logger";

export const GET = route({ auth: false, raw: true, rate: { limit: 20, windowSec: 600 } }, async ({ req, ip }) => {
  const base = env().APP_URL.replace(/\/$/, "");
  const fail = (reason: string) => {
    const r = NextResponse.redirect(`${base}/login?error=${reason}`);
    r.cookies.set("av_oauth_state", "", { path: "/api/auth/google", maxAge: 0 });
    r.cookies.set("av_oauth_verifier", "", { path: "/api/auth/google", maxAge: 0 });
    return r;
  };
  if (!googleEnabled()) return fail("google_unavailable");
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieState = req.cookies.get("av_oauth_state")?.value;
  const verifier = req.cookies.get("av_oauth_verifier")?.value;
  if (!code || !state || !cookieState || state !== cookieState || !verifyJson(state) || !verifier) return fail("google_state");
  try {
    const tok = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code, client_id: process.env.GOOGLE_CLIENT_ID as string, client_secret: process.env.GOOGLE_CLIENT_SECRET as string, redirect_uri: `${base}/api/auth/google/callback`, grant_type: "authorization_code", code_verifier: verifier }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!tok.ok) return fail("google_exchange");
    const { access_token } = (await tok.json()) as { access_token: string };
    const ui = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { authorization: `Bearer ${access_token}` }, signal: AbortSignal.timeout(10_000) });
    if (!ui.ok) return fail("google_profile");
    const p = (await ui.json()) as { sub: string; email: string; email_verified: boolean; name?: string };
    const s = await loginWithGoogle({ sub: p.sub, email: p.email, emailVerified: !!p.email_verified, name: p.name ?? p.email }, { ip, userAgent: req.headers.get("user-agent") });
    const res = NextResponse.redirect(`${base}/dashboard`);
    res.cookies.set(SESSION_COOKIE, s.token, cookieOptions(s.expiresAt));
    res.cookies.set("av_oauth_state", "", { path: "/api/auth/google", maxAge: 0 });
    res.cookies.set("av_oauth_verifier", "", { path: "/api/auth/google", maxAge: 0 });
    return res;
  } catch (e) {
    logger.warn({ err: (e as Error).message }, "google sign-in failed");
    return fail("google_error");
  }
});
