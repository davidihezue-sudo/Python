// Receipts and documents attached to finance records (transactions, income, insurance, debts, assets, investments, tax, bills).
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { sha256 } from "@/lib/crypto";
import { storage } from "@/lib/storage";
import { ALLOWED_TYPES, sanitizeFileName, sniffMime } from "../services/documents";
import { audit } from "../services/audit";
import { id, pageQ, optText } from "./common";
import { canSee, requireWriter, type FinCtx } from "./access";
import { FIN_ENTITIES, assertFinanceDocAccess, parentSharing } from "./docaccess";

export const docMetaSchema = z.object({ entity: z.enum(FIN_ENTITIES), entityId: id, title: z.string().trim().max(120).optional(), description: optText(300) });
const CATEGORY: Record<string, "PURCHASE" | "INSURANCE" | "OTHER"> = { transaction: "PURCHASE", bill: "PURCHASE", insurance: "INSURANCE" };

export async function uploadFinanceDocument(ctx: FinCtx, file: { name: string; size: number; data: Buffer }, meta: z.infer<typeof docMetaSchema>) {
  requireWriter(ctx);
  const max = env().MAX_UPLOAD_MB * 1024 * 1024;
  if (file.size > max || file.data.length > max) throw new AppError("PAYLOAD_TOO_LARGE", `Files may be at most ${env().MAX_UPLOAD_MB} MB`);
  if (!file.data.length) throw new AppError("VALIDATION_ERROR", "The file is empty");
  const mime = sniffMime(file.data); // the real type comes from the file contents, never from the client
  if (!mime) throw new AppError("UNSUPPORTED_MEDIA_TYPE", "Only PDF, JPG, PNG and WEBP files are accepted");
  const ext = (file.name.split(".").pop() ?? "").toLowerCase();
  if (ext && !ALLOWED_TYPES[mime].ext.includes(ext)) throw new AppError("UNSUPPORTED_MEDIA_TYPE", "The file extension does not match the file contents");
  await assertFinanceDocAccess(ctx, { householdId: ctx.householdId, finEntity: meta.entity, finEntityId: meta.entityId }, true);
  if (!(await parentSharing(ctx.householdId, meta.entity, meta.entityId))) throw new AppError("NOT_FOUND", "Record not found");
  const docId = randomUUID();
  const fileKey = `h/${ctx.householdId}/${docId}`;
  await storage().put(fileKey, file.data, mime);
  const fileName = sanitizeFileName(file.name);
  try {
    const d = await db.document.create({ data: { id: docId, householdId: ctx.householdId, title: meta.title || fileName.replace(/\.[^.]+$/, ""), category: CATEGORY[meta.entity] ?? "OTHER", description: meta.description ?? null, fileKey, fileName, mimeType: mime, sizeBytes: file.data.length, sha256: sha256(file.data), finEntity: meta.entity, finEntityId: meta.entityId, uploadedById: ctx.actor.id } });
    await audit(null, ctx.actor, { entity: "Document", entityId: d.id, action: "upload", householdId: ctx.householdId, after: { on: meta.entity, size: d.sizeBytes } });
    return { id: d.id, title: d.title, mimeType: d.mimeType, sizeBytes: d.sizeBytes };
  } catch (e) {
    await storage().delete(fileKey).catch(() => undefined);
    throw e;
  }
}

export const docListQuery = z.object({ q: z.string().max(100).optional(), entity: z.enum(FIN_ENTITIES).optional(), entityId: id.optional(), ...pageQ });
/** The searchable library: only documents whose parent record the actor can see. */
export async function listFinanceDocuments(ctx: FinCtx, q: z.infer<typeof docListQuery>) {
  const rows = await db.document.findMany({ where: { householdId: ctx.householdId, deletedAt: null, finEntity: q.entity ? q.entity : { not: null }, ...(q.entityId ? { finEntityId: q.entityId } : {}), ...(q.q ? { OR: [{ title: { contains: q.q, mode: "insensitive" } }, { fileName: { contains: q.q, mode: "insensitive" } }, { description: { contains: q.q, mode: "insensitive" } }] } : {}) }, orderBy: { createdAt: "desc" }, take: 1000 });
  const cache = new Map<string, boolean>();
  const visible = [];
  for (const d of rows) {
    const k = `${d.finEntity}:${d.finEntityId}`;
    if (!cache.has(k)) { const s = await parentSharing(ctx.householdId, d.finEntity as string, d.finEntityId as string); cache.set(k, !!s && canSee(ctx, s)); }
    if (cache.get(k)) visible.push(d);
  }
  const items = visible.slice((q.page - 1) * q.pageSize, q.page * q.pageSize).map((d) => ({ id: d.id, title: d.title, fileName: d.fileName, mimeType: d.mimeType, sizeBytes: d.sizeBytes, entity: d.finEntity, entityId: d.finEntityId, createdAt: d.createdAt.toISOString(), uploadedBy: ctx.members.find((m) => m.userId === d.uploadedById)?.name ?? null }));
  return { items, total: visible.length, page: q.page, pageSize: q.pageSize };
}
export async function deleteFinanceDocument(ctx: FinCtx, docId: string) {
  requireWriter(ctx);
  const d = await db.document.findFirst({ where: { id: docId, householdId: ctx.householdId, deletedAt: null, finEntity: { not: null } } });
  if (!d) throw new AppError("NOT_FOUND", "Document not found");
  await assertFinanceDocAccess(ctx, d, true);
  await db.document.update({ where: { id: d.id }, data: { deletedAt: new Date() } });
  await audit(null, ctx.actor, { entity: "Document", entityId: d.id, action: "delete", householdId: ctx.householdId });
  return { ok: true };
}
