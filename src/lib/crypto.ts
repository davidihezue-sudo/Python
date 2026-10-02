import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "./env";

export const sha256 = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");

export function sign(payload: string): string {
  return createHmac("sha256", env().AUTH_SECRET).update(payload).digest("base64url");
}
export function verifySignature(payload: string, sig: string): boolean {
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
/** Compact signed token: base64url(json).signature. Used for OAuth state. */
export function signJson(obj: unknown, ttlSeconds: number): string {
  const body = Buffer.from(JSON.stringify({ ...(obj as object), exp: Math.floor(Date.now() / 1000) + ttlSeconds })).toString("base64url");
  return `${body}.${sign(body)}`;
}
export function verifyJson<T = any>(token: string): T | null {
  const [body, sig] = token.split(".");
  if (!body || !sig || !verifySignature(body, sig)) return null;
  try {
    const obj = JSON.parse(Buffer.from(body, "base64url").toString());
    if (typeof obj.exp !== "number" || obj.exp < Date.now() / 1000) return null;
    return obj as T;
  } catch {
    return null;
  }
}
