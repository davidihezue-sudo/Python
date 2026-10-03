import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { account, coupleHousehold, ctxFor, db, spend } from "./helpers";
import { createActor } from "../helpers";
import { acceptInvite, createInvite, listHouseholds } from "@/server/services/households";
import { listAccounts } from "@/server/finance/accounts";
import { createTransaction, listTransactions, txQuerySchema } from "@/server/finance/transactions";
import { assertAreaAllowed, finCtx } from "@/server/finance/access";
import { addComment, createWish, decideWish, deleteComment, listComments, listWishes, updateWishStatus } from "@/server/finance/people";
import { authenticateBearer, createToken, listTokens, revokeToken } from "@/server/finance/tokens";
import { dispatch } from "@/server/finance/router";
import { ensureFinanceSetup } from "@/server/finance/household";
import { accessibleVehicles } from "@/server/services/access";
import { createTestVehicle } from "../helpers";
import { setVehicleAccess } from "@/server/services/vehicles";

const q = (o: Record<string, unknown> = {}) => txQuerySchema.parse(o);
type Role = "CHILD" | "ACCOUNTANT" | "MEMBER";
async function addMember(admin: Awaited<ReturnType<typeof createActor>>, householdId: string, name: string, email: string, role: Role, accessUntil?: string) {
  const a = await createActor(name, email);
  const inv = await createInvite(admin, householdId, { email, role, vehicleAccess: [], accessUntil: accessUntil ?? null } as never);
  await acceptInvite(a, inv.inviteUrl.split("/invite/")[1]);
  await ensureFinanceSetup(householdId);
  return a;
}
const rejects = async (p: Promise<unknown>) => { let ok = false; try { await p; } catch { ok = true; } return ok; };

describe("child role", () => {
  it("sees only their own records and what is shared by name, and cannot hide or reassign records", async () => {
    const { david, sharon, householdId } = await coupleHousehold();
    const kid = await addMember(david, householdId, "Kid", "kid@example.com", "CHILD");
    const d = await ctxFor(david, householdId, "write"), k = await ctxFor(kid, householdId, "write");
    const joint = await account(d, "Joint", { visibility: "HOUSEHOLD" });
    await spend(d, joint, "Groceries", "100.00", { visibility: "HOUSEHOLD" });
    const kidAcct = await account(k, "Allowance", { visibility: "PERSONAL", openingBalance: "20.00" });
    const own = await spend(k, kidAcct, "Groceries", "5.00", { visibility: "PERSONAL" });
    const stored = await db.finTransaction.findUniqueOrThrow({ where: { id: own.id } });
    expect(stored.visibility).toBe("HOUSEHOLD"); // forced visible to the adults
    expect((await listTransactions(k, q())).items.map((t) => t.id)).toEqual([own.id]);
    expect((await listAccounts(k, "all")).items.map((a) => a.id)).toEqual([kidAcct]);
    // adults can see the child's records
    expect((await listTransactions(d, q())).items.map((t) => t.id)).toContain(own.id);
    // a record shared with the child by name becomes visible to them
    const sharedByName = await spend(d, joint, "Groceries", "7.00", { visibility: "SELECTED", sharedWithMemberIds: [k.me.id] });
    expect((await listTransactions(k, q())).items.map((t) => t.id)).toContain(sharedByName.id);
    // cannot assign a record to an adult
    await expect(createTransaction(k, { type: "EXPENSE", accountId: kidAcct, amount: "1.00", date: "2026-03-10", description: "x", assignToMemberId: d.me.id, force: true } as never)).rejects.toBeTruthy();
    // areas
    expect(() => assertAreaAllowed("CHILD", "GET", "dashboard")).toThrow();
    expect(() => assertAreaAllowed("CHILD", "GET", "budgets")).toThrow();
    expect(() => assertAreaAllowed("CHILD", "POST", "transactions")).not.toThrow();
    void sharon;
  });
});

describe("accountant role", () => {
  it("is read-only, sees only shared records, reaches only tax-related areas, and can comment", async () => {
    const { david, sharon, householdId } = await coupleHousehold();
    const acc = await addMember(david, householdId, "Pat Accountant", "pat@example.com", "ACCOUNTANT");
    const d = await ctxFor(david, householdId, "write"), s = await ctxFor(sharon, householdId, "write");
    const joint = await account(d, "Joint", { visibility: "HOUSEHOLD" });
    const priv = await account(s, "Sharon private", { visibility: "PERSONAL" });
    const shared = await spend(d, joint, "Groceries", "100.00", { visibility: "HOUSEHOLD" });
    await spend(s, priv, "Groceries", "900.00", { visibility: "PERSONAL" });
    const a = await ctxFor(acc, householdId);
    expect((await listTransactions(a, q())).items.map((t) => t.id)).toEqual([shared.id]);
    expect(a.canWrite).toBe(false);
    await expect(ctxFor(acc, householdId, "write")).rejects.toBeTruthy();
    expect(() => assertAreaAllowed("ACCOUNTANT", "GET", "tax")).not.toThrow();
    expect(() => assertAreaAllowed("ACCOUNTANT", "GET", "goals")).toThrow();
    expect(() => assertAreaAllowed("ACCOUNTANT", "POST", "transactions")).toThrow();
    expect(() => assertAreaAllowed("ACCOUNTANT", "POST", "comments")).not.toThrow();
    const c = await addComment(a, { entity: "transaction", entityId: shared.id, body: "Is this deductible?" });
    expect((await listComments(d, { entity: "transaction", entityId: shared.id })).map((x) => x.body)).toEqual(["Is this deductible?"]);
    expect(await db.notification.count({ where: { userId: david.id, dedupeKey: `comment:${c.id}` } })).toBe(1);
  });

  it("loses access when the time limit passes, everywhere", async () => {
    const { david, householdId } = await coupleHousehold();
    const future = new Date(Date.now() + 5 * 86400_000).toISOString().slice(0, 10);
    const acc = await addMember(david, householdId, "Temp Accountant", "temp@example.com", "ACCOUNTANT", future);
    const row = await db.householdMember.findFirstOrThrow({ where: { householdId, userId: acc.id } });
    expect(row.accessExpiresAt).not.toBeNull();
    await expect(ctxFor(acc, householdId)).resolves.toBeTruthy();
    await db.householdMember.update({ where: { id: row.id }, data: { accessExpiresAt: new Date(Date.now() - 1000) } });
    await expect(ctxFor(acc, householdId)).rejects.toThrow(/ended/);
    expect(await accessibleVehicles(acc, "view", { householdId })).toEqual([]);
    // a past date is refused when inviting
    await expect(createInvite(david, householdId, { email: "late@example.com", role: "ACCOUNTANT", vehicleAccess: [], accessUntil: "2020-01-01" } as never)).rejects.toBeTruthy();
  });

  it("cannot see vehicles unless one was granted, and never gets write access to one", async () => {
    const { david, householdId } = await coupleHousehold();
    const acc = await addMember(david, householdId, "Vic Accountant", "vic@example.com", "ACCOUNTANT");
    const vid = await createTestVehicle(david, { householdId });
    expect(await accessibleVehicles(acc, "view", { householdId })).toHaveLength(0);
    await setVehicleAccess(david, vid, { userId: acc.id, level: "CO_OWNER", canViewFinancials: true } as never);
    expect(await accessibleVehicles(acc, "view", { householdId })).toHaveLength(1);
    expect(await accessibleVehicles(acc, "write", { householdId })).toHaveLength(0);
  });
});

describe("comments", () => {
  it("are only visible on records the person can see", async () => {
    const { david, sharon, householdId } = await coupleHousehold();
    const d = await ctxFor(david, householdId, "write"), s = await ctxFor(sharon, householdId, "write");
    const priv = await account(d, "David private", { visibility: "PERSONAL" });
    const t = await spend(d, priv, "Groceries", "10.00", { visibility: "PERSONAL" });
    await addComment(d, { entity: "transaction", entityId: t.id, body: "note to self" });
    expect(await rejects(listComments(s, { entity: "transaction", entityId: t.id }))).toBe(true);
    expect(await rejects(addComment(s, { entity: "transaction", entityId: t.id, body: "hi" }))).toBe(true);
    const mine = (await listComments(d, { entity: "transaction", entityId: t.id }))[0];
    await deleteComment(d, mine.id);
    expect(await listComments(d, { entity: "transaction", entityId: t.id })).toHaveLength(0);
  });
});

describe("wish list", () => {
  it("a child asks, an adult decides, other people cannot see or decide", async () => {
    const { david, sharon, householdId } = await coupleHousehold();
    const kid = await addMember(david, householdId, "Kid", "kid2@example.com", "CHILD");
    const kid2 = await addMember(david, householdId, "Kid Two", "kid3@example.com", "CHILD");
    const acc = await addMember(david, householdId, "Acc", "acc2@example.com", "ACCOUNTANT");
    const d = await ctxFor(david, householdId, "write"), k = await ctxFor(kid, householdId, "write"), k2 = await ctxFor(kid2, householdId, "write"), a = await ctxFor(acc, householdId), s = await ctxFor(sharon, householdId, "write");
    const w = await createWish(k, { name: "Bike", estimatedCost: "250.00" } as never);
    expect((await listWishes(d)).items.map((x) => x.id)).toEqual([w.id]);
    expect((await listWishes(s)).summary.pending).toBe(1);
    expect((await listWishes(k2)).items).toHaveLength(0);
    expect((await listWishes(a)).items).toHaveLength(0);
    expect(await db.notification.count({ where: { userId: david.id, dedupeKey: `wish:${w.id}:new` } })).toBe(1);
    expect(await rejects(createWish(a, { name: "x", estimatedCost: "1.00" } as never))).toBe(true);
    expect(await rejects(decideWish(k, w.id, { decision: "APPROVED" } as never))).toBe(true);
    expect(await rejects(decideWish(k2, w.id, { decision: "APPROVED" } as never))).toBe(true);
    await decideWish(s, w.id, { decision: "APPROVED", note: "After the exams" } as never);
    expect(await rejects(decideWish(d, w.id, { decision: "DECLINED" } as never))).toBe(true); // already decided
    expect((await listWishes(k)).items[0].status).toBe("APPROVED");
    expect(await db.notification.count({ where: { userId: kid.id, dedupeKey: `wish:${w.id}:APPROVED` } })).toBe(1);
    await updateWishStatus(k, w.id, "PURCHASED");
    expect((await listWishes(d)).items[0].status).toBe("PURCHASED");
    // an adult cannot approve their own wish
    const mine = await createWish(d, { name: "Drill", estimatedCost: "90.00" } as never);
    expect(await rejects(decideWish(d, mine.id, { decision: "APPROVED" } as never))).toBe(true);
  });
});

describe("read-only API tokens", () => {
  const req = (hid: string, path: string, token: string, method = "GET") => new NextRequest(`http://localhost/api/finance/${hid}/${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(method !== "GET" ? { "content-type": "application/json" } : {}) }, ...(method !== "GET" ? { body: "{}" } : {}) });

  it("authenticates one household, reads what the owner can read, and nothing more", async () => {
    const { david, sharon, householdId } = await coupleHousehold();
    const d = await ctxFor(david, householdId, "write"), s = await ctxFor(sharon, householdId, "write");
    await account(d, "Joint", { visibility: "HOUSEHOLD" });
    await account(s, "Sharon private", { visibility: "PERSONAL" });
    const t = await createToken(d, { name: "Sheet", days: 30 } as never);
    expect(t.token.startsWith("ffh_")).toBe(true);
    const stored = await db.apiToken.findFirstOrThrow({ where: { id: t.id } });
    expect(stored.tokenHash).not.toContain(t.token);
    expect(JSON.stringify(await listTokens(d))).not.toContain(t.token);

    const ok = await dispatch(req(householdId, "accounts", t.token), [householdId, "accounts"], "GET");
    expect(ok.status).toBe(200);
    const body = await ok.json();
    const names = body.data.items.map((a: any) => a.name);
    expect(names).toContain("Joint");
    expect(names).not.toContain("Sharon private");

    expect((await dispatch(req(householdId, "accounts", t.token, "POST"), [householdId, "accounts"], "POST")).status).toBe(403);
    expect((await dispatch(req(householdId, "api-tokens", t.token), [householdId, "api-tokens"], "GET")).status).toBe(403);
    expect((await dispatch(req(householdId, "accounts", "ffh_" + "x".repeat(43)), [householdId, "accounts"], "GET")).status).toBe(401);
    // a token for one household is worthless for another
    const stranger = await createActor("Stranger", "stranger@example.com");
    const otherHh = (await listHouseholds(stranger))[0].id;
    expect(await authenticateBearer(req(otherHh, "accounts", t.token), otherHh)).toBeNull();
  });

  it("stops working when revoked or expired, and only the owner can revoke", async () => {
    const { david, sharon, householdId } = await coupleHousehold();
    const d = await ctxFor(david, householdId, "write"), s = await ctxFor(sharon, householdId, "write");
    const t = await createToken(d, { name: "A", days: 1 } as never);
    expect(await authenticateBearer(req(householdId, "accounts", t.token), householdId)).not.toBeNull();
    expect(await rejects(revokeToken(s, t.id))).toBe(true);
    await revokeToken(d, t.id);
    expect(await authenticateBearer(req(householdId, "accounts", t.token), householdId)).toBeNull();
    const t2 = await createToken(d, { name: "B", days: 1 } as never);
    await db.apiToken.update({ where: { id: t2.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await authenticateBearer(req(householdId, "accounts", t2.token), householdId)).toBeNull();
  });
});
