// Receipt capture: read a photo or PDF and return candidate values for the transaction form. Nothing is stored and nothing is saved:
// the person checks the values, saves the transaction, and the file is then attached to that transaction like any other document.
import { AppError } from "@/lib/errors";
import { getOcrProvider, runOcr } from "../integrations/ocr";
import { sniffMime } from "../services/documents";
import { requireWriter, type FinCtx } from "./access";
import { env } from "@/lib/env";

export async function scanReceipt(ctx: FinCtx, file: { name: string; size: number; data: Buffer }) {
  requireWriter(ctx);
  const max = env().MAX_UPLOAD_MB * 1024 * 1024;
  if (file.size > max || file.data.length > max) throw new AppError("PAYLOAD_TOO_LARGE", `Files may be at most ${env().MAX_UPLOAD_MB} MB`);
  const mime = sniffMime(file.data);
  if (!mime) throw new AppError("UNSUPPORTED_MEDIA_TYPE", "Only PDF, JPG, PNG and WEBP files are accepted");
  const p = getOcrProvider();
  const a = p?.available();
  if (!p || !a?.ok) return { available: false as const, reason: p ? (a?.reason ?? "OCR is not set up") : "Receipt reading is switched off on this server", candidates: null, provider: null, notes: [] as string[] };
  try {
    const r = await runOcr(file.data, mime);
    const today = ctx.today;
    // A date in the future or far in the past is more likely a misread than the truth.
    const date = r.date && r.date <= today && r.date >= `${Number(today.slice(0, 4)) - 3}-01-01` ? r.date : null;
    const total = r.total !== null && r.total > 0 && r.total < 1_000_000 ? r.total.toFixed(2) : null;
    return { available: true as const, reason: null, provider: r.provider, confidence: r.confidence, notes: r.notes, candidates: { merchant: r.vendor, date, total, tax: r.tax !== null ? r.tax.toFixed(2) : null } };
  } catch (e) {
    return { available: true as const, reason: `The receipt could not be read: ${(e as Error).message}`, candidates: null, provider: p.name, notes: [] as string[] };
  }
}
