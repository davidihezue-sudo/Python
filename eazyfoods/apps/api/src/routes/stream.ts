// Server-Sent Events: real time push for orders, vendor consoles, drivers and the admin command centre.
import type { FastifyInstance } from 'fastify';
import { query, one } from '../db.js';
import { requireUser, vendorAccess } from '../lib/rbac.js';
import { subscribe } from '../lib/events.js';
import { forbidden } from '../errors.js';

export async function streamRoutes(app: FastifyInstance) {
  app.get('/stream', async (req, reply) => {
    const a = requireUser(req.auth);
    const wanted = String((req.query as any).topics ?? '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 20);
    const topics = new Set<string>([`user:${a.user.id}`]);
    for (const t of wanted) {
      const [kind, ref] = t.split(':');
      if (t === 'admin' && (a.perms.has('orders.read') || a.perms.has('analytics.read') || a.perms.has('dispatch.manage'))) topics.add('admin');
      else if (kind === 'vendor' && ref && vendorAccess(a, ref, 'orders')) topics.add(t);
      else if (kind === 'driver' && ref === a.user.id) topics.add(t);
      else if (kind === 'order' && ref) {
        const ok = a.perms.has('orders.read') ||
          (await one('SELECT 1 FROM orders WHERE id = $1 AND user_id = $2', [ref, a.user.id])) ||
          (await one('SELECT 1 FROM suborders s JOIN vendor_users vu ON vu.vendor_id = s.vendor_id WHERE s.order_id = $1 AND vu.user_id = $2', [ref, a.user.id])) ||
          (await one('SELECT 1 FROM delivery_jobs WHERE order_id = $1 AND driver_id = $2', [ref, a.user.id]));
        if (!ok) throw forbidden();
        topics.add(t);
      } else throw forbidden();
    }
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': String(req.headers.origin ?? ''), 'Access-Control-Allow-Credentials': 'true',
    });
    res.write(`event: ready\ndata: ${JSON.stringify({ topics: [...topics] })}\n\n`);
    const unsub = subscribe([...topics], (e) => res.write(`event: ${e.type}\ndata: ${JSON.stringify({ topic: e.topic, ...e.data })}\n\n`));
    const hb = setInterval(() => res.write(': keep-alive\n\n'), 25000);
    req.raw.on('close', () => { clearInterval(hb); unsub(); });
    void query;
  });
}
