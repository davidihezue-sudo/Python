// RRSP, TFSA and FHSA room tracker. The person enters the room from their CRA notice; contributions come from their investment entries.
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "../services/audit";
import { D, ZERO } from "./engine/decimal";
import { LIMITS_SOURCE, REGISTERED_KINDS, REGISTERED_LIMITS, registeredRoom, rrspLimitFromIncome } from "./engine/registered";
import { requireWriter, type FinCtx } from "./access";
import { nonNegMoney, optText, toDate } from "./common";

export const roomQuery = z.object({ year: z.coerce.number().int().min(2009).max(2100).optional() });
export const roomSchema = z.object({ kind: z.enum(["RRSP", "TFSA", "FHSA"]), year: z.number().int().min(2009).max(2100), openingRoom: nonNegMoney, note: optText(300) });

/** Always the signed-in member's own room: this is personal tax information and is never shown to other members. */
export async function registeredStatus(ctx: FinCtx, q: z.infer<typeof roomQuery>) {
  const year = q.year ?? Number(ctx.today.slice(0, 4));
  const from = toDate(`${year}-01-01`), to = toDate(`${year}-12-31`);
  const [rooms, entries, profiles] = await Promise.all([
    db.registeredRoom.findMany({ where: { householdId: ctx.householdId, memberId: ctx.me.id, year } }),
    db.investmentEntry.findMany({ where: { deletedAt: null, date: { gte: from, lte: to }, profile: { householdId: ctx.householdId, kind: { in: [...REGISTERED_KINDS] }, account: { ownerMemberId: ctx.me.id, deletedAt: null } } }, include: { profile: { select: { kind: true } } } }),
    db.investmentProfile.findMany({ where: { householdId: ctx.householdId, kind: { in: [...REGISTERED_KINDS] }, account: { ownerMemberId: ctx.me.id, deletedAt: null } }, include: { account: { select: { name: true } } } }),
  ]);
  const items = REGISTERED_KINDS.map((kind) => {
    const room = rooms.find((r) => r.kind === kind);
    const sum = (k: "CONTRIBUTION" | "WITHDRAWAL") => entries.filter((e) => e.profile.kind === kind && e.kind === k).reduce((a, e) => a.plus(D(e.amount)), ZERO);
    const base = registeredRoom({ kind, openingRoom: room?.openingRoom.toString() ?? "0", contributed: sum("CONTRIBUTION").toFixed(2), withdrawn: sum("WITHDRAWAL").toFixed(2) });
    const ref = REGISTERED_LIMITS[year];
    return { ...base, hasRoom: !!room, note: room?.note ?? null, accounts: profiles.filter((p) => p.kind === kind).map((p) => p.account.name), referenceLimit: ref ? (kind === "TFSA" ? { annual: ref.TFSA } : kind === "RRSP" ? { dollarLimit: ref.RRSPDollarLimit } : { annual: ref.FHSAAnnual, lifetime: ref.FHSALifetime }) : null };
  });
  return { year, currency: ctx.base, items, source: LIMITS_SOURCE, privacy: "This is personal tax information. Only you can see it.", years: Object.keys(REGISTERED_LIMITS).map(Number) };
}

export async function saveRoom(ctx: FinCtx, input: z.infer<typeof roomSchema>) {
  requireWriter(ctx);
  const data = { openingRoom: input.openingRoom, note: input.note ?? null };
  await db.registeredRoom.upsert({ where: { memberId_kind_year: { memberId: ctx.me.id, kind: input.kind, year: input.year } }, create: { householdId: ctx.householdId, memberId: ctx.me.id, kind: input.kind, year: input.year, ...data }, update: data });
  await audit(null, ctx.actor, { entity: "RegisteredRoom", action: "save", householdId: ctx.householdId, after: { kind: input.kind, year: input.year } });
  return { ok: true };
}

export const rrspHelperQuery = z.object({ priorYearIncome: nonNegMoney, year: z.coerce.number().int().min(2009).max(2100) });
export const rrspHelper = (q: z.infer<typeof rrspHelperQuery>) => ({ year: q.year, limit: rrspLimitFromIncome(q.priorYearIncome, q.year), basis: "18 percent of last year's earned income, up to the dollar limit. Your CRA notice of assessment shows the exact figure, including any unused room carried forward." });
