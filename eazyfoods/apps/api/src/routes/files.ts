import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse, id } from '../lib/util.js';
import { requireUser } from '../lib/rbac.js';
import { saveUpload, readUpload } from '../lib/storage.js';
import { badRequest, notFound, forbidden } from '../errors.js';

const PRIVATE_PURPOSES = ['document', 'proof', 'signature'];
export async function fileRoutes(app: FastifyInstance) {
  app.post('/files', { config: { rateLimit: { max: 40, timeWindow: '1 minute' } } }, async (req, reply) => {
    const a = requireUser(req.auth);
    const file = await req.file();
    if (!file) throw badRequest('UPLOAD_EMPTY', 'Choose a file to upload.');
    const purpose = String((file.fields.purpose as any)?.value ?? 'image');
    if (!['image', 'logo', 'cover', 'product', 'document', 'proof', 'signature', 'review'].includes(purpose)) throw badRequest('VALIDATION', 'Unknown upload type.');
    const buffer = await file.toBuffer();
    if (file.file.truncated) throw badRequest('UPLOAD_TOO_LARGE', 'That file is too large.');
    const saved = await saveUpload({ buffer, originalName: file.filename, ownerUserId: a.user.id, purpose, isPrivate: PRIVATE_PURPOSES.includes(purpose) });
    reply.status(201);
    return saved;
  });
  app.get('/files/:id', async (req, reply) => {
    const fid = parse(z.object({ id }), req.params).id;
    const f = await readUpload(fid);
    if (!f) throw notFound('That file');
    if (f.meta.is_private) {
      const a = requireUser(req.auth);
      if (f.meta.owner_user_id !== a.user.id && !a.perms.has('compliance.read') && !a.perms.has('orders.read') && !a.perms.has('support.read')) throw forbidden();
    }
    reply.header('Content-Type', f.meta.mime).header('X-Content-Type-Options', 'nosniff').header('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'")
      .header('Cache-Control', f.meta.is_private ? 'private, no-store' : 'public, max-age=86400').header('Content-Disposition', 'inline');
    return reply.send(f.data);
  });
}
