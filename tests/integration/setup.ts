import { config } from "dotenv";
import path from "node:path";
import { execSync } from "node:child_process";
import { beforeAll, beforeEach, afterAll } from "vitest";

config({ path: path.resolve(__dirname, "../../.env.test"), override: true });
(process.env as any).NODE_ENV = "test";

let migrated = false;
beforeAll(async () => {
  if (!migrated) {
    execSync("npx prisma migrate deploy", { env: process.env, stdio: "pipe" });
    const { db } = await import("@/lib/db");
    const { ensureReferenceData } = await import("@/server/reference/seed-reference");
    await ensureReferenceData(db);
    migrated = true;
  }
});

beforeEach(async () => {
  const { db } = await import("@/lib/db");
  const { resetRateLimits } = await import("@/lib/rate-limit");
  resetRateLimits();
  // Cascades remove all user-owned data; library schedules (householdId NULL) and categories are reference data and stay.
  await db.$executeRawUnsafe(`DELETE FROM "Household"`);
  await db.$executeRawUnsafe(`DELETE FROM "User"`);
  for (const t of ["EmailOutbox", "AuditLog", "JobRun", "RateLimitBucket"]) await db.$executeRawUnsafe(`DELETE FROM "${t}"`);
});

afterAll(async () => {
  const { db } = await import("@/lib/db");
  await db.$disconnect();
});
