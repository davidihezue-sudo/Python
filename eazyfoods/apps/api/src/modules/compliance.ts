// Compliance: jurisdiction aware document requirements, verification and expiry tracking. Rules are data.
import { query, one, tx, type Db, pool } from '../db.js';
import { badRequest, notFound } from '../errors.js';
import { getSetting } from '../lib/settings.js';
import { notify, notifyVendor, notifyStaff } from '../lib/notifications.js';
import { audit, type Actor } from '../lib/audit.js';

export type OwnerType = 'vendor' | 'driver';

export async function jurisdictionFor(country?: string | null, region?: string | null) {
  if (country && region) return `${country}-${region}`.toUpperCase();
  return (await getSetting('compliance')).jurisdiction;
}

export async function requirementsFor(appliesTo: 'vendor' | 'chef' | 'driver', jurisdiction: string, db: Db = pool) {
  return query<any>(
    `SELECT DISTINCT ON (doc_type) doc_type, label, required, warn_days FROM compliance_rules
      WHERE active AND applies_to = $1 AND jurisdiction IN ($2, '*') ORDER BY doc_type, (jurisdiction = '*') ASC`, [appliesTo, jurisdiction], db);
}

/** Required document types that do not have an acceptable document on file. */
export async function missingDocuments(ownerType: OwnerType, ownerId: string, appliesTo: 'vendor' | 'chef' | 'driver', jurisdiction: string, mode: 'uploaded' | 'verified', db: Db = pool) {
  const reqs = (await requirementsFor(appliesTo, jurisdiction, db)).filter((r) => r.required);
  const docs = await query<any>(`SELECT doc_type, status, expiry_date FROM compliance_documents WHERE owner_type = $1 AND owner_id = $2`, [ownerType, ownerId], db);
  const ok = (type: string) => docs.some((d) => d.doc_type === type && (mode === 'uploaded' ? d.status !== 'rejected' && d.status !== 'expired' : d.status === 'verified' && (!d.expiry_date || new Date(d.expiry_date) >= new Date(new Date().toDateString()))));
  return reqs.filter((r) => !ok(r.doc_type)).map((r) => ({ doc_type: r.doc_type, label: r.label }));
}

export async function addDocument(p: { ownerType: OwnerType; ownerId: string; docType: string; fileId?: string | null; reference?: string; issueDate?: string | null; expiryDate?: string | null }, actor: Actor) {
  if (p.expiryDate && p.issueDate && p.expiryDate < p.issueDate) throw badRequest('VALIDATION', 'The expiry date can not be before the issue date.');
  if (p.fileId) {
    const f = await one('SELECT 1 FROM uploaded_files WHERE id = $1', [p.fileId]);
    if (!f) throw badRequest('VALIDATION', 'We could not find that uploaded file.');
  }
  const doc = await one<any>(
    `INSERT INTO compliance_documents(owner_type, owner_id, doc_type, file_id, reference_number, issue_date, expiry_date) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [p.ownerType, p.ownerId, p.docType, p.fileId ?? null, p.reference ?? null, p.issueDate ?? null, p.expiryDate ?? null]);
  await audit(actor, 'document.uploaded', p.ownerType === 'vendor' ? 'vendor' : 'driver', p.ownerId, { docType: p.docType, docId: doc.id });
  return doc;
}

export async function reviewDocument(docId: string, status: 'verified' | 'rejected', note: string | undefined, actor: Actor) {
  return tx(async (c) => {
    const d = await one<any>('SELECT * FROM compliance_documents WHERE id = $1 FOR UPDATE', [docId], c);
    if (!d) throw notFound('That document');
    if (status === 'rejected' && !note?.trim()) throw badRequest('VALIDATION', 'Please explain why the document was rejected.');
    if (status === 'verified' && d.expiry_date && new Date(d.expiry_date) < new Date(new Date().toDateString())) throw badRequest('EXPIRED_DOC', 'This document is already expired.');
    await query('UPDATE compliance_documents SET status = $2, review_note = $3, reviewed_by = $4, reviewed_at = now() WHERE id = $1', [docId, status, note ?? null, actor.userId], c);
    await audit(actor, `document.${status}`, d.owner_type, d.owner_id, { docType: d.doc_type, note }, c);
    const msg = { kind: 'document_review', title: status === 'verified' ? 'Document verified' : 'Document needs attention', body: status === 'verified' ? `Your ${d.doc_type.replace(/_/g, ' ')} was verified.` : `Your ${d.doc_type.replace(/_/g, ' ')} was rejected: ${note}`, data: { docId } };
    if (d.owner_type === 'vendor') await notifyVendor(d.owner_id, msg, c); else await notify({ userId: d.owner_id, ...msg }, c);
    return { ...d, status };
  });
}

/** Scheduled: mark expired documents and warn before expiry. */
export async function scanDocumentExpiry() {
  const expired = await query<any>("UPDATE compliance_documents SET status = 'expired' WHERE status = 'verified' AND expiry_date < current_date RETURNING *");
  for (const d of expired) {
    const msg = { kind: 'document_expiry', title: 'A document has expired', body: `Your ${d.doc_type.replace(/_/g, ' ')} expired. Upload a new one to keep selling or delivering.`, data: { docId: d.id } };
    if (d.owner_type === 'vendor') await notifyVendor(d.owner_id, msg); else await notify({ userId: d.owner_id, ...msg });
    await query(`INSERT INTO operational_alerts(kind, severity, title, details, entity_type, entity_id, dedupe_key) VALUES ('document_expired','medium',$1,$2,$3,$4,$5) ON CONFLICT (dedupe_key) DO NOTHING`,
      [`${d.owner_type} document expired: ${d.doc_type}`, JSON.stringify({ docId: d.id }), d.owner_type, d.owner_id, `docexp:${d.id}`]);
  }
  const rules = await query<any>('SELECT doc_type, max(warn_days) AS warn FROM compliance_rules GROUP BY doc_type');
  const warnFor = (t: string) => Number(rules.find((r) => r.doc_type === t)?.warn ?? 30);
  const soon = await query<any>("SELECT * FROM compliance_documents WHERE status = 'verified' AND expiry_notified_at IS NULL AND expiry_date IS NOT NULL AND expiry_date >= current_date");
  let warned = 0;
  for (const d of soon) {
    const days = Math.ceil((new Date(d.expiry_date).getTime() - Date.now()) / 86400000);
    if (days > warnFor(d.doc_type)) continue;
    const msg = { kind: 'document_expiry', title: 'A document is expiring soon', body: `Your ${d.doc_type.replace(/_/g, ' ')} expires in ${days} day${days === 1 ? '' : 's'}. Please upload a renewed copy.`, data: { docId: d.id } };
    if (d.owner_type === 'vendor') await notifyVendor(d.owner_id, msg); else await notify({ userId: d.owner_id, ...msg });
    await query('UPDATE compliance_documents SET expiry_notified_at = now() WHERE id = $1', [d.id]);
    warned++;
  }
  if (expired.length) await notifyStaff('compliance.manage', { kind: 'operational_alert', title: `${expired.length} compliance document(s) expired`, body: 'Review expired documents in the compliance queue.', data: {} });
  return { expired: expired.length, warned };
}
