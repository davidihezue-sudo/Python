import { route, pageQuery, boolish } from "@/lib/http";
import { z } from "zod";
import { AppError } from "@/lib/errors";
import { env } from "@/lib/env";
import { documentMetaSchema } from "@/lib/validation";
import { listDocuments, uploadDocument } from "@/server/services/documents";

export const GET = route({ query: z.object({ vehicleId: z.string().optional(), category: z.string().optional(), q: z.string().max(100).optional(), expiring: boolish.optional(), maintenanceRecordId: z.string().optional(), repairIssueId: z.string().optional(), expenseId: z.string().optional(), partId: z.string().optional(), ...pageQuery }) }, async ({ actor, query }) => listDocuments(actor, query));

export const POST = route({ status: 201, rate: { limit: 30, windowSec: 600 } }, async ({ req, actor }) => {
  const max = env().MAX_UPLOAD_MB * 1024 * 1024;
  if (Number(req.headers.get("content-length") ?? 0) > max + 100_000) throw new AppError("PAYLOAD_TOO_LARGE", `Files may be at most ${env().MAX_UPLOAD_MB} MB`);
  const form = await req.formData();
  const f = form.get("file");
  if (!(f instanceof File)) throw new AppError("VALIDATION_ERROR", "Attach a file in the 'file' field");
  const meta = Object.fromEntries([...form.entries()].filter(([k, v]) => k !== "file" && typeof v === "string").map(([k, v]) => [k, v === "" ? undefined : v]));
  const parsed = documentMetaSchema.parse({ ...meta, runOcr: meta.runOcr === "true" || meta.runOcr === "1" });
  return uploadDocument(actor, { name: f.name, size: f.size, data: Buffer.from(await f.arrayBuffer()) }, parsed);
});
