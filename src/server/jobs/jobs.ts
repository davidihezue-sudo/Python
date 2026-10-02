import { db } from "@/lib/db";
import { flushOutbox } from "@/lib/email";
import { logger, captureError } from "@/lib/logger";
import { storage } from "@/lib/storage";
import { deliverPending, generateNotifications } from "../services/notifications";
import { refreshVehicleSchedules } from "../services/schedules";
import { actorFromUser } from "../context";
import { finCtx } from "../finance/access";
import { refreshAlertNotifications } from "../finance/alerts";
import { postDueRecurring } from "../finance/bills";

export interface JobDef {
  name: string;
  /** minimum interval when run by the scheduler */
  everyMs: number;
  run: () => Promise<Record<string, unknown>>;
}

export const JOBS: JobDef[] = [
  {
    name: "notifications.generate",
    everyMs: 15 * 60_000,
    run: async () => {
      const gen = await generateNotifications();
      const del = await deliverPending();
      return { ...gen, ...del };
    },
  },
  {
    name: "schedules.refresh",
    everyMs: 6 * 3600_000,
    // Persist the daily-changing status snapshot (statuses depend on today's date, not only on user actions)
    run: async () => {
      const vehicles = await db.vehicle.findMany({ where: { deletedAt: null }, select: { id: true, household: { select: { timezone: true } } } });
      for (const v of vehicles) await refreshVehicleSchedules(db, v.id, new Date().toISOString().slice(0, 10));
      return { vehicles: vehicles.length };
    },
  },
  {
    // Alerts are computed per member from the records that member can see, so one member's alerts never reveal another's private data.
    name: "finance.alerts",
    everyMs: 3600_000,
    run: async () => {
      const members = await db.householdMember.findMany({ where: { household: { deletedAt: null, isDemo: false }, user: { disabledAt: null, deletedAt: null } }, include: { user: { include: { preference: true } } } });
      let created = 0, failed = 0;
      for (const m of members) {
        try { created += (await refreshAlertNotifications(actorFromUser(m.user as never), m.householdId)).created; } catch (e) { failed++; logger.warn({ err: (e as Error).message }, "finance alert refresh failed"); }
      }
      return { members: members.length, created, failed };
    },
  },
  {
    // Posts recurring items that are marked auto-post, as the member who created them.
    name: "finance.recurring",
    everyMs: 6 * 3600_000,
    run: async () => {
      const rules = await db.recurringRule.findMany({ where: { active: true, autoPost: true, deletedAt: null, household: { deletedAt: null } } });
      let posted = 0, failed = 0;
      for (const r of rules) {
        if (!r.createdById) continue;
        try {
          const ctx = await finCtx(actorFromUser((await db.user.findUniqueOrThrow({ where: { id: r.createdById }, include: { preference: true } })) as never), r.householdId, "write");
          posted += (await postDueRecurring(ctx, r.id)).posted;
        } catch (e) { failed++; logger.warn({ err: (e as Error).message, rule: r.id }, "recurring post failed"); }
      }
      return { rules: rules.length, posted, failed };
    },
  },
  { name: "email.flush", everyMs: 5 * 60_000, run: async () => ({ ...(await flushOutbox()) }) },
  {
    name: "cleanup",
    everyMs: 3600_000,
    run: async () => {
      const now = new Date();
      const ago = (days: number) => new Date(now.getTime() - days * 86400_000);
      const sessions = await db.session.deleteMany({ where: { expiresAt: { lt: now } } });
      const tokens = await db.verificationToken.deleteMany({ where: { OR: [{ expiresAt: { lt: ago(7) } }, { usedAt: { lt: ago(7) } }] } });
      const buckets = await db.rateLimitBucket.deleteMany({ where: { windowStart: { lt: ago(1) } } });
      const notes = await db.notification.deleteMany({ where: { dismissedAt: { lt: ago(90) } } });
      const invites = await db.householdInvite.deleteMany({ where: { OR: [{ expiresAt: { lt: ago(30) } }, { revokedAt: { lt: ago(30) } }] } });
      // Purge documents deleted more than 30 days ago (file + row)
      const stale = await db.document.findMany({ where: { deletedAt: { lt: ago(30) } }, take: 200 });
      for (const d of stale) {
        await storage().delete(d.fileKey).catch((e) => logger.warn({ err: e.message }, "file purge failed"));
        await db.document.delete({ where: { id: d.id } });
      }
      const jobs = await db.jobRun.deleteMany({ where: { startedAt: { lt: ago(30) } } });
      return { sessions: sessions.count, tokens: tokens.count, rateBuckets: buckets.count, notifications: notes.count, invites: invites.count, documentsPurged: stale.length, jobRuns: jobs.count };
    },
  },
];

/** Runs one job, recording a JobRun row. Skips if the same job is already running (started < 15 min ago). */
export async function runJob(name: string): Promise<{ status: "skipped" | "succeeded" | "failed"; stats?: Record<string, unknown>; error?: string }> {
  const job = JOBS.find((j) => j.name === name);
  if (!job) throw new Error(`Unknown job: ${name}`);
  const running = await db.jobRun.findFirst({ where: { name, status: "RUNNING", startedAt: { gt: new Date(Date.now() - 15 * 60_000) } } });
  if (running) return { status: "skipped" };
  const run = await db.jobRun.create({ data: { name } });
  try {
    const stats = await job.run();
    await db.jobRun.update({ where: { id: run.id }, data: { status: "SUCCEEDED", finishedAt: new Date(), stats: stats as any } });
    logger.info({ job: name, stats }, "job succeeded");
    return { status: "succeeded", stats };
  } catch (e) {
    captureError(e, { job: name });
    await db.jobRun.update({ where: { id: run.id }, data: { status: "FAILED", finishedAt: new Date(), error: (e as Error).message.slice(0, 500) } });
    return { status: "failed", error: (e as Error).message };
  }
}

/** Starts interval timers for every job. Returns a stop function. */
export function startScheduler() {
  const timers: NodeJS.Timeout[] = [];
  for (const j of JOBS) {
    const tick = () => void runJob(j.name).catch((e) => captureError(e, { job: j.name }));
    setTimeout(tick, 5_000 + Math.random() * 5_000);
    const t = setInterval(tick, j.everyMs);
    t.unref?.();
    timers.push(t);
  }
  logger.info({ jobs: JOBS.map((j) => j.name) }, "job scheduler started");
  return () => timers.forEach(clearInterval);
}
