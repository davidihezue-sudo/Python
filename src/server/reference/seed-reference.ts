import type { PrismaClient } from "@prisma/client";
import { CATEGORIES, GENERIC_SOURCE_NOTE, LIBRARY } from "./library";

/** Idempotently creates the maintenance categories and the system schedule library. Safe to run on every deploy. */
export async function ensureReferenceData(db: PrismaClient) {
  const catIds = new Map<string, string>();
  for (const c of CATEGORIES) {
    const row = await db.maintenanceCategory.upsert({ where: { key: c.key }, create: { key: c.key, name: c.name, sortOrder: c.sortOrder }, update: { name: c.name, sortOrder: c.sortOrder } });
    catIds.set(c.key, row.id);
  }
  for (const i of LIBRARY) {
    const data = {
      categoryId: catIds.get(i.category) as string,
      name: i.name,
      description: i.description ?? null,
      componentKey: i.key,
      triggerType: i.trigger,
      intervalKm: i.km ?? null,
      intervalMonths: i.months ?? null,
      priority: i.priority ?? "NORMAL",
      instructions: i.instructions ?? null,
      sourceType: "SUGGESTED" as const,
      sourceNote: GENERIC_SOURCE_NOTE,
      appliesTo: { fuelTypes: i.fuelTypes ?? null, drivetrains: i.drivetrains ?? null },
      isSystem: true,
    };
    await db.maintenanceSchedule.upsert({ where: { libraryKey: i.key }, create: { libraryKey: i.key, ...data }, update: data });
  }
  await db.featureFlag.upsert({ where: { key: "ai_assistant" }, create: { key: "ai_assistant", enabled: true, description: "AI maintenance assistant" }, update: {} });
  await db.featureFlag.upsert({ where: { key: "ocr_receipts" }, create: { key: "ocr_receipts", enabled: true, description: "Receipt OCR extraction" }, update: {} });
  await db.featureFlag.upsert({ where: { key: "web_push" }, create: { key: "web_push", enabled: true, description: "Web push notifications" }, update: {} });
  return { categories: CATEGORIES.length, schedules: LIBRARY.length };
}
