import { db } from "../db";
import { randomToken, sha256 } from "../crypto";

export const SESSION_COOKIE = "av_session";
const SESSION_DAYS = 30;
const REFRESH_AFTER_MS = 24 * 3600 * 1000;

export async function createSession(userId: string, meta: { userAgent?: string | null; ip?: string | null } = {}) {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400_000);
  await db.session.create({
    data: { userId, tokenHash: sha256(token), expiresAt, userAgent: meta.userAgent?.slice(0, 300) ?? null, ip: meta.ip ?? null },
  });
  return { token, expiresAt };
}

export async function resolveSession(token: string | undefined | null) {
  if (!token) return null;
  const s = await db.session.findUnique({
    where: { tokenHash: sha256(token) },
    include: { user: { include: { preference: true } } },
  });
  if (!s) return null;
  if (s.expiresAt < new Date()) {
    await db.session.delete({ where: { id: s.id } }).catch(() => undefined);
    return null;
  }
  if (s.user.disabledAt || s.user.deletedAt) return null;
  if (Date.now() - s.lastUsedAt.getTime() > REFRESH_AFTER_MS) {
    await db.session.update({ where: { id: s.id }, data: { lastUsedAt: new Date(), expiresAt: new Date(Date.now() + SESSION_DAYS * 86400_000) } }).catch(() => undefined);
  }
  return { session: s, user: s.user };
}

export async function destroySession(token: string | undefined | null) {
  if (!token) return;
  await db.session.deleteMany({ where: { tokenHash: sha256(token) } });
}

export const cookieOptions = (expires?: Date) => ({
  httpOnly: true,
  sameSite: "lax" as const,
  // Secure cookies are dropped by browsers on plain-http origins other than localhost, so a deliberately http APP_URL (LAN/phone testing) opts out.
  secure: process.env.NODE_ENV === "production" && !/^http:\/\//i.test(process.env.APP_URL ?? ""),
  path: "/",
  ...(expires ? { expires } : {}),
});
