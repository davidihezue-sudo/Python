import PDFDocument from "pdfkit";
import ExcelJS from "exceljs";
import { formatMoney } from "@/lib/money";
import type { Column, ReportData } from "./reports";

const latin1 = (s: string) =>
  s
    .replace(/[–-]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/→/g, "->")
    .replace(/×/g, "x")
    .replace(/[^\x20-\x7E -ÿ]/g, "?");

function fmt(v: string | number | null | undefined, c: Column, currency: string): string {
  if (v === null || v === undefined || v === "") return "";
  if (typeof v === "number") {
    if (c.format === "money") return formatMoney(v, currency);
    if (c.format === "percent") return `${v}%`;
    return new Intl.NumberFormat("en-CA", { maximumFractionDigits: 3 }).format(v);
  }
  return String(v);
}

// ───────── CSV (UTF-8 with BOM so Excel opens it correctly). Cells starting with = + - @ are neutralised against formula injection.
export function renderCsv(r: ReportData): Buffer {
  const esc = (v: string | number | null | undefined) => {
    if (v === null || v === undefined) return "";
    let s = String(v);
    if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [r.columns.map((c) => esc(c.label)).join(",")];
  for (const row of r.rows) lines.push(r.columns.map((c) => esc(row[c.key] as any)).join(","));
  if (r.summary.length) {
    lines.push("");
    for (const s of r.summary) lines.push(`${esc(s.label)},${esc(s.value)}`);
  }
  return Buffer.from("﻿" + lines.join("\r\n") + "\r\n", "utf8");
}

export function renderJson(r: ReportData): Buffer {
  return Buffer.from(JSON.stringify(r, null, 2), "utf8");
}

export async function renderXlsx(r: ReportData): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Family Finance Hub";
  wb.created = new Date(r.generatedAt);
  const ws = wb.addWorksheet(r.title.slice(0, 31).replace(/[\\/*?:[\]]/g, " "));
  ws.addRow([r.title]).font = { bold: true, size: 14 };
  if (r.subtitle) ws.addRow([r.subtitle]);
  for (const v of r.vehicles) ws.addRow([`${v.year} ${v.make} ${v.model}${v.trim ? " " + v.trim : ""}${v.vin ? "  VIN " + v.vin : ""}${v.odometer ? "  Odometer " + v.odometer : ""}`]);
  ws.addRow([`Generated ${r.generatedAt.slice(0, 10)}`]);
  ws.addRow([]);
  const header = ws.addRow(r.columns.map((c) => c.label));
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF131B18" } };
  for (const row of r.rows) {
    const cells = r.columns.map((c) => {
      const v = row[c.key];
      return typeof v === "string" && /^[=+\-@]/.test(v) ? `'${v}` : v ?? null;
    });
    ws.addRow(cells);
  }
  r.columns.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    col.width = Math.min(60, Math.max(12, c.label.length + 4, ...(r.rows.slice(0, 50).map((x) => String(x[c.key] ?? "").length) as number[])));
    if (c.format === "money") col.numFmt = '"$"#,##0.00';
    if (c.align === "right") col.alignment = { horizontal: "right" };
  });
  if (r.summary.length) {
    ws.addRow([]);
    for (const s of r.summary) {
      const row = ws.addRow([s.label, s.value]);
      row.font = { bold: true };
    }
  }
  for (const n of r.notes) ws.addRow([n]).font = { italic: true, color: { argb: "FF6B7280" } };
  ws.views = [{ state: "frozen", ySplit: 3 + r.vehicles.length + 2 }];
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function renderPdf(r: ReportData): Promise<Buffer> {
  const landscape = r.columns.length > 6;
  const doc = new PDFDocument({ size: "LETTER", layout: landscape ? "landscape" : "portrait", margin: 36, bufferPages: true, info: { Title: r.title, Author: "Family Finance Hub", Subject: r.title } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((res) => doc.on("end", () => res(Buffer.concat(chunks))));
  const W = doc.page.width - 72;
  const ink = "#111827";
  const muted = "#6B7280";
  const accent = "#185040";

  doc.rect(0, 0, doc.page.width, 64).fill("#131B18");
  doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(18).text("Family Finance Hub", 36, 20, { continued: true }).font("Helvetica").fontSize(11).fillColor("#D8C9A3").text(`   ${r.vehicles.length ? "Vehicle report" : "Financial report"}`);
  doc.fillColor(ink).font("Helvetica-Bold").fontSize(16).text(latin1(r.title), 36, 80);
  if (r.subtitle) doc.font("Helvetica").fontSize(10).fillColor(muted).text(latin1(r.subtitle));
  doc.moveDown(0.5);
  for (const v of r.vehicles.slice(0, 6)) {
    doc.font("Helvetica-Bold").fontSize(10.5).fillColor(ink).text(latin1(`${v.year} ${v.make} ${v.model}${v.trim ? " " + v.trim : ""}`), { continued: true }).font("Helvetica").fillColor(muted).text(latin1(`   ${v.name !== `${v.year} ${v.make} ${v.model}` ? `"${v.name}"  ` : ""}${v.vin ? "VIN " + v.vin + "  " : ""}${v.registration ? "Plate " + v.registration + "  " : ""}${v.odometer ? "Odometer " + v.odometer : ""}`));
  }
  doc.font("Helvetica").fontSize(9).fillColor(muted).text(`Generated ${r.generatedAt.slice(0, 10)} for ${latin1(r.generatedFor)}`);
  doc.moveDown(0.8);

  const widths = r.columns.map((c) => c.width ?? 70);
  const scale = W / widths.reduce((a, b) => a + b, 0);
  const cw = widths.map((w) => w * scale);
  const drawHeader = () => {
    const y = doc.y;
    doc.rect(36, y, W, 18).fill("#1F2937");
    let x = 36;
    doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(7.5);
    r.columns.forEach((c, i) => {
      doc.text(latin1(c.label), x + 3, y + 5, { width: cw[i] - 6, align: c.align ?? "left", lineBreak: false, ellipsis: true });
      x += cw[i];
    });
    doc.y = y + 20;
  };
  drawHeader();
  let zebra = false;
  const cur = r.units.currency;
  doc.font("Helvetica").fontSize(7.5);
  for (const row of r.rows) {
    const texts = r.columns.map((c) => latin1(fmt(row[c.key], c, cur)));
    const heights = texts.map((t, i) => doc.heightOfString(t, { width: cw[i] - 6 }));
    const h = Math.max(14, Math.max(...heights) + 6);
    if (doc.y + h > doc.page.height - 56) {
      doc.addPage();
      drawHeader();
      doc.font("Helvetica").fontSize(7.5);
    }
    const y = doc.y;
    if (zebra) doc.rect(36, y, W, h).fill("#F3F4F6");
    zebra = !zebra;
    let x = 36;
    doc.fillColor(ink);
    texts.forEach((t, i) => {
      doc.text(t, x + 3, y + 3, { width: cw[i] - 6, align: r.columns[i].align ?? "left" });
      x += cw[i];
    });
    doc.y = y + h;
  }
  if (!r.rows.length) doc.font("Helvetica-Oblique").fontSize(9).fillColor(muted).text("No records match this report.", 36, doc.y + 6);
  if (r.summary.length) {
    doc.moveDown(1);
    if (doc.y > doc.page.height - 110) doc.addPage();
    doc.font("Helvetica-Bold").fontSize(10).fillColor(accent).text("Summary", 36);
    doc.moveDown(0.3);
    for (const s of r.summary) {
      doc.font("Helvetica").fontSize(9).fillColor(ink).text(latin1(`${s.label}: `), { continued: true }).font("Helvetica-Bold").text(latin1(typeof s.value === "number" && /cost|spent|total|household/i.test(s.label) ? formatMoney(s.value, cur) : String(s.value)));
    }
  }
  doc.moveDown(0.8);
  for (const n of r.notes) doc.font("Helvetica-Oblique").fontSize(8).fillColor(muted).text(latin1(n), 36, doc.y, { width: W });
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.font("Helvetica").fontSize(8).fillColor(muted).text(`Page ${i + 1} of ${range.count}`, 36, doc.page.height - 30, { width: W, align: "right", lineBreak: false });
    doc.text("Family Finance Hub - figures are based on records entered by household members", 36, doc.page.height - 30, { width: W / 2, align: "left", lineBreak: false });
  }
  doc.end();
  return done;
}

export const REPORT_FORMATS = {
  pdf: { mime: "application/pdf", ext: "pdf" },
  csv: { mime: "text/csv; charset=utf-8", ext: "csv" },
  xlsx: { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ext: "xlsx" },
  json: { mime: "application/json", ext: "json" },
} as const;
export type ReportFormat = keyof typeof REPORT_FORMATS;

export async function renderReport(r: ReportData, format: ReportFormat): Promise<Buffer> {
  switch (format) {
    case "csv":
      return renderCsv(r);
    case "json":
      return renderJson(r);
    case "xlsx":
      return renderXlsx(r);
    case "pdf":
      return renderPdf(r);
  }
}
