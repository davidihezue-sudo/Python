// Pay day plans: split a paycheck into transfers to accounts and goals with one click. Each plan belongs to one member and is private to them.
import { z } from "zod";
import { db } from "@/lib/db";
import { AppError, conflict, notFound } from "@/lib/errors";
import { audit } from "../services/audit";
import { D, money } from "./engine/decimal";
import { resolvePayday, type PaydayLine } from "./engine/payday";
import { requireAccount, requireWriter, type FinCtx } from "./access";
import { id, isoDate, moneyIn, posMoney, text } from "./common";
import { createTransfer } from "./transactions";
import { addContribution } from "./goals";

const lineSchema = z.object({ label: text(60), mode: z.enum(["AMOUNT", "PERCENT"]), value: z.union([z.string(), z.number()]).transform((v) => String(v)).refine((s) => /^\d{1,9}(\.\d{1,4})?$/.test(s) && Number(s) > 0, "Enter a positive number"), toAccountId: id.nullish(), goalId: id.nullish() })
  .refine((l) => !!(l.toAccountId || l.goalId), "Choose an account or a goal for each line")
  .refine((l) => l.mode !== "PERCENT" || Number(l.value) <= 100, "A percentage cannot be more than 100");
export const planSchema = z.object({ name: text(60), sourceAccountId: id, incomeSourceId: id.nullish(), lines: z.array(lineSchema).min(1).max(12), active: z.boolean().default(true) });
export const planPatchSchema = planSchema.partial();
export const runSchema = z.object({ date: isoDate, paycheck: posMoney.optional(), force: z.boolean().default(false) });

type Plan = Awaited<ReturnType<typeof db.paydayPlan.findFirstOrThrow>>;
const lines = (p: Plan) => p.lines as unknown as z.infer<typeof lineSchema>[];
async function view(ctx: FinCtx, p: Plan) {
  const income = p.incomeSourceId ? await db.incomeSource.findFirst({ where: { id: p.incomeSourceId, householdId: ctx.householdId, deletedAt: null }, select: { name: true, netAmount: true } }) : null;
  const expected = income?.netAmount.toString() ?? null;
  return { id: p.id, name: p.name, sourceAccountId: p.sourceAccountId, incomeSourceId: p.incomeSourceId, incomeName: income?.name ?? null, expectedPaycheck: expected ? money(expected) : null, lines: lines(p), active: p.active, lastRunOn: p.lastRunOn?.toISOString().slice(0, 10) ?? null, preview: expected ? resolvePayday(expected, lines(p) as PaydayLine[]) : null };
}
const mine = (ctx: FinCtx) => ({ householdId: ctx.householdId, ownerMemberId: ctx.me.id });

export async function listPlans(ctx: FinCtx) {
  const rows = await db.paydayPlan.findMany({ where: mine(ctx), orderBy: { createdAt: "asc" } });
  return Promise.all(rows.map((p) => view(ctx, p)));
}
async function checkRefs(ctx: FinCtx, i: { sourceAccountId?: string; incomeSourceId?: string | null; lines?: z.infer<typeof lineSchema>[] }) {
  if (i.sourceAccountId) await requireAccount(ctx, i.sourceAccountId, { write: true });
  if (i.incomeSourceId && !(await db.incomeSource.findFirst({ where: { id: i.incomeSourceId, householdId: ctx.householdId, deletedAt: null, ownerMemberId: ctx.me.id } }))) throw new AppError("VALIDATION_ERROR", "Choose one of your own income sources");
  for (const l of i.lines ?? []) {
    if (l.toAccountId) await requireAccount(ctx, l.toAccountId, { write: true });
    if (l.goalId && !(await db.savingsGoal.findFirst({ where: { id: l.goalId, householdId: ctx.householdId, deletedAt: null } }))) throw notFound("Goal");
  }
}
export async function createPlan(ctx: FinCtx, input: z.infer<typeof planSchema>) {
  requireWriter(ctx);
  await checkRefs(ctx, input);
  const p = await db.paydayPlan.create({ data: { householdId: ctx.householdId, ownerMemberId: ctx.me.id, name: input.name, sourceAccountId: input.sourceAccountId, incomeSourceId: input.incomeSourceId ?? null, lines: input.lines as object[], active: input.active } });
  return { id: p.id };
}
async function owned(ctx: FinCtx, planId: string) {
  requireWriter(ctx);
  const p = await db.paydayPlan.findFirst({ where: { id: planId, ...mine(ctx) } });
  if (!p) throw notFound("Plan");
  return p;
}
export async function updatePlan(ctx: FinCtx, planId: string, patch: z.infer<typeof planPatchSchema>) {
  const p = await owned(ctx, planId);
  await checkRefs(ctx, patch);
  await db.paydayPlan.update({ where: { id: p.id }, data: { ...(patch.name !== undefined ? { name: patch.name } : {}), ...(patch.sourceAccountId ? { sourceAccountId: patch.sourceAccountId } : {}), ...(patch.incomeSourceId !== undefined ? { incomeSourceId: patch.incomeSourceId } : {}), ...(patch.lines ? { lines: patch.lines as object[] } : {}), ...(patch.active !== undefined ? { active: patch.active } : {}) } });
  return { id: p.id };
}
export async function deletePlan(ctx: FinCtx, planId: string) {
  const p = await owned(ctx, planId);
  await db.paydayPlan.delete({ where: { id: p.id } });
  return { ok: true };
}

/** Runs the plan: one transfer (or goal contribution) per line from the source account. Every account and goal is checked before anything moves. */
export async function runPlan(ctx: FinCtx, planId: string, input: z.infer<typeof runSchema>) {
  const p = await owned(ctx, planId);
  if (!p.active) throw conflict("This plan is switched off");
  const ls = lines(p);
  await checkRefs(ctx, { sourceAccountId: p.sourceAccountId, lines: ls });
  for (const l of ls) if (l.goalId) { const g = await db.savingsGoal.findUnique({ where: { id: l.goalId } }); if (g?.tracking !== "CONTRIBUTIONS" || !g.accountId) throw new AppError("VALIDATION_ERROR", `The goal for "${l.label}" must track contributions and have a savings account`); }
  const paycheck = input.paycheck ?? (p.incomeSourceId ? (await db.incomeSource.findUnique({ where: { id: p.incomeSourceId }, select: { netAmount: true } }))?.netAmount.toString() : undefined);
  if (!paycheck) throw new AppError("VALIDATION_ERROR", "Enter the paycheck amount", { fieldErrors: { paycheck: ["Required"] } });
  const r = resolvePayday(paycheck, ls as PaydayLine[]);
  if (r.over) throw new AppError("VALIDATION_ERROR", `The plan moves ${r.total}, which is more than the paycheck of ${money(paycheck)}`);
  if (!input.force && p.lastRunOn && p.lastRunOn.toISOString().slice(0, 10) === input.date) throw conflict("This plan already ran for that date. Run it again only if you are sure.");
  const done: { label: string; amount: string }[] = [];
  for (let i = 0; i < ls.length; i++) {
    const l = ls[i], amount = r.lines[i].amount;
    if (D(amount).lte(0)) continue;
    if (l.goalId) await addContribution(ctx, l.goalId, { date: input.date, amount: moneyIn.parse(amount), fromAccountId: p.sourceAccountId, memberId: ctx.me.id } as never);
    else await createTransfer(ctx, { fromAccountId: p.sourceAccountId, toAccountId: l.toAccountId as string, amount: posMoney.parse(amount), date: input.date, description: `Pay day plan: ${l.label}` } as never);
    done.push({ label: l.label, amount });
  }
  await db.paydayPlan.update({ where: { id: p.id }, data: { lastRunOn: new Date(`${input.date}T00:00:00Z`) } });
  await audit(null, ctx.actor, { entity: "PaydayPlan", entityId: p.id, action: "run", householdId: ctx.householdId, after: { date: input.date, total: r.total } });
  return { ...r, done };
}
