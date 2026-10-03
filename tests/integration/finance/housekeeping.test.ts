import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createDemoHousehold } from "@/server/finance/demo";
import { clearMyRecords, deleteHousehold } from "@/server/finance/housekeeping";
import { listAccounts, verifyAccountBalance } from "@/server/finance/accounts";
import { createFinanceHousehold } from "@/server/finance/household";
import { account, ctxFor, spend, coupleHousehold } from "./helpers";
import { createActor } from "../helpers";

describe("starting fresh", () => {
  it("clears only what the member owns and leaves the partner and joint records consistent", async () => {
    const david = await createActor("David", "david-fresh@example.com");
    const { id } = await createDemoHousehold(david);
    const ctx = await ctxFor(david, id, "write");
    const mine = ctx.me.id;
    const partnerId = ctx.members.find((m) => m.id !== mine)!.id;

    const before = {
      partnerAccounts: await db.finAccount.count({ where: { householdId: id, ownerMemberId: partnerId } }),
      jointAccounts: await db.finAccount.count({ where: { householdId: id, ownerMemberId: null } }),
      partnerIncome: await db.incomeSource.count({ where: { householdId: id, ownerMemberId: partnerId } }),
    };
    expect(before.partnerAccounts).toBeGreaterThan(0);

    const res = await clearMyRecords(ctx);
    expect(res.removed.accounts).toBeGreaterThan(0);

    expect(await db.finAccount.count({ where: { householdId: id, ownerMemberId: mine } })).toBe(0);
    expect(await db.finTransaction.count({ where: { householdId: id, ownerMemberId: mine } })).toBe(0);
    expect(await db.incomeSource.count({ where: { householdId: id, ownerMemberId: mine } })).toBe(0);
    expect(await db.debt.count({ where: { householdId: id, ownerMemberId: mine } })).toBe(0);
    // untouched: the partner's records and the joint accounts
    expect(await db.finAccount.count({ where: { householdId: id, ownerMemberId: partnerId } })).toBe(before.partnerAccounts);
    expect(await db.finAccount.count({ where: { householdId: id, ownerMemberId: null } })).toBe(before.jointAccounts);
    expect(await db.incomeSource.count({ where: { householdId: id, ownerMemberId: partnerId } })).toBe(before.partnerIncome);
    // no transfer is left with a single leg
    const legs = await db.finTransaction.groupBy({ by: ["transferGroupId"], where: { householdId: id, transferGroupId: { not: null } }, _count: { _all: true } });
    expect(legs.every((g) => g._count._all === 2)).toBe(true);
    // every remaining account still reconciles to its own ledger
    for (const a of (await listAccounts(await ctxFor(david, id, "write"), "all")).items) expect((await verifyAccountBalance(await ctxFor(david, id, "write"), a.id)).matches).toBe(true);
  });

  it("never lets one member clear another member's records", async () => {
    const { david, sharon, householdId } = await coupleHousehold();
    const s = await ctxFor(sharon, householdId, "write");
    const acct = await account(s, "Sharon private", { visibility: "PERSONAL" });
    await spend(s, acct, "Groceries", "40.00", { visibility: "PERSONAL" });
    await clearMyRecords(await ctxFor(david, householdId, "write"));
    expect(await db.finAccount.count({ where: { id: acct } })).toBe(1);
    expect(await db.finTransaction.count({ where: { accountId: acct } })).toBe(1);
  });

  it("deletes a household only for its sole member, after typing its name", async () => {
    const { david, householdId } = await coupleHousehold();
    const shared = await ctxFor(david, householdId, "admin");
    await expect(deleteHousehold(shared, { confirm: shared.household.name })).rejects.toMatchObject({ code: "CONFLICT" });

    const solo = await createActor("Solo", "solo-fresh@example.com");
    const { id } = await createFinanceHousehold(solo, { name: "My own", countryCode: "CA", currency: "CAD" } as never);
    const c = await ctxFor(solo, id, "admin");
    await expect(deleteHousehold(c, { confirm: "wrong name" })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await deleteHousehold(c, { confirm: "My own" });
    expect(await db.household.count({ where: { id } })).toBe(0);
  });
});
