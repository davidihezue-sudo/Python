// File storage behind a small interface. Local disk implementation; S3 compatible stores plug in here.
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { config } from '../config.js';
import { one } from '../db.js';
import { AppError } from '../errors.js';

const SIGNATURES: { mime: string; ext: string; test: (b: Buffer) => boolean }[] = [
  { mime: 'image/png', ext: 'png', test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'image/jpeg', ext: 'jpg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/gif', ext: 'gif', test: (b) => b.subarray(0, 4).toString('latin1') === 'GIF8' },
  { mime: 'image/webp', ext: 'webp', test: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
  { mime: 'application/pdf', ext: 'pdf', test: (b) => b.subarray(0, 5).toString('latin1') === '%PDF-' },
];

/** Detect file type from content, never from the client supplied name or header. */
export function sniff(buf: Buffer) {
  return SIGNATURES.find((s) => s.test(buf)) ?? null;
}

export async function saveUpload(opts: { buffer: Buffer; originalName?: string; ownerUserId: string | null; purpose: string; isPrivate?: boolean }) {
  if (opts.buffer.length === 0) throw new AppError('UPLOAD_EMPTY', 400, 'That file is empty.');
  if (opts.buffer.length > config.storage.maxBytes) throw new AppError('UPLOAD_TOO_LARGE', 413, `Files can be up to ${Math.round(config.storage.maxBytes / 1048576)} MB.`);
  const kind = sniff(opts.buffer);
  if (!kind) throw new AppError('UPLOAD_TYPE', 400, 'Please upload a PNG, JPG, WebP, GIF or PDF file.');
  const key = `${new Date().toISOString().slice(0, 7)}/${randomBytes(18).toString('hex')}.${kind.ext}`;
  const full = join(config.storage.localDir, key);
  await mkdir(join(full, '..'), { recursive: true });
  await writeFile(full, opts.buffer);
  const row = await one<{ id: string }>(
    `INSERT INTO uploaded_files(owner_user_id, purpose, original_name, mime, bytes, storage_key, is_private) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [opts.ownerUserId, opts.purpose, opts.originalName?.slice(0, 200) ?? null, kind.mime, opts.buffer.length, key, opts.isPrivate ?? false]);
  return { id: row!.id, url: `${config.storage.publicBase}/${row!.id}`, mime: kind.mime };
}

export async function readUpload(fileId: string) {
  const f = await one<any>('SELECT * FROM uploaded_files WHERE id = $1', [fileId]);
  if (!f) return null;
  return { meta: f, data: await readFile(join(config.storage.localDir, f.storage_key)) };
}
