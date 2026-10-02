import { z } from "zod";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

// Receipt OCR architecture. Providers extract *candidate* fields only. Nothing extracted is ever turned into a
// financial record automatically: the UI shows the candidates, the user edits/confirms, and only then is an expense created.
export interface OcrResult {
  provider: string;
  vendor: string | null;
  date: string | null;
  total: number | null;
  tax: number | null;
  invoiceNumber: string | null;
  lineItems: { description: string; amount: number | null; kind: "part" | "labour" | "other" }[];
  confidence: "low" | "medium" | "high";
  notes: string[];
}

export interface OcrProvider {
  name: string;
  available(): { ok: boolean; reason?: string };
  extract(data: Buffer, mime: string): Promise<OcrResult>;
}

const emptyResult = (provider: string): OcrResult => ({ provider, vendor: null, date: null, total: null, tax: null, invoiceNumber: null, lineItems: [], confidence: "low", notes: [] });

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const num = (s: string) => {
  const n = Number(s.replace(/[^0-9.,-]/g, "").replace(/,(?=\d{3}\b)/g, "").replace(",", "."));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
};

/** Heuristic parser for receipt/invoice text (used by the local "text" provider; exported for testing). */
export function parseReceiptText(text: string): OcrResult {
  const r = emptyResult("text-heuristics");
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  r.vendor = lines.find((l) => /[A-Za-z]{3,}/.test(l) && !/^(invoice|receipt|tax invoice|page|date|bill to|customer)/i.test(l) && l.length <= 60) ?? null;
  const flat = text;
  // date
  const iso = /\b(20\d{2})[-/.](0?[1-9]|1[0-2])[-/.](0?[1-9]|[12]\d|3[01])\b/.exec(flat);
  const mdy = /\b(0?[1-9]|1[0-2])[-/.](0?[1-9]|[12]\d|3[01])[-/.](20\d{2})\b/.exec(flat);
  const named = new RegExp(`\\b(${MONTHS.join("|")})[a-z]*\\.?\\s+(\\d{1,2}),?\\s+(20\\d{2})\\b`, "i").exec(flat);
  if (iso) r.date = `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  else if (named) r.date = `${named[3]}-${String(MONTHS.indexOf(named[1].toLowerCase().slice(0, 3)) + 1).padStart(2, "0")}-${named[2].padStart(2, "0")}`;
  else if (mdy) r.date = `${mdy[3]}-${mdy[1].padStart(2, "0")}-${mdy[2].padStart(2, "0")}`;
  // amounts
  const money = String.raw`\$?\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})|[0-9]+\.[0-9]{2})`;
  const totals = [...flat.matchAll(new RegExp(String.raw`(?:grand\s+total|total\s+due|amount\s+due|balance\s+due|total)\s*(?:\(.*?\))?\s*[:\-]?\s*` + money, "gi"))].map((m) => num(m[1])).filter((n): n is number => n !== null);
  if (totals.length) r.total = Math.max(...totals);
  const taxes = [...flat.matchAll(new RegExp(String.raw`(?:gst|hst|pst|qst|vat|sales\s+tax|tax)\s*(?:\(?[0-9.]+%\)?)?\s*[:\-]?\s*` + money, "gi"))].map((m) => num(m[1])).filter((n): n is number => n !== null);
  if (taxes.length) r.tax = Math.round(taxes.reduce((a, b) => a + b, 0) * 100) / 100;
  const inv = /invoice\s*(?:no\.?|number|#)?\s*[:#]?\s*([A-Z0-9][A-Z0-9-]{2,})/i.exec(flat);
  if (inv) r.invoiceNumber = inv[1];
  for (const l of lines) {
    const m = new RegExp(String.raw`^(.{3,60}?)\s+` + money + String.raw`$`).exec(l);
    if (!m || /\b(total|subtotal|tax|gst|hst|pst|qst|vat|balance|amount|tender)\b|change due/i.test(m[1])) continue;
    r.lineItems.push({ description: m[1].trim(), amount: num(m[2]), kind: /labou?r|hour|hr\b/i.test(m[1]) ? "labour" : /filter|oil|pad|rotor|battery|part|fluid|spark|belt|bulb|wiper/i.test(m[1]) ? "part" : "other" });
  }
  const found = [r.vendor, r.date, r.total].filter((x) => x !== null).length;
  r.confidence = found === 3 ? "medium" : "low";
  r.notes.push("Extracted by simple text heuristics — verify every field before saving.");
  return r;
}

/** Reads the text layer of a PDF (no OCR). Throws on malformed files. */
export async function extractPdfText(data: Buffer, maxPages = 5): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({ data: new Uint8Array(data), useSystemFonts: true, disableFontFace: true, verbosity: 0 });
  const doc = await task.promise;
  try {
    const parts: string[] = [];
    for (let i = 1; i <= Math.min(doc.numPages, maxPages); i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      let line = "";
      for (const item of content.items as any[]) {
        line += item.str;
        line += item.hasEOL ? "\n" : " ";
      }
      parts.push(line);
    }
    return parts.join("\n");
  } finally {
    await task.destroy();
  }
}

const textProvider: OcrProvider = {
  name: "text",
  available: () => ({ ok: true }),
  async extract(data, mime) {
    if (mime !== "application/pdf") {
      const r = emptyResult("text");
      r.notes.push("The local text provider can only read PDFs that contain a text layer. For photos/scans configure an OCR provider (OCR_PROVIDER=anthropic) or enter the details manually.");
      return r;
    }
    const text = await extractPdfText(data);
    const out = { text };
    if (!out.text.trim()) {
      const r = emptyResult("text");
      r.notes.push("This PDF has no text layer (it is probably a scan). Enter the details manually or configure an OCR provider.");
      return r;
    }
    const r = parseReceiptText(out.text);
    r.provider = "text";
    return r;
  },
};

const visionSchema = z.object({
  vendor: z.string().nullable().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  total: z.number().nullable().optional(),
  tax: z.number().nullable().optional(),
  invoice_number: z.string().nullable().optional(),
  line_items: z.array(z.object({ description: z.string(), amount: z.number().nullable().optional(), kind: z.enum(["part", "labour", "other"]).optional() })).optional(),
});

const anthropicProvider: OcrProvider = {
  name: "anthropic",
  available: () => (process.env.ANTHROPIC_API_KEY ? { ok: true } : { ok: false, reason: "ANTHROPIC_API_KEY is not configured" }),
  async extract(data, mime) {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error("ANTHROPIC_API_KEY is not configured");
    const block = mime === "application/pdf" ? { type: "document", source: { type: "base64", media_type: mime, data: data.toString("base64") } } : { type: "image", source: { type: "base64", media_type: mime, data: data.toString("base64") } };
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      signal: AbortSignal.timeout(45_000),
      body: JSON.stringify({
        model: env().AI_MODEL,
        max_tokens: 1200,
        messages: [{ role: "user", content: [block, { type: "text", text: 'Extract fields from this vehicle service receipt/invoice. Reply with ONLY a JSON object: {"vendor":string|null,"date":"YYYY-MM-DD"|null,"total":number|null,"tax":number|null,"invoice_number":string|null,"line_items":[{"description":string,"amount":number|null,"kind":"part"|"labour"|"other"}]}. Use null for anything not clearly present. Do not guess.' }] }],
      }),
    });
    if (!res.ok) throw new Error(`OCR provider returned ${res.status}`);
    const body: any = await res.json();
    const text: string = body.content?.find((c: any) => c.type === "text")?.text ?? "";
    const json = /\{[\s\S]*\}/.exec(text)?.[0];
    if (!json) throw new Error("OCR provider returned no JSON");
    const parsed = visionSchema.parse(JSON.parse(json));
    const r = emptyResult("anthropic");
    r.vendor = parsed.vendor ?? null;
    r.date = parsed.date ?? null;
    r.total = parsed.total ?? null;
    r.tax = parsed.tax ?? null;
    r.invoiceNumber = parsed.invoice_number ?? null;
    r.lineItems = (parsed.line_items ?? []).map((l) => ({ description: l.description, amount: l.amount ?? null, kind: l.kind ?? "other" }));
    r.confidence = "medium";
    r.notes.push("Extracted by an AI vision model — it can misread values. Verify every field before saving.");
    return r;
  },
};

export function getOcrProvider(): OcrProvider | null {
  const name = env().OCR_PROVIDER;
  if (name === "none") return null;
  return name === "anthropic" ? anthropicProvider : textProvider;
}

export async function runOcr(data: Buffer, mime: string): Promise<OcrResult> {
  const p = getOcrProvider();
  if (!p) throw new Error("OCR is not enabled (OCR_PROVIDER=none)");
  const a = p.available();
  if (!a.ok) throw new Error(a.reason);
  try {
    return await p.extract(data, mime);
  } catch (e) {
    logger.warn({ provider: p.name, err: (e as Error).message }, "ocr failed");
    throw e;
  }
}
