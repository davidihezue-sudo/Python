import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { acceptInvite, createInvite, getInvitePreview, listHouseholds, removeMember, updateMember } from "@/server/services/households";
import { getVehicle, listVehicles, updateVehicle, deleteVehicle, setVehicleAccess, vehicleTimeline } from "@/server/services/vehicles";
import { addReading, getOdometerOverview } from "@/server/services/odometer";
import { createRecord, getRecord, listRecords, updateRecord, deleteRecord } from "@/server/services/records";
import { createExpense, getExpense, listExpenses, updateExpense, deleteExpense, listBudgets, createBudget } from "@/server/services/expenses";
import { createIssue, getIssue, listIssues, updateIssue, createCode, listCodes, convertIssueToRepair } from "@/server/services/repairs";
import { createPart, getPart, listParts, updatePart, replaceComponent, componentHistory, createWarranty, listWarranties } from "@/server/services/parts";
import { createFuel, fuelStats, listFuel } from "@/server/services/fuel";
import { listVehicleSchedules, updateAssignment, getAssignment, createAssignment, applyLibraryForActor } from "@/server/services/schedules";
import { createReminder, listReminders, updateReminder } from "@/server/services/reminders";
import { uploadDocument, listDocuments, readDocumentFile, getDocumentForActor, deleteDocument } from "@/server/services/documents";
import { createInspection, listInspections } from "@/server/services/inspections";
import { getDashboard, getExpenseAnalytics } from "@/server/services/analytics";
import { buildReport } from "@/server/services/reports";
import { globalSearch } from "@/server/services/search";
import { chat } from "@/server/services/ai";
import { evaluateVehicleSchedules } from "@/server/services/schedules";
import { createActor, createTestVehicle, reloadActor } from "./helpers";

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);

async function household() {
  const owner = await createActor("Owner", "owner@example.com");
  const vehicleId = await createTestVehicle(owner, { nickname: "Family SUV" });
  const second = await createTestVehicle(owner, { nickname: "Private Car", vin: undefined });
  const spouse = await createActor("Spouse", "spouse@example.com");
  return { owner, spouse, vehicleId, second };
}

async function invite(owner: any, spouse: any, grants: any[], role: "ADMIN" | "MEMBER" = "MEMBER") {
  const hh = (await listHouseholds(owner))[0];
  const inv = await createInvite(owner, hh.id, { email: spouse.email, role, vehicleAccess: grants } as any);
  const token = inv.inviteUrl.split("/invite/")[1];
  await acceptInvite(spouse, token);
  return { householdId: hh.id, token };
}

describe("Journey E: household sharing", () => {
  it("invites a family member with access to specific vehicles only", async () => {
    const { owner, spouse, vehicleId, second } = await household();
    const hh = (await listHouseholds(owner))[0];
    const inv = await createInvite(owner, hh.id, { email: "spouse@example.com", role: "MEMBER", vehicleAccess: [{ vehicleId, level: "MAINTENANCE_MANAGER", canViewFinancials: false }] } as any);
    const token = inv.inviteUrl.split("/invite/")[1];
    expect((await getInvitePreview(token)).householdName).toContain("Owner");
    // email shows up in the outbox
    expect(await db.emailOutbox.count({ where: { toEmail: "spouse@example.com", subject: { contains: "invited" } } })).toBe(1);
    await acceptInvite(spouse, token);
    const sp = await reloadActor(spouse);
    const mine = await listVehicles(sp);
    expect(mine.map((v) => v.id)).toEqual([vehicleId]);
    expect(mine[0].canWrite).toBe(true);
    expect(mine[0].canViewFinancials).toBe(false);
    // not authorised for the other vehicle - reported as not found, not forbidden (no existence leak)
    await expect(getVehicle(sp, second)).rejects.toMatchObject({ code: "NOT_FOUND" });
    // single-use
    await expect(acceptInvite(spouse, token)).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("only the invited email can accept, and unverified accounts cannot", async () => {
    const { owner } = await household();
    const intruder = await createActor("Intruder", "intruder@example.com");
    const hh = (await listHouseholds(owner))[0];
    const inv = await createInvite(owner, hh.id, { email: "spouse@example.com", role: "MEMBER", vehicleAccess: [] } as any);
    await expect(acceptInvite(intruder, inv.inviteUrl.split("/invite/")[1])).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("maintenance manager can write records but cannot see money, edit the vehicle, or manage access", async () => {
    const { owner, spouse, vehicleId } = await household();
    await invite(owner, spouse, [{ vehicleId, level: "MAINTENANCE_MANAGER", canViewFinancials: false }]);
    const sp = await reloadActor(spouse);
    await addReading(sp, vehicleId, { date: "2024-02-01", valueKm: 161000, source: "MANUAL", confirmCorrection: false });
    const { id } = await createRecord(sp, { vehicleId, title: "Wipers", serviceDate: "2024-02-02", odometerKm: 161100, workPerformedBy: "OWNER_DIY", status: "COMPLETED", kind: "MAINTENANCE", laborCost: 0, partsCost: 45, tax: 0, discount: 0, items: [], allowDuplicate: false, confirmOdometerCorrection: false } as any);
    // costs are redacted for this member…
    const r = await getRecord(sp, id);
    expect(r.totalCost).toBeNull();
    expect(r.partsCost).toBeNull();
    // …but visible to the owner
    expect((await getRecord(owner, id)).totalCost).toBe(45);
    expect((await listRecords(sp, { vehicleId })).items[0].totalCost).toBeNull();
    // financial endpoints are closed
    await expect(listExpenses(sp, { vehicleId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(createExpense(sp, { vehicleId, date: "2024-02-02", amount: 5, category: "OTHER" } as any)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await listExpenses(sp, {}).catch(() => ({ items: [] }))).items).toHaveLength(0);
    const v = await getVehicle(sp, vehicleId);
    expect(v.stats.lifetimeSpend).toBeNull();
    expect(v.purchasePrice).toBeNull();
    const dash = await getDashboard(sp, { range: "all" });
    expect(dash.kpis.maintenanceSpendYtd).toBeNull();
    expect(dash.kpis.lifetimeSpend).toBeNull();
    expect((await getExpenseAnalytics(sp, { range: "all" })).hasFinancialAccess).toBe(false);
    await expect(buildReport(sp, { type: "expense-statement", vehicleId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const hist = await buildReport(sp, { type: "service-history", vehicleId });
    expect(hist.privacy.hideCosts).toBe(true);
    // cannot edit/delete the vehicle or manage access
    await expect(updateVehicle(sp, vehicleId, { colour: "Pink" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(deleteVehicle(sp, vehicleId)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(setVehicleAccess(sp, vehicleId, { userId: sp.id, level: "OWNER" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    // search does not leak amounts / financial docs
    const search = await globalSearch(sp, "Wipers");
    expect(JSON.stringify(search)).not.toMatch(/45/);
  });

  it("viewer is read-only; granting financial visibility is explicit", async () => {
    const { owner, spouse, vehicleId } = await household();
    await invite(owner, spouse, [{ vehicleId, level: "VIEWER", canViewFinancials: false }]);
    const sp = await reloadActor(spouse);
    expect((await getVehicle(sp, vehicleId)).permissions.write).toBe(false);
    await expect(addReading(sp, vehicleId, { date: "2024-02-01", valueKm: 161000, source: "MANUAL", confirmCorrection: false })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(createIssue(sp, { vehicleId, title: "x", discoveredAt: "2024-02-01", severity: "LOW", status: "NEW" } as any)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await setVehicleAccess(owner, vehicleId, { userId: sp.id, level: "VIEWER", canViewFinancials: true });
    expect((await getVehicle(sp, vehicleId)).permissions.financials).toBe(true);
    expect((await listExpenses(sp, { vehicleId })).total).toBe(0);
  });

  it("household admins see everything; removing a member revokes access", async () => {
    const { owner, spouse, vehicleId, second } = await household();
    const { householdId } = await invite(owner, spouse, [], "ADMIN");
    const sp = await reloadActor(spouse);
    expect((await listVehicles(sp)).map((v) => v.id).sort()).toEqual([vehicleId, second].sort());
    expect((await getVehicle(sp, vehicleId)).permissions.manageAccess).toBe(true);
    await updateMember(owner, householdId, sp.id, { role: "MEMBER" });
    expect(await listVehicles(sp)).toHaveLength(0);
    await removeMember(owner, householdId, sp.id);
    await expect(getVehicle(sp, vehicleId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    // last admin protection
    await expect(removeMember(owner, householdId, owner.id)).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("tenant isolation (IDOR battery)", () => {
  it("another household can never read or modify any record by guessing/manipulating IDs", async () => {
    const victim = await createActor("Victim", "victim@example.com");
    const vid = await createTestVehicle(victim, { nickname: "Victim car" });
    const items = (await evaluateVehicleSchedules(vid, victim.prefs, true)).items;
    const oil = items.find((i) => i.name === "Engine oil")!;
    const rec = await createRecord(victim, { vehicleId: vid, title: "Secret service", serviceDate: "2024-05-01", odometerKm: 165000, workPerformedBy: "OWNER_DIY", status: "COMPLETED", kind: "MAINTENANCE", laborCost: 0, partsCost: 99, tax: 0, discount: 0, items: [{ assignmentId: oil.id, name: "Engine oil", completed: true, quantity: 1, unitCost: 99, laborCost: 0, trackAsPart: true, partName: "Oil" }], allowDuplicate: false, confirmOdometerCorrection: false } as any);
    const exp = await createExpense(victim, { vehicleId: vid, date: "2024-05-02", amount: 50, category: "OTHER" } as any);
    const issue = await createIssue(victim, { vehicleId: vid, title: "Secret issue", discoveredAt: "2024-05-03", severity: "LOW", status: "NEW" } as any);
    const part = await createPart(victim, { vehicleId: vid, name: "Secret part", status: "IN_STORAGE", origin: "OEM" } as any);
    const doc = await uploadDocument(victim, { name: "receipt.png", size: PNG.length, data: PNG }, { vehicleId: vid, category: "MAINTENANCE_INVOICE" } as any);
    const fuel = await createFuel(victim, { vehicleId: vid, date: "2024-05-04", odometerKm: 165100, quantity: 40, unit: "L", totalCost: 60, fuelType: "PETROL" } as any);
    const reminder = await createReminder(victim, { vehicleId: vid, title: "Secret reminder", dueDate: "2030-01-01", leadDays: [1], leadKm: [], type: "CUSTOM" } as any);

    const mallory = await createActor("Mallory", "mallory@example.com");
    const mv = await createTestVehicle(mallory, { nickname: "Mallory car", vin: undefined });
    const denied = { code: "NOT_FOUND" };

    // direct vehicle-scoped reads
    await expect(getVehicle(mallory, vid)).rejects.toMatchObject(denied);
    await expect(listVehicleSchedules(mallory, vid)).rejects.toMatchObject(denied);
    await expect(getOdometerOverview(mallory, vid)).rejects.toMatchObject(denied);
    await expect(vehicleTimeline(mallory, vid)).rejects.toMatchObject(denied);
    await expect(listRecords(mallory, { vehicleId: vid })).rejects.toMatchObject(denied);
    await expect(listExpenses(mallory, { vehicleId: vid })).rejects.toMatchObject(denied);
    await expect(listIssues(mallory, { vehicleId: vid })).rejects.toMatchObject(denied);
    await expect(listParts(mallory, { vehicleId: vid })).rejects.toMatchObject(denied);
    await expect(listFuel(mallory, { vehicleId: vid })).rejects.toMatchObject(denied);
    await expect(fuelStats(mallory, vid)).rejects.toMatchObject(denied);
    await expect(listDocuments(mallory, { vehicleId: vid })).rejects.toMatchObject(denied);
    await expect(listInspections(mallory, vid)).rejects.toMatchObject(denied);
    await expect(listCodes(mallory, vid)).rejects.toMatchObject(denied);
    await expect(listWarranties(mallory, vid)).rejects.toMatchObject(denied);
    await expect(componentHistory(mallory, vid)).rejects.toMatchObject(denied);
    await expect(getDashboard(mallory, { vehicleId: vid })).rejects.toMatchObject(denied);
    await expect(getExpenseAnalytics(mallory, { vehicleId: vid })).rejects.toMatchObject(denied);
    await expect(buildReport(mallory, { type: "service-history", vehicleId: vid })).rejects.toMatchObject(denied);
    await expect(applyLibraryForActor(mallory, vid)).rejects.toMatchObject(denied);
    await expect(listReminders(mallory, vid)).resolves.toEqual([]);

    // object-id based reads/writes
    await expect(getRecord(mallory, rec.id)).rejects.toMatchObject(denied);
    await expect(updateRecord(mallory, rec.id, { title: "pwned" })).rejects.toMatchObject(denied);
    await expect(deleteRecord(mallory, rec.id)).rejects.toMatchObject(denied);
    await expect(getExpense(mallory, exp.id)).rejects.toMatchObject(denied);
    await expect(updateExpense(mallory, exp.id, { amount: 1 })).rejects.toMatchObject(denied);
    await expect(deleteExpense(mallory, exp.id)).rejects.toMatchObject(denied);
    await expect(getIssue(mallory, issue.id)).rejects.toMatchObject(denied);
    await expect(updateIssue(mallory, issue.id, { title: "pwned" })).rejects.toMatchObject(denied);
    await expect(convertIssueToRepair(mallory, issue.id, { serviceDate: "2024-05-05", workPerformedBy: "OWNER_DIY", items: [], confirmOdometerCorrection: false } as any)).rejects.toMatchObject(denied);
    await expect(getPart(mallory, part.id)).rejects.toMatchObject(denied);
    await expect(updatePart(mallory, part.id, { name: "pwned" })).rejects.toMatchObject(denied);
    await expect(getAssignment(mallory, oil.id)).rejects.toMatchObject(denied);
    await expect(updateAssignment(mallory, oil.id, { enabled: false })).rejects.toMatchObject(denied);
    await expect(updateReminder(mallory, reminder.id, { title: "pwned" })).rejects.toMatchObject(denied);
    await expect(getDocumentForActor(mallory, doc.document.id)).rejects.toMatchObject(denied);
    await expect(readDocumentFile(mallory, doc.document.id)).rejects.toMatchObject(denied);
    await expect(deleteDocument(mallory, doc.document.id)).rejects.toMatchObject(denied);
    expect(fuel.id).toBeTruthy();

    // cross-linking attacks: using the victim's IDs inside Mallory's own vehicle
    await expect(createRecord(mallory, { vehicleId: mv, title: "x", serviceDate: "2024-05-01", workPerformedBy: "OWNER_DIY", status: "COMPLETED", kind: "MAINTENANCE", items: [{ assignmentId: oil.id, name: "x", completed: true, quantity: 1, unitCost: 0, laborCost: 0, trackAsPart: false }], allowDuplicate: false, confirmOdometerCorrection: false } as any)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(createRecord(mallory, { vehicleId: mv, title: "y", serviceDate: "2024-05-01", workPerformedBy: "OWNER_DIY", status: "COMPLETED", kind: "REPAIR", repairIssueId: issue.id, items: [], allowDuplicate: false, confirmOdometerCorrection: false } as any)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(uploadDocument(mallory, { name: "x.png", size: PNG.length, data: PNG }, { vehicleId: mv, category: "OTHER", maintenanceRecordId: rec.id } as any)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(createWarranty(mallory, { vehicleId: mv, name: "w", partId: part.id } as any)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(replaceComponent(mallory, { vehicleId: mv, componentKey: "x", installedAt: "2024-01-01", existingPartId: part.id } as any)).rejects.toMatchObject(denied);
    await expect(createInspection(mallory, { vehicleId: mv, date: "2024-01-01", type: "GENERAL", items: [{ assignmentId: oil.id, name: "x", condition: "GOOD" }] } as any)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(createBudget(mallory, { vehicleId: vid, period: "ANNUAL", year: 2024, amount: 5, categories: ["OTHER"] } as any)).rejects.toMatchObject(denied);

    // aggregates never include the victim's data
    expect((await listVehicles(mallory)).map((v) => v.id)).toEqual([mv]);
    expect((await listRecords(mallory, {})).total).toBe(0);
    expect((await listExpenses(mallory, {})).total).toBe(0);
    expect((await listDocuments(mallory, {})).total).toBe(0);
    expect((await getDashboard(mallory, { range: "all" })).kpis.vehicles).toBe(1);
    expect((await globalSearch(mallory, "Secret")).groups).toEqual([]);
    const ai = await chat(mallory, { message: "Summarize my vehicle's maintenance history" });
    expect(ai.answer).not.toMatch(/Secret|Victim/);
    const ai2 = await chat(mallory, { message: "When was my oil last changed?", vehicleId: undefined });
    expect(ai2.answer).not.toMatch(/Secret/);
    await expect(chat(mallory, { message: "hi", vehicleId: vid })).rejects.toMatchObject(denied);

    // victim data is intact
    expect((await getRecord(victim, rec.id)).title).toBe("Secret service");
    expect(await db.document.count({ where: { id: doc.document.id, deletedAt: null } })).toBe(1);
  });

  it("platform admins cannot read private vehicle data through the vehicle APIs", async () => {
    const victim = await createActor("Victim", "victim2@example.com");
    const vid = await createTestVehicle(victim);
    const admin = await createActor("Admin", "admin@example.com");
    await db.user.update({ where: { id: admin.id }, data: { platformRole: "PLATFORM_ADMIN" } });
    const adm = await reloadActor(admin);
    await expect(getVehicle(adm, vid)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const { platformStats, listUsers } = await import("@/server/services/admin");
    const stats = await platformStats(adm);
    expect(stats.vehicles).toBe(1);
    expect(JSON.stringify(stats)).not.toMatch(/BMW|X3|victim2/);
    const users = await listUsers(adm, {});
    expect(users.items.some((u) => u.email === "victim2@example.com")).toBe(true);
    // non-admin cannot call admin services
    await expect(platformStats(victim)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
