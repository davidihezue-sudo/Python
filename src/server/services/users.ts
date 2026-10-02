import { db } from "@/lib/db";
import { prefsSchema, profileSchema } from "@/lib/validation";
import type { z } from "zod";
import { actorFromUser, type Actor } from "../context";
import { audit } from "./audit";
import { AppError } from "@/lib/errors";
import { uploadDocument } from "./documents";
import { googleEnabled } from "@/lib/env";

export async function getMe(actor: Actor) {
  const u = await db.user.findUniqueOrThrow({ where: { id: actor.id }, include: { preference: true, accounts: true } });
  const hh = await db.householdMember.findMany({ where: { userId: actor.id, household: { deletedAt: null } }, include: { household: true }, orderBy: { createdAt: "asc" } });
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    emailVerified: !!u.emailVerifiedAt,
    platformRole: u.platformRole,
    hasPassword: !!u.passwordHash,
    linkedProviders: u.accounts.map((a) => a.provider),
    imageUrl: u.imageDocumentId ? `/api/documents/${u.imageDocumentId}/file` : null,
    preferences: actor.prefs,
    households: hh.map((m) => ({ id: m.householdId, name: m.household.name, role: m.role })),
    googleEnabled: googleEnabled(),
  };
}

export async function updateProfile(actor: Actor, input: z.infer<typeof profileSchema>) {
  await db.user.update({ where: { id: actor.id }, data: { ...(input.name ? { name: input.name } : {}), ...(input.locale ? { locale: input.locale } : {}) } });
  return { ok: true };
}

export async function updatePreferences(actor: Actor, input: z.infer<typeof prefsSchema>) {
  const data = { ...input };
  await db.userPreference.upsert({ where: { userId: actor.id }, create: { userId: actor.id, ...data }, update: data });
  await audit(null, actor, { entity: "UserPreference", entityId: actor.id, action: "update", after: input });
  const row = await db.userPreference.findUniqueOrThrow({ where: { userId: actor.id } });
  return row;
}

export async function setProfilePhoto(actor: Actor, file: { name: string; size: number; data: Buffer }) {
  const first = await db.householdMember.findFirst({ where: { userId: actor.id, role: "ADMIN" } });
  if (!first) throw new AppError("FORBIDDEN", "No household available for storing the photo");
  const mimeOk = /\.(jpe?g|png|webp)$/i.test(file.name);
  if (!mimeOk) throw new AppError("UNSUPPORTED_MEDIA_TYPE", "Profile photos must be JPG, PNG or WEBP images");
  const out = await uploadDocument(actor, file, { category: "OTHER", title: "Profile photo", vehicleId: null } as any);
  await db.user.update({ where: { id: actor.id }, data: { imageDocumentId: out.document.id } });
  return { imageUrl: out.document.url };
}

export async function getActorForUserId(userId: string) {
  const u = await db.user.findUnique({ where: { id: userId }, include: { preference: true } });
  return u ? actorFromUser(u) : null;
}
