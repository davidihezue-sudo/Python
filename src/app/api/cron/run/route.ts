import { timingSafeEqual } from "node:crypto";
import { route } from "@/lib/http";
import { z } from "zod";
import { AppError } from "@/lib/errors";
import { env } from "@/lib/env";
import { JOBS, runJob } from "@/server/jobs/jobs";

// For platforms that provide HTTP cron instead of a long-running worker. Authenticated with CRON_SECRET (bearer token).
export const POST = route({ auth: false, machine: true, query: z.object({ job: z.string().optional() }), rate: { limit: 60, windowSec: 60, key: ({ ip }) => `ip:${ip}` } }, async ({ req, query }) => {
  const secret = env().CRON_SECRET;
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer /, "");
  if (!secret || given.length !== secret.length || !timingSafeEqual(Buffer.from(given), Buffer.from(secret))) throw new AppError("UNAUTHENTICATED", "Invalid cron credentials");
  const names = query.job ? [query.job] : JOBS.map((j) => j.name);
  const results: Record<string, unknown> = {};
  for (const n of names) results[n] = await runJob(n);
  return results;
});
