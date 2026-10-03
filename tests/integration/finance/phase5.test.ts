import { describe, expect, it } from "vitest";
import PDFDocument from "pdfkit";
import { account, coupleHousehold, ctxFor, db, spend } from "./helpers";
import { createActor } from "../helpers";
import { acceptInvite, createInvite } from "@/server/services/households";
import { ensureFinanceSetup } from "@/server/finance/household";
import { getMyLegacy, legacySchema, readSharedLegacy, saveMyLegacy, sharedWithMe } from "@/server/finance/legacy";
import { changeHistory, historyQuery } from "@/server/finance/history";
import { scanReceipt } from "@/server/finance/receipts";

async function addMember(admin: Awaited<ReturnType<typeof createActor>>, householdId: string, name: string, email: string, role: "CHILD" | "ACCOUNTANT" | "MEMBER") {
  const a = await createActor(name, email);
  const inv = await createInvite(admin, householdId, { email, role, vehicleAccess: [] } as never);
  await acceptInvite(a, inv.inviteUrl.split("/invite/")[1]);
  await ensureFinanceSetup(householdId);
  return a;
}
const rejects = async (p: Promise<unknown>) => { try { await p; return false; } catch { return true; } };
const pdf = (lines: string[]) => new Promise<Buffer>((resolve) => { const d = new PDFDocument(); const bufs: Buffer[] = []; d.on("data", (b) => bufs.push(b)); d.on("end", () => resolve(Buffer.concat(bufs))); for (const l of lines) d.text(l); d.end(); });

describe("receipt capture", () => {
  it("reads candidate values from a PDF, stores nothing, and rejects other file types", async () => {
    const { david, householdId } = await coupleHousehold();
    const d = await ctxFor(david, householdId, "write");
    const data = await pdf(["Corner Market", "Date: 2026-03-01", "Milk 4.50", "Total $45.67"]);
    const before = await db.document.count({ where: { householdId } });
    const r = await scanReceipt(d, { name: "r.pdf", size: data.length, data });
    expect(r.available).toBe(true);
    expect(r.candidates?.total).toBe("45.67");
    expect(r.candidates?.date).toBe("2026-03-01");
    expect(await db.document.count({ where: { householdId } })).toBe(before);
    expect(await rejects(scanReceipt(d, { name: "x.exe", size: 4, data: Buffer.from("MZ00") }))).toBe(true);
    const ro = await ctxFor(await addMember(david, householdId, "Acc", "acc-r@example.com", "ACCOUNTANT"), householdId);
    expect(await rejects(scanReceipt(ro, { name: "r.pdf", size: data.length, data }))).toBe(true);
  });
});

describe("if something happens to me", () => {
  it("is readable only by the people named, never by others, and every read is recorded and notified", async () => {
    const { david, sharon, householdId } = await coupleHousehold();
    const joe = await addMember(david, householdId, "Joe", "joe@example.com", "MEMBER");
    const kid = await addMember(david, householdId, "Kid", "kid-l@example.com", "CHILD");
    const d = await ctxFor(david, householdId, "write"), s = await ctxFor(sharon, householdId, "write"), j = await ctxFor(joe, householdId, "write"), k = await ctxFor(kid, householdId, "write");
    await account(d, "David private chequing", { visibility: "PERSONAL", institution: "Big Bank", openingBalance: "1234.56" });
    await account(d, "Joint", { visibility: "HOUSEHOLD", joint: true } as never).catch(() => undefined);
    const mine = await getMyLegacy(d);
    expect(mine.candidates.map((c) => c.id)).not.toContain(k.me.id); // a child cannot be named
    expect(mine.summary.accounts.map((a) => a.name)).toContain("David private chequing");
    expect(mine.summary.accounts[0].balance).toBeNull();

    expect(await rejects(saveMyLegacy(d, legacySchema.parse({ sections: [{ title: "Call", body: "x" }], trustedMemberIds: [k.me.id] })))).toBe(true);
    await saveMyLegacy(d, legacySchema.parse({ sections: [{ title: "Who to call", body: "My brother, 555-0100" }], trustedMemberIds: [s.me.id] }));

    expect((await sharedWithMe(s)).map((x) => x.owner)).toEqual(["David"]);
    expect(await sharedWithMe(j)).toEqual([]);
    const seen = await readSharedLegacy(s, d.me.id);
    expect(seen.sections[0].body).toContain("brother");
    expect(seen.summary.accounts.map((a) => a.name)).toContain("David private chequing"); // shared on purpose by the owner
    expect(seen.summary.accounts[0].balance).toBeNull();
    expect(await db.notification.count({ where: { userId: david.id, title: { contains: "opened your" } } })).toBe(1);
    expect(await db.auditLog.count({ where: { entity: "LegacyPlan", action: "read", userId: sharon.id } })).toBe(1);
    // not named, a child, or the wrong person: all look like "not found"
    expect(await rejects(readSharedLegacy(j, d.me.id))).toBe(true);
    expect(await rejects(readSharedLegacy(k, d.me.id))).toBe(true);
    expect(await rejects(readSharedLegacy(d, s.me.id))).toBe(true);

    await saveMyLegacy(d, legacySchema.parse({ sections: [{ title: "Who to call", body: "x" }], trustedMemberIds: [s.me.id], includeBalances: true }));
    expect((await readSharedLegacy(s, d.me.id)).summary.accounts[0].balance).toBe("1234.56");
    // naming nobody removes access at once
    await saveMyLegacy(d, legacySchema.parse({ sections: [], trustedMemberIds: [] }));
    expect(await rejects(readSharedLegacy(s, d.me.id))).toBe(true);
  });
});

describe("change history", () => {
  it("shows a member their own actions, and administrators the household's membership changes, with no record contents", async () => {
    const { david, sharon, householdId } = await coupleHousehold();
    const d = await ctxFor(david, householdId, "write"), s = await ctxFor(sharon, householdId, "write");
    const sAcct = await account(s, "Sharon private", { visibility: "PERSONAL" });
    await spend(s, sAcct, "Groceries", "10.00", { visibility: "PERSONAL" });
    const mine = await changeHistory(s, historyQuery.parse({}));
    expect(mine.items.length).toBeGreaterThan(0);
    expect(mine.items.every((i) => i.by === "You")).toBe(true);
    expect(JSON.stringify(mine)).not.toContain("Sharon private");
    const dav = await changeHistory(d, historyQuery.parse({}));
    expect(dav.items.some((i) => i.what === "Transaction" && i.by !== "You")).toBe(false); // Sharon's own actions are not David's to read
    expect(dav.items.some((i) => i.what === "Member" || i.what === "Invitation")).toBe(true); // household level, for the administrator
    expect(Object.keys(dav.items[0]).sort()).toEqual(["action", "at", "by", "id", "what"]);
  });
});
