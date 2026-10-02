import { db } from "@/lib/db";
import { AppError, notFound } from "@/lib/errors";
import { googleEnabled, pushEnabled, smtpEnabled, aiEnabled, env } from "@/lib/env";
import type { Actor } from "../context";
import { ts } from "../serialize";
import { requirePlatformAdmin } from "./access";
import { audit } from "./audit";
import { getOcrProvider } from "../integrations/ocr";

/** Aggregate platform statistics. Deliberately exposes counts only — never vehicle, financial or document contents. */
export async function platformStats(actor: Actor) {
  requirePlatformAdmin(actor);
  const since30 = new Date(Date.now() - 30 * 86400_000);
  const [users, verified, active30, households, vehicles, records, expenses, documents, notifications, openIssues, emailStatus, jobs] = await Promise.all([
    db.user.count({ where: { deletedAt: null } }),
    db.user.count({ where: { deletedAt: null, emailVerifiedAt: { not: null } } }),
    db.user.count({ where: { deletedAt: null, lastLoginAt: { gt: since30 } } }),
    db.household.count({ where: { deletedAt: null } }),
    db.vehicle.count({ where: { deletedAt: null } }),
    db.maintenanceRecord.count({ where: { deletedAt: null } }),
    db.expense.count({ where: { deletedAt: null } }),
    db.document.aggregate({ where: { deletedAt: null }, _count: true, _sum: { sizeBytes: true } }),
    db.notification.count(),
    db.repairIssue.count({ where: { deletedAt: null, status: { notIn: ["RESOLVED", "CLOSED"] } } }),
    db.emailOutbox.groupBy({ by: ["status"], _count: true }),
    db.jobRun.findMany({ orderBy: { startedAt: "desc" }, take: 20 }),
  ]);
  return {
    users: { total: users, verified, activeLast30Days: active30 },
    households,
    vehicles,
    records,
    expenses,
    documents: { count: documents._count, bytes: documents._sum.sizeBytes ?? 0 },
    notifications,
    openIssues,
    email: Object.fromEntries(emailStatus.map((e) => [e.status, e._count])),
    jobs: jobs.map((j) => ({ id: j.id, name: j.name, status: j.status, startedAt: ts(j.startedAt), finishedAt: ts(j.finishedAt), stats: j.stats, error: j.error })),
    config: { smtp: smtpEnabled(), google: googleEnabled(), push: pushEnabled(), ai: aiEnabled(), ocr: getOcrProvider()?.name ?? "disabled", storage: env().STORAGE_DRIVER, billingMode: env().BILLING_MODE, vinDecoder: env().VIN_DECODER },
  };
}

export async function listUsers(actor: Actor, q: { search?: string; page?: number }) {
  requirePlatformAdmin(actor);
  const page = Math.max(1, q.page ?? 1);
  const where = { deletedAt: null, ...(q.search ? { OR: [{ email: { contains: q.search, mode: "insensitive" as const } }, { name: { contains: q.search, mode: "insensitive" as const } }] } : {}) };
  const [total, rows] = await Promise.all([db.user.count({ where }), db.user.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * 25, take: 25, select: { id: true, email: true, name: true, platformRole: true, emailVerifiedAt: true, disabledAt: true, createdAt: true, lastLoginAt: true } })]);
  return { total, page, items: rows.map((u) => ({ id: u.id, email: u.email, name: u.name, platformRole: u.platformRole, verified: !!u.emailVerifiedAt, disabled: !!u.disabledAt, createdAt: ts(u.createdAt), lastLoginAt: ts(u.lastLoginAt) })) };
}

export async function setUserDisabled(actor: Actor, userId: string, disabled: boolean) {
  requirePlatformAdmin(actor);
  if (userId === actor.id) throw new AppError("BAD_REQUEST", "You cannot disable your own account");
  const u = await db.user.findUnique({ where: { id: userId } });
  if (!u) throw notFound("User");
  await db.$transaction([db.user.update({ where: { id: userId }, data: { disabledAt: disabled ? new Date() : null } }), ...(disabled ? [db.session.deleteMany({ where: { userId } })] : [])]);
  await audit(null, actor, { entity: "User", entityId: userId, action: disabled ? "admin-disable" : "admin-enable" });
  return { ok: true };
}

export async function listFlags(actor: Actor) {
  requirePlatformAdmin(actor);
  return (await db.featureFlag.findMany({ orderBy: { key: "asc" } })).map((f) => ({ key: f.key, enabled: f.enabled, description: f.description }));
}
export async function setFlag(actor: Actor, key: string, enabled: boolean) {
  requirePlatformAdmin(actor);
  const f = await db.featureFlag.upsert({ where: { key }, create: { key, enabled }, update: { enabled } });
  await audit(null, actor, { entity: "FeatureFlag", entityId: key, action: "set", after: { enabled } });
  return { key: f.key, enabled: f.enabled };
}
