// Household setup, profile, members and privacy.
import { z } from "zod";
import { db, type Db } from "@/lib/db";
import { AppError, forbidden, notFound } from "@/lib/errors";
import { isValidTimezone } from "@/lib/dates";
import type { Actor } from "../context";
import { audit } from "../services/audit";
import { requireHouseholdAdmin } from "../services/access";
import { AVATAR_COLORS, EXPENSE_CATEGORIES, INCOME_CATEGORIES } from "./defaults";
import { currencyCode, id, optText } from "./common";
import { finCtx, type FinCtx } from "./access";

export const profileSchema = z.object({
  name: z.string().trim().min(1).max(80),
  countryCode: z.string().length(2).toUpperCase().default("CA"),
  region: z.string().trim().max(60).nullish(),
  city: z.string().trim().max(80).nullish(),
  currency: currencyCode.default("CAD"),
  timezone: z.string().refine(isValidTimezone, "Unknown time zone").optional(),
  fiscalYearStartMonth: z.number().int().min(1).max(12).default(1),
  dateFormat: z.enum(["YYYY-MM-DD", "DD/MM/YYYY", "MM/DD/YYYY", "D MMM YYYY"]).default("YYYY-MM-DD"),
  numberLocale: z.string().max(12).default("en-CA"),
  structure: z.string().trim().max(60).nullish(),
  goalsPreference: z.array(z.string().max(60)).max(20).default([]),
  budgetPeriod: z.enum(["WEEKLY", "MONTHLY", "ANNUAL"]).default("MONTHLY"),
  dashboardLayout: z.array(z.object({ id: z.string().max(40), visible: z.boolean() })).max(30).nullish(),
  completeOnboarding: z.boolean().optional(),
});

export async function seedDefaultCategories(c: Db, householdId: string) {
  let order = 0;
  for (const [kind, list] of [["EXPENSE", EXPENSE_CATEGORIES], ["INCOME", INCOME_CATEGORIES]] as const) {
    for (const cat of list) {
      const parent = await c.finCategory.create({ data: { householdId, name: cat.name, kind, isEssential: !!cat.essential, isSystem: !!cat.system, color: cat.color ?? null, sortOrder: order++ } });
      for (const child of cat.children ?? []) await c.finCategory.create({ data: { householdId, parentId: parent.id, name: child, kind, isEssential: !!cat.essential, color: cat.color ?? null, sortOrder: order++ } });
    }
  }
}

export async function createFinanceHousehold(actor: Actor, input: z.infer<typeof profileSchema>, opts: { demo?: boolean } = {}) {
  const h = await db.$transaction(async (tx) => {
    const hh = await tx.household.create({ data: { name: input.name, currency: input.currency, timezone: input.timezone ?? actor.prefs.timezone, countryCode: input.countryCode, region: input.region ?? null, city: input.city ?? null, fiscalYearStartMonth: input.fiscalYearStartMonth, dateFormat: input.dateFormat, numberLocale: input.numberLocale, structure: input.structure ?? null, goalsPreference: input.goalsPreference, budgetPeriod: input.budgetPeriod, dashboardLayout: input.dashboardLayout ?? undefined, isDemo: !!opts.demo, onboardedAt: input.completeOnboarding ? new Date() : null } });
    const m = await tx.householdMember.create({ data: { householdId: hh.id, userId: actor.id, role: "ADMIN", avatarColor: AVATAR_COLORS[0] } });
    await tx.memberPrivacy.create({ data: { householdMemberId: m.id } });
    await tx.subscription.create({ data: { householdId: hh.id } });
    await tx.finAlertSetting.create({ data: { userId: actor.id, householdId: hh.id } });
    await seedDefaultCategories(tx, hh.id);
    return hh;
  });
  await audit(null, actor, { entity: "Household", entityId: h.id, action: opts.demo ? "create-demo" : "create", householdId: h.id, after: { name: h.name, country: h.countryCode } });
  return { id: h.id };
}

export async function getProfile(ctx: FinCtx) {
  const h = ctx.household;
  return { id: h.id, name: h.name, countryCode: h.countryCode, region: h.region, city: h.city, currency: h.currency, timezone: h.timezone, fiscalYearStartMonth: h.fiscalYearStartMonth, dateFormat: h.dateFormat, numberLocale: h.numberLocale, structure: h.structure, goalsPreference: h.goalsPreference, budgetPeriod: h.budgetPeriod, dashboardLayout: h.dashboardLayout, onboarded: !!h.onboardedAt, isDemo: h.isDemo, myRole: ctx.me.role, myMemberId: ctx.me.id, canWrite: ctx.canWrite, today: ctx.today, hiddenAccountCount: ctx.hiddenAccountCount };
}

export async function updateProfile(ctx: FinCtx, input: Partial<z.infer<typeof profileSchema>>) {
  const d = input;
  await db.household.update({
    where: { id: ctx.householdId },
    data: {
      ...(d.name !== undefined ? { name: d.name } : {}), ...(d.countryCode !== undefined ? { countryCode: d.countryCode } : {}), ...(d.region !== undefined ? { region: d.region } : {}), ...(d.city !== undefined ? { city: d.city } : {}),
      ...(d.currency !== undefined ? { currency: d.currency } : {}), ...(d.timezone !== undefined ? { timezone: d.timezone } : {}), ...(d.fiscalYearStartMonth !== undefined ? { fiscalYearStartMonth: d.fiscalYearStartMonth } : {}),
      ...(d.dateFormat !== undefined ? { dateFormat: d.dateFormat } : {}), ...(d.numberLocale !== undefined ? { numberLocale: d.numberLocale } : {}), ...(d.structure !== undefined ? { structure: d.structure } : {}),
      ...(d.goalsPreference !== undefined ? { goalsPreference: d.goalsPreference } : {}), ...(d.budgetPeriod !== undefined ? { budgetPeriod: d.budgetPeriod } : {}), ...(d.dashboardLayout !== undefined ? { dashboardLayout: d.dashboardLayout ?? undefined } : {}),
      ...(d.completeOnboarding ? { onboardedAt: new Date() } : {}),
    },
  });
  await audit(null, ctx.actor, { entity: "Household", entityId: ctx.householdId, action: "update-profile", householdId: ctx.householdId, after: d });
  return { ok: true };
}

export const memberPatchSchema = z.object({
  role: z.enum(["ADMIN", "MEMBER", "READ_ONLY"]).optional(),
  responsibilities: optText(300),
  avatarColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).nullish(),
});
export const sharingSchema = z.object({
  income: z.enum(["PERSONAL", "HOUSEHOLD"]).optional(),
  accounts: z.enum(["PERSONAL", "HOUSEHOLD"]).optional(),
  transactions: z.enum(["PERSONAL", "HOUSEHOLD"]).optional(),
  savings: z.enum(["PERSONAL", "HOUSEHOLD"]).optional(),
  debts: z.enum(["PERSONAL", "HOUSEHOLD"]).optional(),
  other: z.enum(["PERSONAL", "HOUSEHOLD"]).optional(),
});

export async function listMembers(ctx: FinCtx) {
  const invites = ctx.isAdmin ? await db.householdInvite.findMany({ where: { householdId: ctx.householdId, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } } }) : [];
  return {
    members: ctx.members.map((m) => ({ id: m.id, userId: m.userId, name: m.name, email: ctx.isAdmin || m.userId === ctx.actor.id ? m.email : null, role: m.role, avatarColor: m.avatarColor, responsibilities: m.responsibilities, isMe: m.userId === ctx.actor.id, sharingDefaults: m.userId === ctx.actor.id ? m.defaults : undefined })),
    invites: invites.map((i) => ({ id: i.id, email: i.email, role: i.role, expiresAt: i.expiresAt.toISOString() })),
  };
}

/** Administrators manage roles and responsibilities. They cannot read or change anyone's private records or sharing choices. */
export async function updateMember(ctx: FinCtx, memberId: string, patch: z.infer<typeof memberPatchSchema>) {
  const target = ctx.members.find((m) => m.id === memberId);
  if (!target) throw notFound("Member");
  const self = target.userId === ctx.actor.id;
  if (patch.role !== undefined && !ctx.isAdmin) throw forbidden("Only household administrators can change roles");
  if (!self && !ctx.isAdmin) throw forbidden("You can only edit your own profile");
  if (patch.role && patch.role !== "ADMIN" && target.role === "ADMIN" && ctx.members.filter((m) => m.role === "ADMIN").length <= 1) throw new AppError("CONFLICT", "A household needs at least one administrator");
  await db.householdMember.update({ where: { id: memberId }, data: { ...(patch.role ? { role: patch.role } : {}), ...(patch.responsibilities !== undefined ? { responsibilities: patch.responsibilities } : {}), ...(patch.avatarColor !== undefined ? { avatarColor: patch.avatarColor } : {}) } });
  await audit(null, ctx.actor, { entity: "HouseholdMember", entityId: memberId, action: "update", householdId: ctx.householdId, after: patch });
  return { ok: true };
}

/** A member's own default visibility for the records they create. Only the member themselves can change it. */
export async function updateMySharing(ctx: FinCtx, patch: z.infer<typeof sharingSchema>) {
  const data = { ...(patch.income ? { incomeDefault: patch.income } : {}), ...(patch.accounts ? { accountsDefault: patch.accounts } : {}), ...(patch.transactions ? { transactionsDefault: patch.transactions } : {}), ...(patch.savings ? { savingsDefault: patch.savings } : {}), ...(patch.debts ? { debtsDefault: patch.debts } : {}), ...(patch.other ? { otherDefault: patch.other } : {}) };
  await db.memberPrivacy.upsert({ where: { householdMemberId: ctx.me.id }, create: { householdMemberId: ctx.me.id, ...data }, update: data });
  await audit(null, ctx.actor, { entity: "MemberPrivacy", entityId: ctx.me.id, action: "update-defaults", householdId: ctx.householdId, after: patch });
  return { ok: true };
}

export async function ensureMemberDefaults(householdId: string, userId: string) {
  const m = await db.householdMember.findUnique({ where: { householdId_userId: { householdId, userId } } });
  if (!m) return;
  await db.memberPrivacy.upsert({ where: { householdMemberId: m.id }, create: { householdMemberId: m.id }, update: {} });
  await db.finAlertSetting.upsert({ where: { userId_householdId: { userId, householdId } }, create: { userId, householdId }, update: {} });
  if (!m.avatarColor) await db.householdMember.update({ where: { id: m.id }, data: { avatarColor: AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)] } });
}

/** Idempotent: makes sure a household (e.g. one created before finance existed) has categories and member defaults. */
export async function ensureFinanceSetup(householdId: string) {
  if ((await db.finCategory.count({ where: { householdId } })) === 0) await db.$transaction((tx) => seedDefaultCategories(tx, householdId));
  const ms = await db.householdMember.findMany({ where: { householdId }, select: { userId: true } });
  for (const m of ms) await ensureMemberDefaults(householdId, m.userId);
}

export async function listFinanceHouseholds(actor: Actor) {
  const ms = await db.householdMember.findMany({ where: { userId: actor.id, household: { deletedAt: null } }, include: { household: true }, orderBy: { createdAt: "asc" } });
  for (const m of ms) await ensureFinanceSetup(m.householdId);
  return ms.map((m) => ({ id: m.householdId, name: m.household.name, role: m.role, onboarded: !!m.household.onboardedAt, isDemo: m.household.isDemo, currency: m.household.currency, countryCode: m.household.countryCode }));
}

export async function deleteDemoHousehold(actor: Actor, householdId: string) {
  await requireHouseholdAdmin(actor, householdId);
  const h = await db.household.findUnique({ where: { id: householdId } });
  if (!h) throw notFound("Household");
  if (!h.isDemo) throw new AppError("CONFLICT", "Only demonstration households can be removed this way");
  const members = await db.householdMember.findMany({ where: { householdId }, select: { userId: true } });
  await db.$transaction(async (tx) => {
    await tx.household.delete({ where: { id: householdId } });
    // demo partner users are created without a password and exist only for the demo household
    await tx.user.deleteMany({ where: { id: { in: members.map((m) => m.userId) }, email: { endsWith: "@demo.invalid" } } });
  });
  await audit(null, actor, { entity: "Household", entityId: householdId, action: "delete-demo" });
  return { ok: true };
}
export { finCtx, id };
