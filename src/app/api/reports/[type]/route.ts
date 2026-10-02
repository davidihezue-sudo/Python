import { route, boolish, optDateQ } from "@/lib/http";
import { z } from "zod";
import { AppError } from "@/lib/errors";
import { generateReport, REPORT_CATALOG, type ReportType } from "@/server/services/reports";
import { REPORT_FORMATS, renderReport, type ReportFormat } from "@/server/services/report-render";
import { db } from "@/lib/db";
import { audit } from "@/server/services/audit";

export const GET = route({ raw: true, rate: { limit: 30, windowSec: 600 }, query: z.object({ format: z.enum(["pdf", "csv", "xlsx", "json"]).default("pdf"), vehicleId: z.string().optional(), year: z.coerce.number().int().min(1990).max(2100).optional(), from: optDateQ, to: optDateQ, hideVin: boolish.optional(), hideCosts: boolish.optional(), hideProviders: boolish.optional(), inline: boolish.optional() }) }, async ({ actor, params, query }) => {
  const meta = REPORT_CATALOG.find((r) => r.type === params.type);
  if (!meta) throw new AppError("NOT_FOUND", "Unknown report");
  const report = await generateReport(actor, { type: params.type as ReportType, ...query });
  const fmt = query.format as ReportFormat;
  const body = await renderReport(report, fmt);
  await audit(db, actor, { entity: "Report", action: `export:${params.type}:${fmt}`, vehicleId: query.vehicleId && query.vehicleId !== "all" ? query.vehicleId : null });
  const name = `autovault-${params.type}-${new Date().toISOString().slice(0, 10)}.${REPORT_FORMATS[fmt].ext}`;
  return new Response(new Uint8Array(body), { headers: { "content-type": REPORT_FORMATS[fmt].mime, "content-disposition": `${query.inline && fmt === "pdf" ? "inline" : "attachment"}; filename="${name}"`, "cache-control": "no-store", "x-content-type-options": "nosniff" } });
});
