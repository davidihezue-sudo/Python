import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import { randomUUID } from 'node:crypto';
import { config } from './config.js';
import { AppError } from './errors.js';
import { loadAuth, type AuthCtx } from './lib/auth.js';
import { actorFrom, type Actor } from './lib/audit.js';
import { registerAllJobs } from './jobs-registry.js';
import { startEventBridge } from './lib/events.js';
import { authRoutes } from './routes/auth.js';
import { publicRoutes } from './routes/public.js';
import { customerRoutes } from './routes/customer.js';
import { vendorRoutes } from './routes/vendor.js';
import { driverRoutes } from './routes/driver.js';
import { marketingRoutes } from './routes/marketing.js';
import { adminRoutes } from './routes/admin.js';
import { supportRoutes } from './routes/support.js';
import { streamRoutes } from './routes/stream.js';
import { fileRoutes } from './routes/files.js';

declare module 'fastify' {
  interface FastifyRequest { auth: AuthCtx | null; actor: Actor; viaCookie: boolean }
}
export const SESSION_COOKIE = 'ez_session';
export const CART_COOKIE = 'ez_cart';

export async function buildApp(opts: { strictLimits?: boolean; bridge?: boolean } = {}): Promise<FastifyInstance> {
  registerAllJobs();
  const app = Fastify({
    logger: config.logLevel === 'silent' ? false : { level: config.logLevel, redact: ['req.headers.authorization', 'req.headers.cookie', 'body.password', 'body.paymentToken'] },
    genReqId: () => randomUUID(),
    trustProxy: true,
    bodyLimit: 1_000_000,
  });

  await app.register(helmet, { contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' } });
  await app.register(cors, { origin: config.corsOrigins, credentials: true, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], allowedHeaders: ['content-type', 'authorization', 'x-requested-with', 'x-idempotency-key'] });
  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: config.storage.maxBytes, files: 1 } });
  await app.register(rateLimit, { global: true, max: opts.strictLimits ? 120 : config.isTest ? 100000 : 600, timeWindow: '1 minute', allowList: opts.strictLimits ? [] : undefined });

  app.decorateRequest('auth', null);
  app.decorateRequest('actor', null as any);
  app.decorateRequest('viaCookie', false);

  app.addHook('onRequest', async (req) => {
    const bearer = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : undefined;
    const cookieTok = req.cookies?.[SESSION_COOKIE];
    req.viaCookie = !bearer && !!cookieTok;
    req.auth = await loadAuth(bearer ?? cookieTok);
    req.actor = actorFrom(req.auth, req);
  });

  // CSRF: cookie authenticated writes must carry a header browsers will not send cross-site without a CORS preflight,
  // and any Origin header must be one of ours. SameSite=Lax cookies add a second layer.
  app.addHook('preValidation', async (req) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return;
    const origin = req.headers.origin;
    if (origin && !config.corsOrigins.includes(origin)) throw new AppError('BAD_ORIGIN', 403, 'That request was blocked for your safety. Please reload the page and try again.');
    if (req.viaCookie && req.headers['x-requested-with'] !== 'ezweb' && !config.isTest) {
      throw new AppError('CSRF', 403, 'Your session needs to be refreshed. Please reload the page and try again.');
    }
  });

  app.setErrorHandler((err: any, req: FastifyRequest, reply: FastifyReply) => {
    if (err instanceof AppError) {
      if (err.internal) req.log.warn({ code: err.code, internal: err.internal }, 'handled error');
      return reply.status(err.status).send({ error: { code: err.code, message: err.message, details: err.details } });
    }
    if (err.code === 'FST_ERR_CTP_BODY_TOO_LARGE' || err.statusCode === 413) return reply.status(413).send({ error: { code: 'TOO_LARGE', message: 'That upload is too large.' } });
    if (err.statusCode === 429) return reply.status(429).send({ error: { code: 'RATE_LIMITED', message: 'You are doing that too quickly. Please wait a moment and try again.' } });
    if (err.validation || err.statusCode === 400) return reply.status(400).send({ error: { code: 'VALIDATION', message: 'Something in your request was not valid. Please check it and try again.' } });
    // Postgres constraint failures never reach customers verbatim.
    if (err.code === '23505') return reply.status(409).send({ error: { code: 'DUPLICATE', message: 'That already exists.' } });
    if (err.code === '23514' && String(err.constraint).includes('inv_')) return reply.status(409).send({ error: { code: 'INSUFFICIENT_STOCK', message: 'That item just sold out or does not have enough stock. Please update your cart.' } });
    if (err.code === '23503') return reply.status(400).send({ error: { code: 'INVALID_REFERENCE', message: 'One of the items you referenced does not exist.' } });
    if (err.code === '22P02') return reply.status(400).send({ error: { code: 'VALIDATION', message: 'Something in your request was not valid.' } });
    req.log.error({ err, reqId: req.id }, 'unhandled error');
    return reply.status(500).send({ error: { code: 'SERVER_ERROR', message: 'Something went wrong on our side. Please try again in a moment.', reference: req.id } });
  });
  app.setNotFoundHandler((_req, reply) => reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'That could not be found.' } }));

  app.get('/api/health', async () => ({ ok: true, time: new Date().toISOString() }));
  app.get('/api/ready', async (_req, reply) => {
    try { await (await import('./db.js')).pool.query('SELECT 1'); return { ok: true }; } catch { return reply.status(503).send({ ok: false }); }
  });

  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(publicRoutes, { prefix: '/api' });
  await app.register(customerRoutes, { prefix: '/api' });
  await app.register(vendorRoutes, { prefix: '/api/vendors' });
  await app.register(driverRoutes, { prefix: '/api/drivers' });
  await app.register(marketingRoutes, { prefix: '/api/marketing' });
  await app.register(supportRoutes, { prefix: '/api' });
  await app.register(adminRoutes, { prefix: '/api/admin' });
  await app.register(streamRoutes, { prefix: '/api' });
  await app.register(fileRoutes, { prefix: '/api' });

  if (opts.bridge) await startEventBridge();
  return app;
}

export function setSessionCookie(reply: FastifyReply, token: string) {
  reply.setCookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: config.secureCookies, path: '/', maxAge: config.sessionTtlDays * 86400, domain: config.cookieDomain });
}
export function clearSessionCookie(reply: FastifyReply) { reply.clearCookie(SESSION_COOKIE, { path: '/', domain: config.cookieDomain }); }
