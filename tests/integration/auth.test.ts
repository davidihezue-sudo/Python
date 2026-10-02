import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { changePassword, deleteAccount, forgotPassword, login, register, resendVerification, resetPassword, verifyEmail } from "@/server/services/auth";
import { resolveSession, destroySession } from "@/lib/auth/session";
import { createActor } from "./helpers";
import { sha256 } from "@/lib/crypto";
import { exportMyData } from "@/server/services/auth";

const pw = "CorrectHorse9!";

describe("authentication", () => {
  it("registers, blocks login until the email is verified, then allows login", async () => {
    await register({ name: "Ada Lovelace", email: "ada@example.com", password: pw, acceptTerms: true });
    await expect(login("ada@example.com", pw, {})).rejects.toMatchObject({ code: "UNAUTHENTICATED", details: { reason: "EMAIL_NOT_VERIFIED" } });
    const mail = await db.emailOutbox.findFirstOrThrow({ where: { toEmail: "ada@example.com" } });
    await verifyEmail(/token=([\w-]+)/.exec(mail.text)![1]);
    const res = await login("ada@example.com", pw, { ip: "1.2.3.4" });
    expect(res.actor.email).toBe("ada@example.com");
    const resolved = await resolveSession(res.token);
    expect(resolved?.user.id).toBe(res.actor.id);
    // household + preferences are provisioned
    const members = await db.householdMember.findMany({ where: { userId: res.actor.id } });
    expect(members).toHaveLength(1);
    expect(members[0].role).toBe("ADMIN");
    expect(await db.userPreference.count({ where: { userId: res.actor.id } })).toBe(1);
  });

  it("stores only a hash of the session token and invalidates on logout", async () => {
    const a = await createActor("Bob", "bob@example.com");
    const { token } = await login("bob@example.com", pw, {});
    expect(await db.session.count({ where: { tokenHash: sha256(token) } })).toBe(1);
    expect(await db.session.count({ where: { tokenHash: token } })).toBe(0);
    await destroySession(token);
    expect(await resolveSession(token)).toBeNull();
    expect(a.email).toBe("bob@example.com");
  });

  it("does not reveal whether an email is registered", async () => {
    await createActor("Cy", "cy@example.com");
    const again = await register({ name: "Someone", email: "cy@example.com", password: pw, acceptTerms: true });
    expect(again.requiresVerification).toBe(true);
    expect(await db.user.count({ where: { email: "cy@example.com" } })).toBe(1);
    await expect(login("nobody@example.com", pw, {})).rejects.toMatchObject({ message: "Invalid email or password" });
    await expect(login("cy@example.com", "wrong-password-1", {})).rejects.toMatchObject({ message: "Invalid email or password" });
    expect((await forgotPassword("nobody@example.com")).ok).toBe(true);
    expect((await resendVerification("nobody@example.com")).ok).toBe(true);
  });

  it("rejects weak passwords at the schema level", async () => {
    const { registerSchema } = await import("@/lib/validation");
    expect(registerSchema.safeParse({ name: "x", email: "x@example.com", password: "short", acceptTerms: true }).success).toBe(false);
    expect(registerSchema.safeParse({ name: "x", email: "x@example.com", password: "password123", acceptTerms: true }).success).toBe(false);
    expect(registerSchema.safeParse({ name: "x", email: "x@example.com", password: pw, acceptTerms: true }).success).toBe(true);
  });

  it("resets a password with a single-use token and revokes sessions", async () => {
    await createActor("Dee", "dee@example.com");
    const s = await login("dee@example.com", pw, {});
    await forgotPassword("dee@example.com");
    const mail = await db.emailOutbox.findFirstOrThrow({ where: { toEmail: "dee@example.com", subject: { contains: "Reset" } } });
    const token = /token=([\w-]+)/.exec(mail.text)![1];
    await resetPassword(token, "BrandNewPass42!");
    expect(await resolveSession(s.token)).toBeNull();
    await expect(login("dee@example.com", pw, {})).rejects.toBeTruthy();
    expect((await login("dee@example.com", "BrandNewPass42!", {})).actor.email).toBe("dee@example.com");
    await expect(resetPassword(token, "AnotherPass77!")).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("changes password only with the correct current password", async () => {
    const a = await createActor("Eve", "eve@example.com");
    await expect(changePassword(a, { currentPassword: "nope", newPassword: "NewPassword12!" })).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    await changePassword(a, { currentPassword: pw, newPassword: "NewPassword12!" });
    expect((await login("eve@example.com", "NewPassword12!", {})).actor.id).toBe(a.id);
  });

  it("expired verification tokens are rejected", async () => {
    await register({ name: "Fay", email: "fay@example.com", password: pw, acceptTerms: true });
    await db.verificationToken.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    const mail = await db.emailOutbox.findFirstOrThrow({ where: { toEmail: "fay@example.com" } });
    await expect(verifyEmail(/token=([\w-]+)/.exec(mail.text)![1])).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("exports and deletes an account including solely-owned household data", async () => {
    const a = await createActor("Gus", "gus@example.com");
    const exp = await exportMyData(a);
    expect(exp.account.email).toBe("gus@example.com");
    expect(exp.format).toBe("autovault-export-v1");
    await expect(deleteAccount(a, { password: "wrong" })).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    await deleteAccount(a, { password: pw });
    expect(await db.user.count({ where: { id: a.id } })).toBe(0);
    expect(await db.household.count()).toBe(0);
  });
});
