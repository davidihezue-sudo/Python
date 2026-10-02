import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { addReading } from "@/server/services/odometer";
import { createRecord } from "@/server/services/records";
import { evaluateVehicleSchedules, updateAssignment } from "@/server/services/schedules";
import { deliverPending, generateNotifications, listNotifications, updateNotifications } from "@/server/services/notifications";
import { createReminder, upcoming } from "@/server/services/reminders";
import { updatePreferences } from "@/server/services/users";
import { createWarranty } from "@/server/services/parts";
import { updateVehicle } from "@/server/services/vehicles";
import { runJob } from "@/server/jobs/jobs";
import { createActor, createTestVehicle, reloadActor } from "./helpers";

async function oilSetup() {
  const a = await createActor();
  const vehicleId = await createTestVehicle(a); // 160,000 km on 2024-01-01
  const items = (await evaluateVehicleSchedules(vehicleId, a.prefs, true)).items;
  const oil = items.find((i) => i.name === "Engine oil")!;
  // Record last oil change at 160,000 km (10,000 km interval) on a recent date so time-based triggers stay quiet
  const today = new Date().toISOString().slice(0, 10);
  await updateAssignment(a, oil.id, { baselineDate: today, baselineKm: 160000, intervalMonths: 120 } as any);
  return { a, vehicleId, oil, today };
}

describe("Journey D: upcoming maintenance", () => {
  it("raises staged notifications as the odometer approaches, never duplicates, and re-arms after service", async () => {
    const { a, vehicleId, oil, today } = await oilSetup();
    // far from due: no oil notification
    await generateNotifications();
    expect((await db.notification.count({ where: { dedupeKey: { startsWith: `maint:${oil.id}:` } } }))).toBe(0);

    // 9,200 km later => 800 km remaining => within the 1000 km alert
    await addReading(a, vehicleId, { date: today, valueKm: 169200, source: "MANUAL", confirmCorrection: false });
    const r1 = await generateNotifications();
    expect(r1.created).toBeGreaterThan(0);
    const n1 = await db.notification.findMany({ where: { userId: a.id, dedupeKey: { startsWith: `maint:${oil.id}:` } } });
    expect(n1).toHaveLength(1);
    expect(n1[0].type).toBe("MAINTENANCE_UPCOMING");
    expect(n1[0].title).toMatch(/Engine oil/);
    expect(n1[0].deliveredInAppAt).not.toBeNull();

    // idempotent: running again creates nothing new
    const r2 = await generateNotifications();
    expect(r2.created).toBe(0);

    // 9,600 km => within 500 km => a new (tighter) stage
    await addReading(a, vehicleId, { date: today, valueKm: 169600, source: "MANUAL", confirmCorrection: false });
    await generateNotifications();
    expect(await db.notification.count({ where: { userId: a.id, dedupeKey: { startsWith: `maint:${oil.id}:` } } })).toBe(2);

    // due, then overdue
    await addReading(a, vehicleId, { date: today, valueKm: 170000, source: "MANUAL", confirmCorrection: false });
    await generateNotifications();
    await addReading(a, vehicleId, { date: today, valueKm: 171000, source: "MANUAL", confirmCorrection: false });
    await generateNotifications();
    const all = await db.notification.findMany({ where: { userId: a.id, dedupeKey: { startsWith: `maint:${oil.id}:` } } });
    expect(all.map((n) => n.type).sort()).toEqual(["MAINTENANCE_DUE", "MAINTENANCE_OVERDUE", "MAINTENANCE_UPCOMING", "MAINTENANCE_UPCOMING"]);

    // inbox
    const inbox = await listNotifications(a);
    expect(inbox.unread).toBeGreaterThanOrEqual(4);
    const first = inbox.items[0];
    await updateNotifications(a, { ids: [first.id], action: "actioned" });
    const row = await db.notification.findUniqueOrThrow({ where: { id: first.id } });
    expect(row.actionedAt).not.toBeNull();
    expect(row.readAt).not.toBeNull();

    // complete the maintenance: reminders are actioned and the next cycle is re-armed
    await createRecord(a, { vehicleId, title: "Oil change", serviceDate: today, odometerKm: 171000, workPerformedBy: "OWNER_DIY", status: "COMPLETED", kind: "MAINTENANCE", laborCost: 0, partsCost: 60, tax: 0, discount: 0, items: [{ assignmentId: oil.id, name: "Engine oil", completed: true, quantity: 1, unitCost: 60, laborCost: 0, trackAsPart: false }], allowDuplicate: false, confirmOdometerCorrection: false } as any);
    expect(await db.notification.count({ where: { userId: a.id, dedupeKey: { startsWith: `maint:${oil.id}:` }, actionedAt: null } })).toBe(0);
    const after = (await evaluateVehicleSchedules(vehicleId, a.prefs, true)).items.find((i) => i.id === oil.id)!;
    expect(after.nextDueKm).toBe(181000);
    expect(after.status).toBe("UP_TO_DATE");
    await generateNotifications();
    expect(await db.notification.count({ where: { userId: a.id, dedupeKey: { startsWith: `maint:${oil.id}:` } } })).toBe(4); // nothing new for the new cycle yet
    await addReading(a, vehicleId, { date: today, valueKm: 180400, source: "MANUAL", confirmCorrection: false });
    await generateNotifications();
    const keys = (await db.notification.findMany({ where: { userId: a.id, dedupeKey: { startsWith: `maint:${oil.id}:` } } })).map((n) => n.dedupeKey);
    expect(keys.some((k) => k.includes("181000"))).toBe(true);
  });

  it("respects notification preferences (channels and offsets)", async () => {
    const { a, vehicleId, oil, today } = await oilSetup();
    await updatePreferences(a, { notifyInApp: false, notifyEmail: false, notifyPush: false } as any);
    await addReading(a, vehicleId, { date: today, valueKm: 169900, source: "MANUAL", confirmCorrection: false });
    expect((await generateNotifications()).created).toBe(0);
    await updatePreferences(a, { notifyInApp: true, notifyEmail: true, alertKmBefore: [50], alertDaysBefore: [] } as any);
    await generateNotifications();
    expect(await db.notification.count({ where: { userId: a.id, dedupeKey: { startsWith: `maint:${oil.id}:` } } })).toBe(0); // 100 km remaining is outside a 50 km offset
    await updatePreferences(a, { alertKmBefore: [200] } as any);
    await generateNotifications();
    expect(await db.notification.count({ where: { userId: a.id, dedupeKey: { startsWith: `maint:${oil.id}:` } } })).toBe(1); // inside the 200 km offset
  });

  it("emails via the outbox exactly once and marks delivery", async () => {
    const { a, vehicleId, today } = await oilSetup();
    await addReading(a, vehicleId, { date: today, valueKm: 169900, source: "MANUAL", confirmCorrection: false });
    await generateNotifications();
    const before = await db.emailOutbox.count({ where: { toEmail: a.email, subject: { startsWith: "Family Finance Hub:" } } });
    await deliverPending();
    await deliverPending();
    const after = await db.emailOutbox.count({ where: { toEmail: a.email, subject: { startsWith: "Family Finance Hub:" } } });
    expect(after).toBeGreaterThan(before);
    const n = await db.notification.findFirstOrThrow({ where: { userId: a.id } });
    expect(n.emailedAt).not.toBeNull();
    const countAfterFirst = after;
    await deliverPending();
    expect(await db.emailOutbox.count({ where: { toEmail: a.email, subject: { startsWith: "Family Finance Hub:" } } })).toBe(countAfterFirst);
  });

  it("generates date-based alerts and surfaces them in the upcoming list", async () => {
    const a = await createActor();
    const vehicleId = await createTestVehicle(a);
    const d = (days: number) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
    await updateVehicle(a, vehicleId, { registrationExpiryDate: d(5), insuranceRenewalDate: d(25) } as any);
    await createWarranty(a, { vehicleId, type: "POWERTRAIN", name: "Powertrain", endDate: d(20) } as any);
    await createReminder(a, { vehicleId, title: "Swap to winter tires", dueDate: d(3), leadDays: [7, 1], leadKm: [], type: "CUSTOM" } as any);
    await generateNotifications();
    const types = (await db.notification.findMany({ where: { userId: a.id } })).map((n) => n.type).sort();
    expect(types).toEqual(expect.arrayContaining(["REGISTRATION_EXPIRING", "INSURANCE_RENEWAL", "WARRANTY_EXPIRING", "CUSTOM_REMINDER"]));
    const up = await upcoming(a, { vehicleId });
    expect(up.map((u) => u.kind)).toEqual(expect.arrayContaining(["registration", "insurance", "warranty", "custom"]));
  });

  it("the scheduled job runs without a user session and records a JobRun", async () => {
    const { a, vehicleId, today } = await oilSetup();
    await addReading(a, vehicleId, { date: today, valueKm: 169900, source: "MANUAL", confirmCorrection: false });
    const res = await runJob("notifications.generate");
    expect(res.status).toBe("succeeded");
    expect(res.stats?.created).toBeGreaterThan(0);
    expect(await db.jobRun.count({ where: { name: "notifications.generate", status: "SUCCEEDED" } })).toBe(1);
    expect((await runJob("cleanup")).status).toBe("succeeded");
    expect((await runJob("schedules.refresh")).status).toBe("succeeded");
  });

  it("does not notify disabled schedules", async () => {
    const { a, vehicleId, oil, today } = await oilSetup();
    await updateAssignment(a, oil.id, { enabled: false });
    await addReading(a, vehicleId, { date: today, valueKm: 171000, source: "MANUAL", confirmCorrection: false });
    await generateNotifications();
    expect(await db.notification.count({ where: { dedupeKey: { startsWith: `maint:${oil.id}:` } } })).toBe(0);
    await reloadActor(a);
  });
});
