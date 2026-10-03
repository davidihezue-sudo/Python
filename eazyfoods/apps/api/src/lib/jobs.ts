// Background jobs on Postgres (FOR UPDATE SKIP LOCKED). Handlers must be idempotent.
import { query, one, pool, type Db } from '../db.js';

type Handler = (payload: any) => Promise<void>;
const handlers = new Map<string, Handler>();
export const registerJob = (name: string, h: Handler) => handlers.set(name, h);

export async function enqueue(name: string, payload: any = {}, opts: { runAt?: Date; uniqueKey?: string; maxAttempts?: number; db?: Db } = {}) {
  await query(
    `INSERT INTO jobs(name, payload, run_at, unique_key, max_attempts) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (unique_key) WHERE unique_key IS NOT NULL AND status IN ('queued','running') DO NOTHING`,
    [name, JSON.stringify(payload), opts.runAt ?? new Date(), opts.uniqueKey ?? null, opts.maxAttempts ?? 5], opts.db ?? pool);
}

/** Claim and run due jobs. Returns number executed. */
export async function runDueJobs(limit = 25): Promise<number> {
  let n = 0;
  for (; n < limit; n++) {
    const job = await one<any>(
      `UPDATE jobs SET status='running', locked_at=now(), attempts=attempts+1
        WHERE id = (SELECT id FROM jobs WHERE status='queued' AND run_at <= now() ORDER BY run_at, id FOR UPDATE SKIP LOCKED LIMIT 1)
        RETURNING *`);
    if (!job) break;
    const h = handlers.get(job.name);
    try {
      if (!h) throw new Error(`No handler for job ${job.name}`);
      await h(job.payload);
      await query(`UPDATE jobs SET status='done', finished_at=now(), last_error=NULL WHERE id=$1`, [job.id]);
    } catch (e: any) {
      const retry = job.attempts < job.max_attempts;
      const backoff = Math.min(300, 2 ** job.attempts * 5);
      await query(
        `UPDATE jobs SET status=$2, last_error=$3, run_at = now() + ($4 || ' seconds')::interval, finished_at = CASE WHEN $2='failed' THEN now() END WHERE id=$1`,
        [job.id, retry ? 'queued' : 'failed', String(e?.message ?? e).slice(0, 2000), String(backoff)]);
    }
  }
  return n;
}

export const SCHEDULES: Record<string, number> = {};
export function schedule(name: string, intervalSeconds: number, h: Handler) {
  SCHEDULES[name] = intervalSeconds;
  registerJob(name, h);
}

/** Enqueue scheduled jobs whose interval has elapsed. Safe across multiple workers. */
export async function tickSchedules() {
  for (const [name, secs] of Object.entries(SCHEDULES)) {
    const row = await one<{ name: string }>(
      `INSERT INTO schedules(name, interval_seconds, last_run_at) VALUES ($1,$2, now())
       ON CONFLICT (name) DO UPDATE SET interval_seconds = $2, last_run_at = now()
         WHERE schedules.enabled AND (schedules.last_run_at IS NULL OR schedules.last_run_at <= now() - ($2 || ' seconds')::interval)
       RETURNING name`, [name, secs]);
    if (row) await enqueue(name, {}, { uniqueKey: `sched:${name}` });
  }
}
