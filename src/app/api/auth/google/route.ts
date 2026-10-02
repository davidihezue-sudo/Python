import { NextResponse } from "next/server";
import { createHash, randomBytes } from "node:crypto";
import { route } from "@/lib/http";
import { env, googleEnabled } from "@/lib/env";
import { signJson } from "@/lib/crypto";
import { AppError } from "@/lib/errors";

export const GET = route({ auth: false, raw: true, rate: { limit: 20, windowSec: 600 } }, async () => {
  if (!googleEnabled()) throw new AppError("NOT_FOUND", "Google sign-in is not configured");
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = signJson({ n: randomBytes(12).toString("base64url") }, 600);
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", process.env.GOOGLE_CLIENT_ID as string);
  url.searchParams.set("redirect_uri", `${env().APP_URL.replace(/\/$/, "")}/api/auth/google/callback`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("prompt", "select_account");
  const res = NextResponse.redirect(url);
  const opts = { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/api/auth/google", maxAge: 600 };
  res.cookies.set("av_oauth_state", state, opts);
  res.cookies.set("av_oauth_verifier", verifier, opts);
  return res;
});
