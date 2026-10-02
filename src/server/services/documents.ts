import type { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { AppError, notFound } from "@/lib/errors";
import { sha256 } from "@/lib/crypto";
import { isoToDate, todayInTz } from "@/lib/dates";
import { storage } from "@/lib/storage";
import { documentMetaSchema, documentUpdateSchema, ocrConfirmSchema } from "@/lib/validation";
import type { z } from "zod";
import type { Actor } from "../context";
import { getOcrProvider, runOcr, type OcrResult } from "../integrations/ocr";
import { iso, ts } from "../serialize";
import { accessibleVehicles, primaryHouseholdId, requireHouseholdMember, requireVehicle, scopeVehicles } from "./access";
import { audit } from "./audit";
import { getEntitlements, requireFeature } from "./entitlements";

export const ALLOWED_TYPES: Record<string, { ext: string[]; sniff: (b: Buffer) => boolean }> = {
  "application/pdf": { ext: ["pdf"], sniff: (b) => b.subarray(0, 5).toString("latin1") === "%PDF-" },
  "image/jpeg": { ext: ["jpg", "jpeg"], sniff: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  "image/png": { ext: ["png"], sniff: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  "image/webp": { ext: ["webp"], sniff: (b) => b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP" },
};

/** Determine the real type from file contents - the client-supplied MIME type and extension are never trusted. */
export function sniffMime(buf: Buffer): string | null {
  for (const [mime, t] of Object.entries(ALLOWED_TYPES)) if (t.sniff(buf)) return mime;
  return null;
}

export function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "file";
  return base.replace(/[^\w.\- ()]/g, "_").replace(/\.{2,}/g, ".").slice(0, 120) || "file";
}

const FINANCIAL = new Set(["MAINTENANCE_INVOICE", "REPAIR_RECEIPT", "PURCHASE", "INSURANCE", "PARTS_RECEIPT"]);

type DocFull = Prisma.DocumentGetPayload<{ include: { vehicle: { select: { nickname: true } } } }>;
export function documentView(d: DocFull) {
  return {
    id: d.id,
    vehicleId: d.vehicleId,
    vehicleName: d.vehicle?.nickname ?? null,
    title: d.title,
    category: d.category,
    description: d.description,
    fileName: d.fileName,
    mimeType: d.mimeType,
    sizeBytes: d.sizeBytes,
    expiresOn: iso(d.expiresOn),
    uploadedAt: ts(d.createdAt),
    maintenanceRecordId: d.maintenanceRecordId,
    repairIssueId: d.repairIssueId,
    expenseId: d.expenseId,
    partId: d.partId,
    inspectionId: d.inspectionId,
    warrantyId: d.warrantyId,
    ocrStatus: d.ocrStatus,
    ocr: d.ocrResult ?? null,
    url: `/api/documents/${d.id}/file`,
    downloadUrl: `/api/documents/${d.id}/file?download=1`,
  };
}

async function validateLinks(vehicleId: string, m: z.infer<typeof documentMetaSchema>) {
  const checks: Promise<number>[] = [];
  const bad = () => new AppError("VALIDATION_ERROR", "A linked record does not belong to this vehicle");
  const chk = async (p: Promise<number>) => {
    if ((await p) === 0) throw bad();
  };
  if (m.maintenanceRecordId) checks.push(chk(db.maintenanceRecord.count({ where: { id: m.maintenanceRecordId, vehicleId, deletedAt: null } })) as any);
  if (m.repairIssueId) checks.push(chk(db.repairIssue.count({ where: { id: m.repairIssueId, vehicleId, deletedAt: null } })) as any);
  if (m.expenseId) checks.push(chk(db.expense.count({ where: { id: m.expenseId, vehicleId, deletedAt: null } })) as any);
  if (m.partId) checks.push(chk(db.part.count({ where: { id: m.partId, vehicleId, deletedAt: null } })) as any);
  if (m.inspectionId) checks.push(chk(db.inspection.count({ where: { id: m.inspectionId, vehicleId, deletedAt: null } })) as any);
  if (m.warrantyId) checks.push(chk(db.warranty.count({ where: { id: m.warrantyId, vehicleId, deletedAt: null } })) as any);
  await Promise.all(checks);
}

export async function uploadDocument(actor: Actor, file: { name: string; size: number; data: Buffer }, metaIn: z.infer<typeof documentMetaSchema>) {
  const maxBytes = env().MAX_UPLOAD_MB * 1024 * 1024;
  if (file.size > maxBytes || file.data.length > maxBytes) throw new AppError("PAYLOAD_TOO_LARGE", `Files may be at most ${env().MAX_UPLOAD_MB} MB`);
  if (file.data.length === 0) throw new AppError("VALIDATION_ERROR", "The file is empty");
  const mime = sniffMime(file.data);
  if (!mime) throw new AppError("UNSUPPORTED_MEDIA_TYPE", "Only PDF, JPG, PNG and WEBP files are accepted");
  const declaredExt = (file.name.split(".").pop() ?? "").toLowerCase();
  if (declaredExt && !ALLOWED_TYPES[mime].ext.includes(declaredExt)) throw new AppError("UNSUPPORTED_MEDIA_TYPE", "The file extension does not match the file contents");

  let householdId: string;
  const vehicleId: string | null = metaIn.vehicleId ?? null;
  let fin = true;
  if (vehicleId) {
    const r = await requireVehicle(actor, vehicleId, "write");
    householdId = r.vehicle.householdId;
    fin = r.fin;
    await validateLinks(vehicleId, metaIn);
  } else {
    householdId = await primaryHouseholdId(actor);
  }
  if (FINANCIAL.has(metaIn.category) && vehicleId && !fin) throw new AppError("FORBIDDEN", "You don't have permission to store financial documents for this vehicle");

  const ent = await getEntitlements(householdId);
  if (ent.enforced && ent.storageMb !== null) {
    const used = await db.document.aggregate({ where: { householdId, deletedAt: null }, _sum: { sizeBytes: true } });
    if ((used._sum.sizeBytes ?? 0) + file.data.length > ent.storageMb * 1024 * 1024) throw new AppError("PLAN_LIMIT", `Storage limit of ${ent.storageMb} MB for the ${ent.label} plan reached`);
  }

  const id = randomUUID();
  const fileKey = `h/${householdId}/${id}`;
  await storage().put(fileKey, file.data, mime);
  const fileName = sanitizeFileName(file.name);
  let doc: DocFull;
  try {
    doc = await db.document.create({
      data: {
        id,
        householdId,
        vehicleId,
        title: metaIn.title || fileName.replace(/\.[^.]+$/, ""),
        category: metaIn.category,
        description: metaIn.description ?? null,
        fileKey,
        fileName,
        mimeType: mime,
        sizeBytes: file.data.length,
        sha256: sha256(file.data),
        expiresOn: metaIn.expiresOn ? isoToDate(metaIn.expiresOn) : null,
        maintenanceRecordId: metaIn.maintenanceRecordId ?? null,
        repairIssueId: metaIn.repairIssueId ?? null,
        expenseId: metaIn.expenseId ?? null,
        partId: metaIn.partId ?? null,
        inspectionId: metaIn.inspectionId ?? null,
        warrantyId: metaIn.warrantyId ?? null,
        uploadedById: actor.id,
      },
      include: { vehicle: { select: { nickname: true } } },
    });
  } catch (e) {
    await storage().delete(fileKey).catch(() => undefined);
    throw e;
  }
  await audit(null, actor, { entity: "Document", entityId: doc.id, action: "upload", vehicleId, householdId, after: { category: doc.category, size: doc.sizeBytes, mime } });
  let ocr: OcrResult | null = null;
  let ocrError: string | null = null;
  if (metaIn.runOcr) {
    try {
      ocr = await extractOcr(actor, doc.id);
    } catch (e) {
      ocrError = (e as Error).message;
    }
  }
  return { document: documentView((await db.document.findUniqueOrThrow({ where: { id: doc.id }, include: { vehicle: { select: { nickname: true } } } }))), ocr, ocrError };
}

export async function getDocumentForActor(actor: Actor, id: string, opts: { requireWrite?: boolean } = {}) {
  const d = await db.document.findFirst({ where: { id, deletedAt: null }, include: { vehicle: { select: { nickname: true } } } });
  if (!d) throw notFound("Document");
  if (d.vehicleId) {
    const { fin } = await requireVehicle(actor, d.vehicleId, opts.requireWrite ? "write" : "view");
    if (FINANCIAL.has(d.category) && !fin) throw notFound("Document");
  } else {
    await requireHouseholdMember(actor, d.householdId);
    // A document attached to a finance record is exactly as visible as that record (private receipts stay private).
    if (d.finEntity) {
      const { finCtx } = await import("../finance/access");
      await (await import("../finance/docaccess")).assertFinanceDocAccess(await finCtx(actor, d.householdId, opts.requireWrite ? "write" : "read"), d, !!opts.requireWrite);
    }
  }
  return d;
}

export async function readDocumentFile(actor: Actor, id: string) {
  const d = await getDocumentForActor(actor, id);
  const data = await storage().get(d.fileKey);
  if (!data) throw notFound("File");
  return { data, mime: d.mimeType, fileName: d.fileName, sha256: d.sha256 };
}

export async function listDocuments(actor: Actor, q: { vehicleId?: string; category?: string; q?: string; expiring?: boolean; maintenanceRecordId?: string; repairIssueId?: string; expenseId?: string; partId?: string; page?: number; pageSize?: number }) {
  const scope = await scopeVehicles(actor, q.vehicleId, "view");
  const allowedVehicle = scope.map((s) => s.vehicle.id);
  const noFin = scope.filter((s) => !s.fin).map((s) => s.vehicle.id);
  const memberships = q.vehicleId && q.vehicleId !== "all" ? [] : (await db.householdMember.findMany({ where: { userId: actor.id } })).map((m) => m.householdId);
  const where: Prisma.DocumentWhereInput = {
    deletedAt: null,
    OR: [{ vehicleId: { in: allowedVehicle } }, ...(memberships.length ? [{ vehicleId: null, finEntity: null, householdId: { in: memberships } }] : [])],
    AND: [
      ...(noFin.length ? [{ NOT: { vehicleId: { in: noFin }, category: { in: [...FINANCIAL] as any } } }] : []),
      ...(q.category ? [{ category: q.category as any }] : []),
      ...(q.q ? [{ OR: [{ title: { contains: q.q, mode: "insensitive" as const } }, { description: { contains: q.q, mode: "insensitive" as const } }, { fileName: { contains: q.q, mode: "insensitive" as const } }] }] : []),
      ...(q.expiring ? [{ expiresOn: { not: null } }] : []),
      ...(q.maintenanceRecordId ? [{ maintenanceRecordId: q.maintenanceRecordId }] : []),
      ...(q.repairIssueId ? [{ repairIssueId: q.repairIssueId }] : []),
      ...(q.expenseId ? [{ expenseId: q.expenseId }] : []),
      ...(q.partId ? [{ partId: q.partId }] : []),
    ],
  };
  const page = Math.max(1, q.page ?? 1);
  const pageSize = Math.min(100, q.pageSize ?? 30);
  const [total, rows] = await Promise.all([db.document.count({ where }), db.document.findMany({ where, include: { vehicle: { select: { nickname: true } } }, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize })]);
  return { items: rows.map(documentView), page, pageSize, total };
}

export async function updateDocument(actor: Actor, id: string, input: z.infer<typeof documentUpdateSchema>) {
  const d = await getDocumentForActor(actor, id, { requireWrite: true });
  if (d.vehicleId) await validateLinks(d.vehicleId, input as any);
  await db.document.update({
    where: { id },
    data: {
      ...(input.title ? { title: input.title } : {}),
      ...(input.category ? { category: input.category } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.expiresOn !== undefined ? { expiresOn: input.expiresOn ? isoToDate(input.expiresOn) : null } : {}),
      ...(input.maintenanceRecordId !== undefined ? { maintenanceRecordId: input.maintenanceRecordId } : {}),
      ...(input.repairIssueId !== undefined ? { repairIssueId: input.repairIssueId } : {}),
      ...(input.expenseId !== undefined ? { expenseId: input.expenseId } : {}),
      ...(input.partId !== undefined ? { partId: input.partId } : {}),
      ...(input.inspectionId !== undefined ? { inspectionId: input.inspectionId } : {}),
      ...(input.warrantyId !== undefined ? { warrantyId: input.warrantyId } : {}),
    },
  });
  return { id };
}

export async function deleteDocument(actor: Actor, id: string) {
  const d = await getDocumentForActor(actor, id, { requireWrite: true });
  await db.document.update({ where: { id }, data: { deletedAt: new Date() } });
  // The stored object is removed by the purge job after the retention window so accidental deletes are recoverable by an operator.
  await audit(null, actor, { entity: "Document", entityId: id, action: "delete", vehicleId: d.vehicleId, householdId: d.householdId });
  return { ok: true };
}

// ───────── OCR (optional) - extraction is advisory; records are only created by confirmOcr()

export async function extractOcr(actor: Actor, id: string) {
  const d = await getDocumentForActor(actor, id, { requireWrite: true });
  if (!getOcrProvider()) throw new AppError("BAD_REQUEST", "Receipt OCR is not enabled on this server");
  await requireFeature(d.householdId, "ocr");
  const data = await storage().get(d.fileKey);
  if (!data) throw notFound("File");
  await db.document.update({ where: { id }, data: { ocrStatus: "PENDING" } });
  try {
    const result = await runOcr(data, d.mimeType);
    await db.document.update({ where: { id }, data: { ocrStatus: "EXTRACTED", ocrResult: result as any } });
    return result;
  } catch (e) {
    await db.document.update({ where: { id }, data: { ocrStatus: "FAILED", ocrResult: { error: (e as Error).message } as any } });
    throw new AppError("BAD_REQUEST", (e as Error).message);
  }
}

/** Creates an expense from USER-VERIFIED values (never from raw OCR output). */
export async function confirmOcr(actor: Actor, id: string, input: z.infer<typeof ocrConfirmSchema>) {
  const d = await getDocumentForActor(actor, id, { requireWrite: true });
  const { vehicle } = await requireVehicle(actor, input.vehicleId, "viewFinancials");
  await requireVehicle(actor, input.vehicleId, "write");
  if (vehicle.householdId !== d.householdId) throw new AppError("VALIDATION_ERROR", "Document and vehicle belong to different households");
  if ((input.tax ?? 0) > input.total) throw new AppError("VALIDATION_ERROR", "Tax cannot exceed the total");
  const out = await db.$transaction(async (tx) => {
    const e = await tx.expense.create({ data: { vehicleId: vehicle.id, date: isoToDate(input.date), amount: input.total, tax: input.tax ?? 0, currency: vehicle.currency, category: input.category, vendor: input.vendor ?? null, description: input.description ?? (input.invoiceNumber ? `Invoice ${input.invoiceNumber}` : null), createdById: actor.id } });
    await tx.document.update({ where: { id }, data: { expenseId: e.id, vehicleId: vehicle.id, ocrStatus: "CONFIRMED" } });
    await audit(tx, actor, { entity: "Expense", entityId: e.id, action: "create-from-ocr", vehicleId: vehicle.id, householdId: vehicle.householdId, after: { documentId: id, amount: input.total } });
    return e.id;
  });
  return { expenseId: out };
}

export async function documentSummary(actor: Actor, vehicleId?: string) {
  const scope = await accessibleVehicles(actor, "view", vehicleId && vehicleId !== "all" ? { vehicleId } : {});
  const ids = scope.map((s) => s.vehicle.id);
  const today = todayInTz(actor.prefs.timezone);
  const [count, expiring] = await Promise.all([db.document.count({ where: { vehicleId: { in: ids }, deletedAt: null } }), db.document.count({ where: { vehicleId: { in: ids }, deletedAt: null, expiresOn: { not: null, lte: isoToDate(new Date(Date.parse(today) + 60 * 86400000).toISOString().slice(0, 10)) } } })]);
  return { count, expiring };
}
