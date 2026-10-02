import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";

// Subscription-ready entitlement model. Payment processing is intentionally NOT implemented; a billing provider
// (e.g. Stripe webhooks) only needs to write the Subscription row. With BILLING_MODE=disabled (default) every feature is unlocked.
export type Feature = "multiVehicle" | "advancedAnalytics" | "receiptStorage" | "pdfReports" | "advancedReminders" | "aiAssistant" | "familySharing" | "ocr" | "extendedStorage" | "integrations";
export type PlanKey = "FREE" | "PLUS" | "PREMIUM";

export interface PlanDef {
  label: string;
  vehicles: number | null; // null = unlimited
  storageMb: number | null;
  features: Feature[];
}

export const PLANS: Record<PlanKey, PlanDef> = {
  FREE: { label: "Free", vehicles: 1, storageMb: 100, features: [] },
  PLUS: { label: "Plus", vehicles: null, storageMb: 1000, features: ["multiVehicle", "advancedAnalytics", "receiptStorage", "pdfReports", "advancedReminders"] },
  PREMIUM: { label: "Premium", vehicles: null, storageMb: 10000, features: ["multiVehicle", "advancedAnalytics", "receiptStorage", "pdfReports", "advancedReminders", "aiAssistant", "familySharing", "ocr", "extendedStorage", "integrations"] },
};

export const enforced = () => env().BILLING_MODE === "enforced";

export async function getEntitlements(householdId: string) {
  const sub = await db.subscription.findUnique({ where: { householdId } });
  const active = sub && (sub.status === "ACTIVE" || sub.status === "TRIALING") && (!sub.currentPeriodEnd || sub.currentPeriodEnd > new Date());
  const plan: PlanKey = enforced() ? (active ? sub.plan : env().DEFAULT_PLAN) : "PREMIUM";
  const def = PLANS[plan];
  const overrides = (sub?.limitOverrides ?? {}) as { vehicles?: number | null };
  return {
    plan,
    label: def.label,
    enforced: enforced(),
    vehicleLimit: overrides.vehicles !== undefined ? overrides.vehicles : def.vehicles,
    storageMb: def.storageMb,
    features: new Set<Feature>(enforced() ? def.features : (Object.values(PLANS.PREMIUM.features) as Feature[])),
  };
}

export async function assertVehicleLimit(householdId: string) {
  const ent = await getEntitlements(householdId);
  if (ent.vehicleLimit === null) return;
  const count = await db.vehicle.count({ where: { householdId, deletedAt: null } });
  if (count >= ent.vehicleLimit) throw new AppError("PLAN_LIMIT", `Your ${ent.label} plan allows ${ent.vehicleLimit} vehicle${ent.vehicleLimit === 1 ? "" : "s"}. Upgrade to add more.`, { limit: ent.vehicleLimit, plan: ent.plan });
}

export async function requireFeature(householdId: string, feature: Feature) {
  const flag = feature === "aiAssistant" ? await db.featureFlag.findUnique({ where: { key: "ai_assistant" } }) : feature === "ocr" ? await db.featureFlag.findUnique({ where: { key: "ocr_receipts" } }) : null;
  if (flag && !flag.enabled) throw new AppError("PLAN_LIMIT", "This feature is currently disabled by the platform administrator");
  const ent = await getEntitlements(householdId);
  if (!ent.features.has(feature)) throw new AppError("PLAN_LIMIT", `This feature requires a higher plan (currently ${ent.label}).`, { feature, plan: ent.plan });
}

export async function describeEntitlements(householdId: string) {
  const ent = await getEntitlements(householdId);
  const vehicles = await db.vehicle.count({ where: { householdId, deletedAt: null } });
  return { plan: ent.plan, label: ent.label, enforced: ent.enforced, vehicleLimit: ent.vehicleLimit, vehiclesUsed: vehicles, storageMb: ent.storageMb, features: [...ent.features], plans: PLANS };
}
