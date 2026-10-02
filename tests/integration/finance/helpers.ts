import { db } from "@/lib/db";
import { acceptInvite, createInvite, listHouseholds } from "@/server/services/households";
import { finCtx } from "@/server/finance/access";
import { ensureFinanceSetup } from "@/server/finance/household";
import { createAccount } from "@/server/finance/accounts";
import { createTransaction } from "@/server/finance/transactions";
import { listCategories } from "@/server/finance/categories";
import type { Actor } from "@/server/context";
import { createActor } from "../helpers";

/** David (administrator) and Sharon (member) in one household, each with their own login. */
export async function coupleHousehold() {
  const david = await createActor("David", "david@example.com");
  const sharon = await createActor("Sharon", "sharon@example.com");
  const hh = (await listHouseholds(david))[0];
  const inv = await createInvite(david, hh.id, { email: sharon.email, role: "MEMBER", vehicleAccess: [] } as never);
  await acceptInvite(sharon, inv.inviteUrl.split("/invite/")[1]);
  await ensureFinanceSetup(hh.id);
  return { david, sharon, householdId: hh.id };
}
export const ctxFor = (a: Actor, householdId: string, need: "read" | "write" | "admin" = "read") => finCtx(a, householdId, need);

export async function catId(ctx: Awaited<ReturnType<typeof finCtx>>, name: string, kind: "EXPENSE" | "INCOME" = "EXPENSE") {
  const c = (await listCategories(ctx)).find((x) => x.name === name && x.kind === kind);
  if (!c) throw new Error(`category ${name}`);
  return c.id;
}
export async function account(ctx: Awaited<ReturnType<typeof finCtx>>, name: string, extra: Record<string, unknown> = {}) {
  return (await createAccount(ctx, { name, type: "CHEQUING", openingBalance: "5000.00", openingDate: "2026-01-01", ...extra } as never)).id;
}
export async function spend(ctx: Awaited<ReturnType<typeof finCtx>>, accountId: string, category: string, amount: string, extra: Record<string, unknown> = {}, date = "2026-03-10") {
  return createTransaction(ctx, { type: "EXPENSE", accountId, amount, date, description: `${category} ${amount}`, categoryId: await catId(ctx, category), force: true, ...extra } as never);
}
export { db };
