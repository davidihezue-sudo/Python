import { db } from "@/lib/db";
import { AppError, conflict, forbidden, notFound } from "@/lib/errors";
import { randomToken, sha256 } from "@/lib/crypto";
import { inviteMessage, sendEmail } from "@/lib/email";
import { LEVEL_DEFAULT_FINANCIALS } from "@/lib/permissions";
import { householdSchema, inviteSchema } from "@/lib/validation";
import type { z } from "zod";
import type { Actor } from "../context";
import { ts } from "../serialize";
import { requireHouseholdAdmin, requireHouseholdMember } from "./access";
import { audit } from "./audit";
import { describeEntitlements, requireFeature } from "./entitlements";

export async function listHouseholds(actor: Actor) {
  const ms = await db.householdMember.findMany({ where: { userId: actor.id, household: { deletedAt: null } }, include: { household: { include: { members: { include: { user: { select: { id: true, name: true, email: true } } }, orderBy: { createdAt: "asc" } }, vehicles: { where: { deletedAt: null }, select: { id: true, nickname: true } }, invites: { where: { acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" } } } } }, orderBy: { createdAt: "asc" } });
  const out = [];
  for (const m of ms) {
    const isAdmin = m.role === "ADMIN";
    const grants = isAdmin ? await db.vehicleAccess.findMany({ where: { vehicle: { householdId: m.householdId, deletedAt: null } } }) : [];
    out.push({
      id: m.householdId,
      name: m.household.name,
      timezone: m.household.timezone,
      currency: m.household.currency,
      myRole: m.role,
      entitlements: isAdmin ? await describeEntitlements(m.householdId) : null,
      vehicles: m.household.vehicles.map((v) => ({ id: v.id, name: v.nickname })),
      members: m.household.members.map((x) => ({ userId: x.userId, name: x.user.name, email: isAdmin || x.userId === actor.id ? x.user.email : null, role: x.role, joinedAt: ts(x.createdAt), vehicleAccess: grants.filter((g) => g.userId === x.userId).map((g) => ({ vehicleId: g.vehicleId, level: g.level, canViewFinancials: g.canViewFinancials })) })),
      invites: isAdmin ? m.household.invites.map((i) => ({ id: i.id, email: i.email, role: i.role, vehicleAccess: i.vehicleAccess, expiresAt: ts(i.expiresAt), createdAt: ts(i.createdAt) })) : [],
    });
  }
  return out;
}

export async function createHousehold(actor: Actor, input: z.infer<typeof householdSchema>) {
  const hh = await db.$transaction(async (tx) => {
    const h = await tx.household.create({ data: { name: input.name, timezone: input.timezone ?? actor.prefs.timezone, currency: input.currency ?? actor.prefs.currency } });
    await tx.householdMember.create({ data: { householdId: h.id, userId: actor.id, role: "ADMIN" } });
    await tx.subscription.create({ data: { householdId: h.id } });
    return h;
  });
  await audit(null, actor, { entity: "Household", entityId: hh.id, action: "create", householdId: hh.id, after: { name: hh.name } });
  return { id: hh.id };
}

export async function updateHousehold(actor: Actor, id: string, input: Partial<z.infer<typeof householdSchema>>) {
  await requireHouseholdAdmin(actor, id);
  await db.household.update({ where: { id }, data: { ...(input.name ? { name: input.name } : {}), ...(input.timezone ? { timezone: input.timezone } : {}), ...(input.currency ? { currency: input.currency } : {}) } });
  await audit(null, actor, { entity: "Household", entityId: id, action: "update", householdId: id, after: input });
  return { id };
}

export async function createInvite(actor: Actor, householdId: string, input: z.infer<typeof inviteSchema>) {
  await requireHouseholdAdmin(actor, householdId);
  await requireFeature(householdId, "familySharing");
  const hh = await db.household.findUniqueOrThrow({ where: { id: householdId } });
  const email = input.email.toLowerCase();
  const already = await db.householdMember.findFirst({ where: { householdId, user: { email } } });
  if (already) throw conflict("That person is already a member of this household");
  if (input.vehicleAccess.length) {
    const ok = await db.vehicle.count({ where: { id: { in: input.vehicleAccess.map((v) => v.vehicleId) }, householdId, deletedAt: null } });
    if (ok !== new Set(input.vehicleAccess.map((v) => v.vehicleId)).size) throw new AppError("VALIDATION_ERROR", "One of the selected vehicles does not belong to this household");
  }
  await db.householdInvite.updateMany({ where: { householdId, email, acceptedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
  const token = randomToken(32);
  const invite = await db.householdInvite.create({
    data: { householdId, email, role: input.role, tokenHash: sha256(token), vehicleAccess: input.vehicleAccess.map((v) => ({ ...v, canViewFinancials: v.canViewFinancials ?? LEVEL_DEFAULT_FINANCIALS[v.level] })), invitedById: actor.id, expiresAt: new Date(Date.now() + 7 * 86400_000) },
  });
  const m = inviteMessage(actor.name, hh.name, token);
  await sendEmail(email, m.subject, m.text, m.html);
  await audit(null, actor, { entity: "HouseholdInvite", entityId: invite.id, action: "create", householdId, after: { email, role: input.role } });
  // The token is only returned so an admin can also share the link manually (e.g. when email isn't configured).
  return { id: invite.id, inviteUrl: `${process.env.APP_URL ?? ""}/invite/${token}` };
}

export async function revokeInvite(actor: Actor, inviteId: string) {
  const inv = await db.householdInvite.findUnique({ where: { id: inviteId } });
  if (!inv) throw notFound("Invitation");
  await requireHouseholdAdmin(actor, inv.householdId);
  await db.householdInvite.update({ where: { id: inviteId }, data: { revokedAt: new Date() } });
  return { ok: true };
}

export async function getInvitePreview(token: string) {
  const inv = await db.householdInvite.findUnique({ where: { tokenHash: sha256(token) }, include: { household: true, invitedBy: { select: { name: true } } } });
  if (!inv || inv.revokedAt || inv.acceptedAt || inv.expiresAt < new Date()) throw new AppError("BAD_REQUEST", "This invitation is invalid, expired or already used.");
  return { householdName: inv.household.name, invitedBy: inv.invitedBy.name, email: inv.email, role: inv.role };
}

export async function acceptInvite(actor: Actor, token: string) {
  const inv = await db.householdInvite.findUnique({ where: { tokenHash: sha256(token) } });
  if (!inv || inv.revokedAt || inv.acceptedAt || inv.expiresAt < new Date()) throw new AppError("BAD_REQUEST", "This invitation is invalid, expired or already used.");
  if (inv.email !== actor.email.toLowerCase()) throw forbidden(`This invitation was sent to ${inv.email}. Sign in with that address to accept it.`);
  if (!actor.emailVerified) throw forbidden("Verify your email address before accepting an invitation.");
  const grants = (inv.vehicleAccess as unknown as { vehicleId: string; level: any; canViewFinancials: boolean }[]) ?? [];
  await db.$transaction(async (tx) => {
    await tx.householdMember.upsert({ where: { householdId_userId: { householdId: inv.householdId, userId: actor.id } }, create: { householdId: inv.householdId, userId: actor.id, role: inv.role }, update: {} });
    for (const g of grants) {
      const v = await tx.vehicle.findFirst({ where: { id: g.vehicleId, householdId: inv.householdId, deletedAt: null } });
      if (!v) continue;
      await tx.vehicleAccess.upsert({ where: { vehicleId_userId: { vehicleId: g.vehicleId, userId: actor.id } }, create: { vehicleId: g.vehicleId, userId: actor.id, level: g.level, canViewFinancials: g.canViewFinancials }, update: { level: g.level, canViewFinancials: g.canViewFinancials } });
    }
    await tx.householdInvite.update({ where: { id: inv.id }, data: { acceptedAt: new Date() } });
    await audit(tx, actor, { entity: "HouseholdMember", action: "join", householdId: inv.householdId, after: { role: inv.role } });
  });
  return { householdId: inv.householdId };
}

export async function updateMember(actor: Actor, householdId: string, userId: string, input: { role?: "ADMIN" | "MEMBER" | "READ_ONLY" }) {
  await requireHouseholdAdmin(actor, householdId);
  const m = await db.householdMember.findUnique({ where: { householdId_userId: { householdId, userId } } });
  if (!m) throw notFound("Member");
  if (input.role && input.role !== "ADMIN" && m.role === "ADMIN") {
    const admins = await db.householdMember.count({ where: { householdId, role: "ADMIN" } });
    if (admins <= 1) throw conflict("A household needs at least one administrator");
  }
  await db.householdMember.update({ where: { id: m.id }, data: { ...(input.role ? { role: input.role } : {}) } });
  await audit(null, actor, { entity: "HouseholdMember", entityId: m.id, action: "update-role", householdId, before: { role: m.role }, after: input });
  return { ok: true };
}

export async function removeMember(actor: Actor, householdId: string, userId: string) {
  const self = userId === actor.id;
  if (!self) await requireHouseholdAdmin(actor, householdId);
  else await requireHouseholdMember(actor, householdId);
  const m = await db.householdMember.findUnique({ where: { householdId_userId: { householdId, userId } } });
  if (!m) throw notFound("Member");
  if (m.role === "ADMIN") {
    const admins = await db.householdMember.count({ where: { householdId, role: "ADMIN" } });
    if (admins <= 1) throw conflict("A household needs at least one administrator. Promote another member first.");
  }
  await db.$transaction(async (tx) => {
    await tx.vehicleAccess.deleteMany({ where: { userId, vehicle: { householdId } } });
    await tx.householdMember.delete({ where: { id: m.id } });
    await audit(tx, actor, { entity: "HouseholdMember", entityId: m.id, action: self ? "leave" : "remove", householdId });
  });
  return { ok: true };
}
