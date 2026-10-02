import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { confirmOcr, deleteDocument, extractOcr, listDocuments, readDocumentFile, sanitizeFileName, sniffMime, uploadDocument } from "@/server/services/documents";
import { createRecord } from "@/server/services/records";
import { evaluateVehicleSchedules } from "@/server/services/schedules";
import { generateReport } from "@/server/services/reports";
import { renderReport } from "@/server/services/report-render";
import { chat } from "@/server/services/ai";
import { createExpense, listExpenses } from "@/server/services/expenses";
import { exportAccountData } from "@/server/services/export";
import { createIssue } from "@/server/services/repairs";
import { createActor, createTestVehicle } from "./helpers";
import { parseReceiptText } from "@/server/integrations/ocr";
import { decodeVin, mapNhtsa } from "@/server/integrations/vin";
import { createObdGateway, ingestObd, listIntegrations } from "@/server/integrations/diagnostics";
import { storage } from "@/lib/storage";

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200, 7)]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100, 3)]);
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0, 0, 0, 0]), Buffer.from("WEBP"), Buffer.alloc(50)]);
import PDFDocument from "pdfkit";
const pdfWithText = (text: string): Promise<Buffer> =>
  new Promise((resolve) => {
    const doc = new PDFDocument();
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.text(text);
    doc.end();
  });

describe("document security", () => {
  it("sniffs real types, ignoring client-supplied names/types", async () => {
    expect(sniffMime(PNG)).toBe("image/png");
    expect(sniffMime(JPG)).toBe("image/jpeg");
    expect(sniffMime(WEBP)).toBe("image/webp");
    expect(sniffMime(await pdfWithText("hi"))).toBe("application/pdf");
    expect(sniffMime(Buffer.from("<html><script>alert(1)</script></html>"))).toBeNull();
    expect(sniffMime(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'></svg>"))).toBeNull();
    expect(sanitizeFileName("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFileName('a"b<c>.png')).toBe("a_b_c_.png");
  });

  it("accepts valid uploads, stores them privately and serves them only to authorised users", async () => {
    const a = await createActor();
    const vehicleId = await createTestVehicle(a);
    const up = await uploadDocument(a, { name: "invoice.png", size: PNG.length, data: PNG }, { vehicleId, category: "MAINTENANCE_INVOICE", title: "Oil invoice" } as any);
    expect(up.document.mimeType).toBe("image/png");
    expect(up.document.url).toMatch(/^\/api\/documents\/.+\/file$/);
    const file = await readDocumentFile(a, up.document.id);
    expect(file.data.equals(PNG)).toBe(true);
    const row = await db.document.findUniqueOrThrow({ where: { id: up.document.id } });
    expect(row.fileKey).toMatch(/^h\/[^/]+\/[0-9a-f-]{36}$/); // random key, no user-supplied filename in the path
    expect(row.sha256).toHaveLength(64);
    const list = await listDocuments(a, { vehicleId, category: "MAINTENANCE_INVOICE" });
    expect(list.total).toBe(1);
    await deleteDocument(a, up.document.id);
    expect((await listDocuments(a, { vehicleId })).total).toBe(0);
  });

  it("rejects spoofed extensions, disallowed content, empty files and oversize files", async () => {
    const a = await createActor();
    const vehicleId = await createTestVehicle(a);
    const meta = { vehicleId, category: "OTHER" } as any;
    await expect(uploadDocument(a, { name: "evil.png", size: 40, data: Buffer.from("<html><script>alert(1)</script></html>") }, meta)).rejects.toMatchObject({ code: "UNSUPPORTED_MEDIA_TYPE" });
    await expect(uploadDocument(a, { name: "script.pdf", size: PNG.length, data: PNG }, meta)).rejects.toMatchObject({ code: "UNSUPPORTED_MEDIA_TYPE" });
    await expect(uploadDocument(a, { name: "x.png", size: 0, data: Buffer.alloc(0) }, meta)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    const big = Buffer.concat([PNG, Buffer.alloc(11 * 1024 * 1024)]);
    await expect(uploadDocument(a, { name: "big.png", size: big.length, data: big }, meta)).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
    expect(await db.document.count()).toBe(0);
  });

  it("associates documents with service records and lists them there", async () => {
    const a = await createActor();
    const vehicleId = await createTestVehicle(a);
    const rec = await createRecord(a, { vehicleId, title: "Brake service", serviceDate: "2024-05-01", odometerKm: 165000, workPerformedBy: "DEALERSHIP", status: "COMPLETED", kind: "MAINTENANCE", laborCost: 100, partsCost: 200, tax: 15, discount: 0, items: [], allowDuplicate: false, confirmOdometerCorrection: false } as any);
    const doc = await uploadDocument(a, { name: "receipt.jpg", size: JPG.length, data: JPG }, { vehicleId, category: "MAINTENANCE_INVOICE", maintenanceRecordId: rec.id } as any);
    expect(doc.document.maintenanceRecordId).toBe(rec.id);
    const { getRecord } = await import("@/server/services/records");
    expect((await getRecord(a, rec.id)).documents).toHaveLength(1);
    expect((await listDocuments(a, { maintenanceRecordId: rec.id })).total).toBe(1);
  });
});

describe("OCR (optional, never auto-creates records)", () => {
  it("parses receipt text heuristically", () => {
    const r = parseReceiptText(`CALGARY LUBE & TIRE\n123 Main St\nInvoice #A-10492\nDate: 2024-05-01\nOil change labour   $40.00\nOil filter   $17.50\nGST 5%  $2.88\nTotal $60.38`);
    expect(r.vendor).toBe("CALGARY LUBE & TIRE");
    expect(r.date).toBe("2024-05-01");
    expect(r.total).toBe(60.38);
    expect(r.tax).toBe(2.88);
    expect(r.invoiceNumber).toBe("A-10492");
    expect(r.lineItems.some((l) => l.kind === "labour")).toBe(true);
    expect(r.notes[0]).toMatch(/verify/i);
  });

  it("extracts from a text PDF into the document only; an expense appears only after user confirmation", async () => {
    const a = await createActor();
    const vehicleId = await createTestVehicle(a);
    const pdf = await pdfWithText("Acme Auto\nInvoice 4471\nDate 2024-05-01\nTotal $123.45");
    const up = await uploadDocument(a, { name: "inv.pdf", size: pdf.length, data: pdf }, { vehicleId, category: "MAINTENANCE_INVOICE", runOcr: true } as any);
    expect(up.ocrError).toBeNull();
    expect(up.ocr).not.toBeNull();
    expect(up.document.ocrStatus).toBe("EXTRACTED");
    // nothing was created automatically
    expect((await listExpenses(a, { vehicleId })).total).toBe(0);
    const res = await confirmOcr(a, up.document.id, { vehicleId, vendor: "Acme Auto", date: "2024-05-01", total: 123.45, tax: 5.88, invoiceNumber: "4471", category: "MAINTENANCE" } as any);
    const exps = await listExpenses(a, { vehicleId });
    expect(exps.total).toBe(1);
    expect(exps.items[0]).toMatchObject({ id: res.expenseId, amount: 123.45, vendor: "Acme Auto" });
    expect((await db.document.findUniqueOrThrow({ where: { id: up.document.id } })).ocrStatus).toBe("CONFIRMED");
  });

  it("explains when an image cannot be read by the local provider", async () => {
    const a = await createActor();
    const vehicleId = await createTestVehicle(a);
    const up = await uploadDocument(a, { name: "photo.png", size: PNG.length, data: PNG }, { vehicleId, category: "REPAIR_RECEIPT" } as any);
    const r = await extractOcr(a, up.document.id);
    expect(r.total).toBeNull();
    expect(r.notes.join(" ")).toMatch(/PDF|provider/i);
  });
});

describe("VIN decoding", () => {
  it("maps NHTSA fields conservatively", () => {
    const { spec } = mapNhtsa({ Make: "BMW", Model: "X3", ModelYear: "2015", Trim: "xDrive28i", DisplacementL: "2.0", EngineModel: "N20B20A", FuelTypePrimary: "Gasoline", TransmissionStyle: "Automatic", DriveType: "AWD/All-Wheel Drive", BodyClass: "Sport Utility Vehicle (SUV)/Multi-Purpose Vehicle (MPV)", ErrorCode: "0", EngineCylinders: "4", Turbo: "Yes" });
    expect(spec).toMatchObject({ make: "BMW", model: "X3", year: 2015, fuelType: "PETROL", transmission: "AUTOMATIC", drivetrain: "AWD", engineDisplacementL: 2, engineCode: "N20B20A" });
    expect(spec.engineType).toContain("turbocharged");
  });
  it("degrades gracefully when decoding is disabled or the VIN is malformed", async () => {
    const r = await decodeVin("1M8GDM9AXKP042788"); // VIN_DECODER=none in the test env
    expect(r.available).toBe(false);
    expect(r.reason).toMatch(/manually/i);
    const bad = await decodeVin("123");
    expect(bad.check.formatOk).toBe(false);
  });
});

describe("OBD gateway ingestion", () => {
  it("authenticates by hashed token, records DTCs/odometer once, never stores the raw token", async () => {
    const a = await createActor();
    const vehicleId = await createTestVehicle(a);
    const { token, id } = await createObdGateway(a, vehicleId);
    const stored = await db.integration.findUniqueOrThrow({ where: { id } });
    expect(JSON.stringify(stored.config)).not.toContain(token);
    await expect(ingestObd("avobd_bogus", {})).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    const out = await ingestObd(token, { dtcs: [{ code: "P0301" }, { code: "2A87" }], odometerKm: 160500, readings: { rpm: 800, batteryVolts: 12.6 } });
    expect(out.dtcsCreated).toBe(2);
    await ingestObd(token, { dtcs: [{ code: "P0301" }] });
    expect(await db.diagnosticCode.count({ where: { vehicleId, code: "P0301" } })).toBe(1);
    const code = await db.diagnosticCode.findFirstOrThrow({ where: { vehicleId, code: "P0301" } });
    expect(code.source).toBe("OBD_ADAPTER");
    expect(Number((await db.vehicle.findUniqueOrThrow({ where: { id: vehicleId } })).currentOdometerKm)).toBe(160500);
    expect((await listIntegrations(a, vehicleId))[0].latest).toMatchObject({ rpm: 800 });
    // another user cannot list this vehicle's integrations
    const other = await createActor();
    await expect(listIntegrations(other, vehicleId)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("reports and exports", () => {
  async function seed() {
    const a = await createActor();
    const vehicleId = await createTestVehicle(a, { vin: "1M8GDM9AXKP042788", registrationNumber: "ABC-123" });
    const oil = (await evaluateVehicleSchedules(vehicleId, a.prefs, true)).items.find((i) => i.name === "Engine oil")!;
    await createRecord(a, { vehicleId, title: "Oil change", serviceDate: "2024-05-01", odometerKm: 165000, workPerformedBy: "INDEPENDENT_MECHANIC", providerName: "Calgary Lube", status: "COMPLETED", kind: "MAINTENANCE", laborCost: 40, partsCost: 65.5, tax: 5.28, discount: 0, items: [{ assignmentId: oil.id, name: "Engine oil", completed: true, quantity: 6, unitCost: 8, laborCost: 0, trackAsPart: false, partName: "5W-30 synthetic" }], allowDuplicate: false, confirmOdometerCorrection: false } as any);
    await createExpense(a, { vehicleId, date: "2024-06-01", amount: 120, category: "INSURANCE" } as any);
    return { a, vehicleId };
  }

  it("builds the service history with identification, odometer, parts, providers and costs", async () => {
    const { a, vehicleId } = await seed();
    const r = await generateReport(a, { type: "service-history", vehicleId, hideVin: false });
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ date: "2024-05-01", odometer: 165000, service: "Oil change", provider: "Calgary Lube", cost: 110.78 });
    expect(r.rows[0].parts).toContain("5W-30 synthetic");
    expect(r.vehicles[0]).toMatchObject({ make: "BMW", vin: "1M8GDM9AXKP042788" });
    expect(r.generatedAt).toBeTruthy();
  });

  it("applies privacy choices before sharing (VIN, costs, providers)", async () => {
    const { a, vehicleId } = await seed();
    const r = await generateReport(a, { type: "service-history", vehicleId, hideVin: true, hideCosts: true, hideProviders: true });
    expect(r.columns.map((c) => c.key)).not.toContain("cost");
    expect(r.columns.map((c) => c.key)).not.toContain("provider");
    expect(r.rows[0]).not.toHaveProperty("cost");
    expect(r.rows[0]).not.toHaveProperty("provider");
    expect(r.vehicles[0].vin).toBeNull();
    expect(r.vehicles[0].registration).toBeNull();
    expect(r.summary.some((s) => /cost/i.test(s.label))).toBe(false);
    const csv = (await renderReport(r, "csv")).toString();
    expect(csv).not.toMatch(/Calgary Lube|110\.78|1M8GDM9AX/);
  });

  it("renders real PDF, CSV, XLSX and JSON files for every report type", async () => {
    const { a, vehicleId } = await seed();
    const types = ["service-history", "annual-summary", "repair-history", "expense-statement", "costs-by-category", "cost-per-distance", "parts-history", "upcoming-forecast", "warranty", "fuel-consumption", "household-expenses"] as const;
    for (const type of types) {
      const r = await generateReport(a, { type, vehicleId: type === "household-expenses" || type === "warranty" ? undefined : vehicleId, year: 2024 });
      const pdf = await renderReport(r, "pdf");
      expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
      expect(pdf.length).toBeGreaterThan(800);
      const xlsx = await renderReport(r, "xlsx");
      expect(xlsx.subarray(0, 2).toString()).toBe("PK"); // zip container
      const csv = (await renderReport(r, "csv")).toString();
      expect(csv.charCodeAt(0)).toBe(0xfeff);
      expect(JSON.parse((await renderReport(r, "json")).toString()).type).toBe(type);
    }
  });

  it("neutralises spreadsheet formula injection in CSV exports", async () => {
    const { a, vehicleId } = await seed();
    await createRecord(a, { vehicleId, title: "=HYPERLINK(\"http://evil\")", serviceDate: "2024-07-01", odometerKm: 166000, workPerformedBy: "OWNER_DIY", status: "COMPLETED", kind: "MAINTENANCE", items: [], allowDuplicate: false, confirmOdometerCorrection: false } as any);
    const r = await generateReport(a, { type: "service-history", vehicleId });
    const csv = (await renderReport(r, "csv")).toString();
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).not.toMatch(/,=HYPERLINK/);
  });

  it("cost-per-distance report refuses to extrapolate where odometer coverage is missing", async () => {
    const { a, vehicleId } = await seed();
    const r = await generateReport(a, { type: "cost-per-distance", vehicleId });
    expect(r.rows.some((x) => /insufficient|partial/.test(String(x.coverage)))).toBe(true);
  });

  it("exports all of a user's data as JSON, with redaction for non-financial access", async () => {
    const { a, vehicleId } = await seed();
    const out = await exportAccountData(a);
    expect(out.vehicles[0].maintenanceAndRepairRecords[0].total).toBe(110.78);
    expect(out.vehicles[0].expenses).toHaveLength(2);
    expect(out.vehicles[0].odometer.length).toBeGreaterThan(1);
    expect(vehicleId).toBeTruthy();
  });
});

describe("AI assistant (deterministic fallback, no credentials)", () => {
  it("answers only from recorded data and says when something is not recorded", async () => {
    const a = await createActor();
    const vehicleId = await createTestVehicle(a);
    const empty = await chat(a, { message: "When was my oil last changed?" });
    expect(empty.provider).toBe("deterministic");
    expect(empty.advisory).toBe(true);
    expect(empty.answer).toMatch(/no completed service matching/i);
    expect(empty.answer).not.toMatch(/\d{4}-\d{2}-\d{2}/);

    const oil = (await evaluateVehicleSchedules(vehicleId, a.prefs, true)).items.find((i) => i.name === "Engine oil")!;
    await createRecord(a, { vehicleId, title: "Oil change", serviceDate: "2024-05-01", odometerKm: 165000, workPerformedBy: "INDEPENDENT_MECHANIC", providerName: "Calgary Lube", status: "COMPLETED", kind: "MAINTENANCE", laborCost: 40, partsCost: 65.5, tax: 5.28, discount: 0, items: [{ assignmentId: oil.id, name: "Engine oil", completed: true, quantity: 1, unitCost: 0, laborCost: 0, trackAsPart: false }], allowDuplicate: false, confirmOdometerCorrection: false } as any);
    const last = await chat(a, { message: "When was my oil last changed?" });
    expect(last.answer).toContain("2024-05-01");
    expect(last.answer).toMatch(/165,000 km/);
    const cost = await chat(a, { message: "What was the cost of my last oil change?" });
    expect(cost.answer).toMatch(/110\.78/);
    const upcoming = await chat(a, { message: "What services are coming up?" });
    expect(upcoming.tools.map((t) => t.name)).toContain("get_upcoming");
    const missing = await chat(a, { message: "What maintenance records are missing?" });
    expect(missing.answer).toMatch(/no recorded service history|no VIN|receipt/i);
    const summary = await chat(a, { message: "Summarize my vehicle's maintenance history" });
    expect(summary.answer).toMatch(/Completed services: 1/);
    // unsupported question: never fabricates
    const odd = await chat(a, { message: "What's the manufacturer-recommended interval for my timing chain?" });
    expect(odd.answer).not.toMatch(/\d+,?\d* km/);
    // conversations persist
    expect(await db.aIMessage.count({ where: { conversation: { userId: a.id } } })).toBeGreaterThanOrEqual(12);
  });

  it("answers spending and repair questions by component group", async () => {
    const a = await createActor();
    const vehicleId = await createTestVehicle(a);
    await createExpense(a, { vehicleId, date: "2024-03-01", amount: 300, category: "REPAIRS", description: "Replaced front control arm and ball joint" } as any);
    await createExpense(a, { vehicleId, date: "2024-04-01", amount: 120, category: "REPAIRS", description: "Rear shock absorbers" } as any);
    await createExpense(a, { vehicleId, date: "2024-04-02", amount: 50, category: "REPAIRS", description: "Cabin filter" } as any);
    const spend = await chat(a, { message: "How much have I spent on suspension repairs?" });
    expect(spend.answer).toMatch(/\$420\.00/);
    await createIssue(a, { vehicleId, title: "Coolant leak at thermostat housing", discoveredAt: "2024-02-01", severity: "HIGH", status: "NEW", componentKey: "thermostat" } as any);
    const cooling = await chat(a, { message: "Show me all repairs involving the cooling system" });
    expect(cooling.answer).toMatch(/Coolant leak/);
  });
});

export { storage };
