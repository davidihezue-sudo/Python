import type { User } from "@prisma/client";
import { db } from "@/lib/db";
import { AppError, notFound } from "@/lib/errors";
import { randomToken, sha256 } from "@/lib/crypto";
import { adminEmails, env } from "@/lib/env";
import { hashPassword, dummyVerify, verifyPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { resetPasswordMessage, sendEmail, verifyEmailMessage } from "@/lib/email";
import { isValidTimezone } from "@/lib/dates";
import { storage } from "@/lib/storage";
import { logger } from "@/lib/logger";
import { changePasswordSchema, registerSchema } from "@/lib/validation";
import type { z } from "zod";
import { actorFromUser, type Actor } from "../context";
import { audit } from "./audit";
import { exportAccountData } from "./export";

const HOUR = 3600_000;

async function issueToken(userId: string, type: "EMAIL_VERIFY" | "PASSWORD_RESET", ttlMs: number) {
  await db.verificationToken.updateMany({ where: { userId, type, usedAt: null }, data: { usedAt: new Date() } });
  const token = randomToken(32);
  await db.verificationToken.create({ data: { userId, type, tokenHash: sha256(token), expiresAt: new Date(Date.now() + ttlMs) } });
  return token;
}

async function provisionUser(data: { email: string; name: string; passwordHash?: string | null; verified: boolean; timezone?: string }) {
  const tz = data.timezone && isValidTimezone(data.timezone) ? data.timezone : "America/Edmonton";
  const makeAdmin = data.verified && adminEmails().includes(data.email);
  return db.$transaction(async (tx) => {
    const user = await tx.user.create({ data: { email: data.email, name: data.name, passwordHash: data.passwordHash ?? null, emailVerifiedAt: data.verified ? new Date() : null, platformRole: makeAdmin ? "PLATFORM_ADMIN" : "USER" } });
    await tx.userPreference.create({ data: { userId: user.id, timezone: tz } });
    const hh = await tx.household.create({ data: { name: `${data.name.split(" ")[0]}'s Household`, timezone: tz } });
    await tx.householdMember.create({ data: { householdId: hh.id, userId: user.id, role: "ADMIN" } });
    await tx.subscription.create({ data: { householdId: hh.id, plan: env().DEFAULT_PLAN } });
    return user;
  });
}

/**
 * Registration never reveals whether an email is already in use (prevents account enumeration): the response is
 * identical and existing owners are notified by email instead.
 */
export async function register(input: z.infer<typeof registerSchema>) {
  const email = input.email.toLowerCase();
  const existing = await db.user.findUnique({ where: { email } });
  const needVerify = env().REQUIRE_EMAIL_VERIFICATION;
  if (existing && !existing.deletedAt) {
    await sendEmail(email, "Someone tried to register with your email", "Someone just tried to create an AutoVault account with this email address, but you already have one. If it was you, sign in or use 'Forgot password'. If not, you can ignore this message.");
    return { requiresVerification: needVerify };
  }
  if (existing?.deletedAt) await db.user.delete({ where: { id: existing.id } });
  const user = await provisionUser({ email, name: input.name, passwordHash: await hashPassword(input.password), verified: !needVerify, timezone: input.timezone });
  if (needVerify) {
    const token = await issueToken(user.id, "EMAIL_VERIFY", 24 * HOUR);
    const m = verifyEmailMessage(user.name, token);
    await sendEmail(user.email, m.subject, m.text, m.html);
  }
  await audit(null, { id: user.id, ip: null }, { entity: "User", entityId: user.id, action: "register" });
  return { requiresVerification: needVerify };
}

export async function verifyEmail(token: string) {
  const t = await db.verificationToken.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
  if (!t || t.type !== "EMAIL_VERIFY" || t.usedAt || t.expiresAt < new Date()) throw new AppError("BAD_REQUEST", "This verification link is invalid or has expired. Request a new one from the sign-in page.");
  await db.$transaction([
    db.verificationToken.update({ where: { id: t.id }, data: { usedAt: new Date() } }),
    db.user.update({ where: { id: t.userId }, data: { emailVerifiedAt: t.user.emailVerifiedAt ?? new Date(), ...(adminEmails().includes(t.user.email) ? { platformRole: "PLATFORM_ADMIN" } : {}) } }),
  ]);
  return { ok: true };
}

export async function resendVerification(email: string) {
  const user = await db.user.findUnique({ where: { email: email.toLowerCase() } });
  if (user && !user.emailVerifiedAt && !user.deletedAt) {
    const token = await issueToken(user.id, "EMAIL_VERIFY", 24 * HOUR);
    const m = verifyEmailMessage(user.name, token);
    await sendEmail(user.email, m.subject, m.text, m.html);
  }
  return { ok: true }; // identical response whether or not the account exists
}

export async function login(email: string, password: string, meta: { ip?: string | null; userAgent?: string | null }) {
  const user = await db.user.findUnique({ where: { email: email.toLowerCase() }, include: { preference: true } });
  if (!user || !user.passwordHash || user.deletedAt) {
    await dummyVerify(password);
    throw new AppError("UNAUTHENTICATED", "Invalid email or password");
  }
  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) throw new AppError("UNAUTHENTICATED", "Invalid email or password");
  if (user.disabledAt) throw new AppError("FORBIDDEN", "This account has been disabled. Contact support.");
  if (env().REQUIRE_EMAIL_VERIFICATION && !user.emailVerifiedAt) throw new AppError("UNAUTHENTICATED", "Please verify your email address before signing in.", { reason: "EMAIL_NOT_VERIFIED" });
  const session = await createSession(user.id, meta);
  await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  return { ...session, actor: actorFromUser(user, meta.ip) };
}

export async function forgotPassword(email: string) {
  const user = await db.user.findUnique({ where: { email: email.toLowerCase() } });
  if (user && !user.deletedAt && !user.disabledAt) {
    const token = await issueToken(user.id, "PASSWORD_RESET", HOUR);
    const m = resetPasswordMessage(user.name, token);
    await sendEmail(user.email, m.subject, m.text, m.html);
  }
  return { ok: true };
}

export async function resetPassword(token: string, password: string) {
  const t = await db.verificationToken.findUnique({ where: { tokenHash: sha256(token) } });
  if (!t || t.type !== "PASSWORD_RESET" || t.usedAt || t.expiresAt < new Date()) throw new AppError("BAD_REQUEST", "This reset link is invalid or has expired. Request a new one.");
  const passwordHash = await hashPassword(password);
  await db.$transaction([
    db.verificationToken.update({ where: { id: t.id }, data: { usedAt: new Date() } }),
    // Receiving the reset email also proves ownership of the address.
    db.user.update({ where: { id: t.userId }, data: { passwordHash, emailVerifiedAt: new Date() } }),
    db.session.deleteMany({ where: { userId: t.userId } }),
  ]);
  return { ok: true };
}

export async function changePassword(actor: Actor, input: z.infer<typeof changePasswordSchema>, currentSessionTokenHash?: string) {
  const user = await db.user.findUniqueOrThrow({ where: { id: actor.id } });
  if (!user.passwordHash) throw new AppError("BAD_REQUEST", "This account signs in with Google and has no password. Use 'Forgot password' to set one.");
  if (!(await verifyPassword(input.currentPassword, user.passwordHash))) throw new AppError("UNAUTHENTICATED", "Current password is incorrect");
  await db.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(input.newPassword) } });
  await db.session.deleteMany({ where: { userId: user.id, ...(currentSessionTokenHash ? { tokenHash: { not: currentSessionTokenHash } } : {}) } });
  await audit(null, actor, { entity: "User", entityId: user.id, action: "change-password" });
  return { ok: true };
}

export async function loginWithGoogle(profile: { sub: string; email: string; emailVerified: boolean; name: string }, meta: { ip?: string | null; userAgent?: string | null }) {
  if (!profile.emailVerified) throw new AppError("FORBIDDEN", "Your Google account's email address is not verified");
  const email = profile.email.toLowerCase();
  const account = await db.account.findUnique({ where: { provider_providerAccountId: { provider: "google", providerAccountId: profile.sub } }, include: { user: { include: { preference: true } } } });
  let user: (User & { preference: any }) | null = account?.user ?? null;
  if (!user) {
    const byEmail = await db.user.findUnique({ where: { email }, include: { preference: true } });
    if (byEmail && !byEmail.deletedAt) {
      user = byEmail;
      if (!byEmail.emailVerifiedAt) await db.user.update({ where: { id: byEmail.id }, data: { emailVerifiedAt: new Date() } });
    } else {
      const created = await provisionUser({ email, name: profile.name || email.split("@")[0], verified: true });
      user = await db.user.findUniqueOrThrow({ where: { id: created.id }, include: { preference: true } });
    }
    await db.account.create({ data: { userId: user.id, provider: "google", providerAccountId: profile.sub } });
  }
  if (user.disabledAt || user.deletedAt) throw new AppError("FORBIDDEN", "This account has been disabled. Contact support.");
  const session = await createSession(user.id, meta);
  await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  return { ...session, actor: actorFromUser(user as any, meta.ip) };
}

/**
 * Permanently deletes the account and personal data. Households the user was the only member of are deleted entirely
 * (including stored files). Shared households survive; if the user was their only administrator the longest-standing
 * member is promoted so the household is never orphaned.
 */
export async function deleteAccount(actor: Actor, confirmation: { password?: string; email?: string }) {
  const user = await db.user.findUniqueOrThrow({ where: { id: actor.id } });
  if (user.passwordHash) {
    if (!confirmation.password || !(await verifyPassword(confirmation.password, user.passwordHash))) throw new AppError("UNAUTHENTICATED", "Password is incorrect");
  } else if ((confirmation.email ?? "").toLowerCase() !== user.email) throw new AppError("BAD_REQUEST", "Type your email address to confirm deletion");
  const memberships = await db.householdMember.findMany({ where: { userId: user.id } });
  const fileKeys: string[] = [];
  for (const m of memberships) {
    const members = await db.householdMember.findMany({ where: { householdId: m.householdId }, orderBy: { createdAt: "asc" } });
    const others = members.filter((x) => x.userId !== user.id);
    if (!others.length) {
      const docs = await db.document.findMany({ where: { householdId: m.householdId }, select: { fileKey: true } });
      fileKeys.push(...docs.map((d) => d.fileKey));
      await db.$transaction([db.household.delete({ where: { id: m.householdId } })]);
    } else if (m.role === "ADMIN" && !others.some((o) => o.role === "ADMIN")) {
      await db.householdMember.update({ where: { id: others[0].id }, data: { role: "ADMIN" } });
    }
  }
  await db.document.updateMany({ where: { uploadedById: user.id }, data: { uploadedById: null } });
  await db.user.delete({ where: { id: user.id } });
  for (const k of fileKeys) await storage().delete(k).catch((e) => logger.warn({ err: e.message }, "failed to delete stored file"));
  await audit(null, null, { entity: "User", entityId: user.id, action: "account-deleted" });
  return { ok: true };
}

export async function exportMyData(actor: Actor) {
  return exportAccountData(actor);
}
export { notFound };
