// "If something happens to me": a page the owner writes for people they trust, plus an automatic list of the records they own.
// Authorisation is explicit consent: the owner names who may read it. Every read by someone else is recorded and the owner is told.
// Children and accountants can never be named.
import { z } from "zod";
import { db } from "@/lib/db";
import { forbidden, notFound } from "@/lib/errors";
import { audit } from "../services/audit";
import { money } from "./engine/decimal";
import { currentBalance } from "./accounts";
import { id, text } from "./common";
import { requireWriter, type FinCtx } from "./access";

const TRUSTABLE = ["ADMIN", "MEMBER", "READ_ONLY"];
export const DEFAULT_SECTIONS = [
  { title: "Who to call first", body: "" },
  { title: "Where my important papers are", body: "" },
  { title: "How to get into my accounts", body: "Say where the password manager or the written list is kept. Do not type passwords here." },
  { title: "My wishes", body: "" },
  { title: "Work, benefits and pensions", body: "" },
  { title: "Anything else", body: "" },
];
const section = z.object({ title: text(80), body: z.string().max(5000).default("") });
export const legacySchema = z.object({ sections: z.array(section).max(12), trustedMemberIds: z.array(id).max(10), includeBalances: z.boolean().default(false) });

/** The owner's own records, listed without amounts unless the owner chose to include balances. Joint records are not "mine", so they are left to the household. */
async function summary(ctx: FinCtx, ownerMemberId: string, balances: boolean) {
  const own = { householdId: ctx.householdId, ownerMemberId, deletedAt: null };
  const [accounts, insurance, debts, income, assets, bills, subs] = await Promise.all([
    db.finAccount.findMany({ where: { ...own, status: "ACTIVE" }, orderBy: { name: "asc" } }),
    db.insurancePolicy.findMany({ where: { ...own, active: true }, orderBy: { provider: "asc" } }),
    db.debt.findMany({ where: { ...own, active: true }, orderBy: { lender: "asc" } }),
    db.incomeSource.findMany({ where: { ...own, active: true }, orderBy: { name: "asc" } }),
    db.asset.findMany({ where: own, orderBy: { name: "asc" } }),
    db.bill.findMany({ where: { ...own, active: true }, orderBy: { name: "asc" } }),
    db.recurringSubscription.findMany({ where: { ...own, active: true }, orderBy: { name: "asc" } }),
  ]);
  const accountRows = [];
  for (const a of accounts) accountRows.push({ name: a.name, institution: a.institution, type: a.type, currency: a.currency, balance: balances ? money(await currentBalance(ctx.householdId, a)) : null });
  return {
    accounts: accountRows,
    insurance: insurance.map((p) => ({ provider: p.provider, name: p.policyName, kind: p.kind, policyNumberLast4: p.policyNumberLast4, beneficiary: p.beneficiary })),
    debts: debts.map((d) => ({ lender: d.lender, type: d.type })),
    income: income.map((i) => ({ name: i.name, employer: i.employer, kind: i.kind })),
    assets: assets.map((a) => ({ name: a.name, kind: a.kind })),
    bills: bills.map((b) => ({ name: b.name, provider: b.provider })),
    subscriptions: subs.map((s) => ({ name: s.name, provider: s.provider })),
    note: balances ? "Balances are included because the owner chose to include them." : "Amounts are left out. The owner can choose to include balances.",
  };
}

const owner = (ctx: FinCtx, memberId: string) => ctx.members.find((m) => m.id === memberId);

export async function getMyLegacy(ctx: FinCtx) {
  const p = await db.legacyPlan.findUnique({ where: { householdId_memberId: { householdId: ctx.householdId, memberId: ctx.me.id } } });
  const sections = (p?.sections as { title: string; body: string }[] | undefined)?.length ? (p!.sections as { title: string; body: string }[]) : DEFAULT_SECTIONS;
  const trusted = (p?.trustedMemberIds ?? []).filter((m) => ctx.members.some((x) => x.id === m));
  return {
    sections, trustedMemberIds: trusted, includeBalances: p?.includeBalances ?? false, updatedAt: p?.updatedAt.toISOString() ?? null,
    candidates: ctx.members.filter((m) => m.id !== ctx.me.id && TRUSTABLE.includes(m.role)).map((m) => ({ id: m.id, name: m.name })),
    summary: await summary(ctx, ctx.me.id, p?.includeBalances ?? false),
    privacy: "Only you can edit this. Only the people you choose can read it, and you are told whenever one of them opens it.",
  };
}

export async function saveMyLegacy(ctx: FinCtx, input: z.infer<typeof legacySchema>) {
  requireWriter(ctx);
  const trusted = [...new Set(input.trustedMemberIds)].filter((m) => m !== ctx.me.id);
  for (const t of trusted) { const m = owner(ctx, t); if (!m || !TRUSTABLE.includes(m.role)) throw forbidden("That person cannot be named here"); }
  const data = { sections: input.sections as object, trustedMemberIds: trusted, includeBalances: input.includeBalances };
  await db.legacyPlan.upsert({ where: { householdId_memberId: { householdId: ctx.householdId, memberId: ctx.me.id } }, create: { householdId: ctx.householdId, memberId: ctx.me.id, ...data }, update: data });
  await audit(null, ctx.actor, { entity: "LegacyPlan", action: "save", householdId: ctx.householdId, after: { trusted: trusted.length, sections: input.sections.length } });
  return { ok: true };
}

/** Pages other members have shared with me. Nothing about their content is shown in the list. */
export async function sharedWithMe(ctx: FinCtx) {
  const rows = await db.legacyPlan.findMany({ where: { householdId: ctx.householdId, trustedMemberIds: { has: ctx.me.id } } });
  return rows.map((r) => ({ ownerMemberId: r.memberId, owner: owner(ctx, r.memberId)?.name ?? "Someone", updatedAt: r.updatedAt.toISOString() })).filter((r) => r.owner !== "Someone");
}

export async function readSharedLegacy(ctx: FinCtx, ownerMemberId: string) {
  const p = await db.legacyPlan.findUnique({ where: { householdId_memberId: { householdId: ctx.householdId, memberId: ownerMemberId } } });
  const o = owner(ctx, ownerMemberId);
  // Anyone who is not named gets the same answer as for a page that does not exist.
  if (!p || !o || !p.trustedMemberIds.includes(ctx.me.id) || !TRUSTABLE.includes(ctx.me.role)) throw notFound("Page");
  await audit(null, ctx.actor, { entity: "LegacyPlan", entityId: p.id, action: "read", householdId: ctx.householdId });
  await db.notification.create({ data: { userId: o.userId, householdId: ctx.householdId, type: "SYSTEM", severity: "INFO", title: `${ctx.me.name} opened your "If something happens to me" page`, body: "You named them as someone you trust.", actionUrl: "/emergency", dedupeKey: `legacy-read:${p.id}:${ctx.me.id}:${Date.now()}`, deliveredInAppAt: new Date() } });
  const sections = (p.sections as { title: string; body: string }[]) ?? [];
  return { owner: o.name, updatedAt: p.updatedAt.toISOString(), sections, summary: await summary(ctx, ownerMemberId, p.includeBalances) };
}
