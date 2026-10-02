import { db } from "./db";

export interface RateResult {
  ok: boolean;
  remaining: number;
  retryAfterSec: number;
}

const mem = new Map<string, { count: number; windowStart: number }>();
let lastSweep = 0;

/** Fixed-window limiter. In-memory by default (per instance); RATE_LIMIT_STORE=postgres shares counters across instances. */
export async function rateLimit(key: string, limit: number, windowSec: number): Promise<RateResult> {
  const now = Date.now();
  if (process.env.RATE_LIMIT_STORE === "postgres") {
    const start = new Date(Math.floor(now / (windowSec * 1000)) * windowSec * 1000);
    const bucketKey = `${key}:${start.getTime()}`;
    const rows = await db.$queryRaw<{ count: number }[]>`
      INSERT INTO "RateLimitBucket" ("key","count","windowStart") VALUES (${bucketKey}, 1, ${start})
      ON CONFLICT ("key") DO UPDATE SET "count" = "RateLimitBucket"."count" + 1
      RETURNING "count"`;
    const count = Number(rows[0]?.count ?? 1);
    return { ok: count <= limit, remaining: Math.max(0, limit - count), retryAfterSec: Math.ceil((start.getTime() + windowSec * 1000 - now) / 1000) };
  }
  if (now - lastSweep > 60_000) {
    lastSweep = now;
    for (const [k, v] of mem) if (now - v.windowStart > 3_600_000) mem.delete(k);
  }
  const cur = mem.get(key);
  if (!cur || now - cur.windowStart >= windowSec * 1000) {
    mem.set(key, { count: 1, windowStart: now });
    return { ok: true, remaining: limit - 1, retryAfterSec: windowSec };
  }
  cur.count++;
  return { ok: cur.count <= limit, remaining: Math.max(0, limit - cur.count), retryAfterSec: Math.ceil((cur.windowStart + windowSec * 1000 - now) / 1000) };
}

export function resetRateLimits() {
  mem.clear();
}
