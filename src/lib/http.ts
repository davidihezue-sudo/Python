import { NextRequest, NextResponse } from "next/server";
import { ZodError, type ZodTypeAny, z } from "zod";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { AppError } from "./errors";
import { captureError } from "./logger";
import { rateLimit } from "./rate-limit";
import { SESSION_COOKIE, resolveSession } from "./auth/session";
import { actorFromUser, type Actor } from "@/server/context";
import { env } from "./env";

export interface RouteContext<Q, B> {
  req: NextRequest;
  actor: Actor;
  params: Record<string, string>;
  query: Q;
  body: B;
  ip: string | null;
  requestId: string;
  sessionToken: string | null;
}

export interface RouteOptions<QS extends ZodTypeAny | undefined, BS extends ZodTypeAny | undefined> {
  /** Require a signed-in user (default true). */
  auth?: boolean;
  query?: QS;
  body?: BS;
  /** Per-route rate limit; defaults to 240 requests/minute per user (or IP). */
  rate?: { limit: number; windowSec: number; key?: (ctx: { ip: string | null; body: any; actorId: string | null }) => string };
  /** Maximum JSON body size in bytes (default 1 MB). */
  maxBody?: number;
  /** Allow requests without browser origin checks (token-authenticated machine endpoints). */
  machine?: boolean;
  /** Success status code (default 200). */
  status?: number;
  /** Return a raw Response instead of JSON. */
  raw?: boolean;
}

type Infer<T extends ZodTypeAny | undefined> = T extends ZodTypeAny ? z.infer<T> : undefined;

export const clientIp = (req: NextRequest) => req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || null;

/**
 * CSRF defence for cookie-authenticated mutations: cookies are SameSite=Lax, and additionally any state-changing request
 * must come from our own origin (Origin / Sec-Fetch-Site checks).
 */
export function assertSameOrigin(req: NextRequest) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return;
  const site = req.headers.get("sec-fetch-site");
  if (site === "cross-site") throw new AppError("FORBIDDEN", "Cross-site requests are not allowed");
  const origin = req.headers.get("origin");
  if (origin) {
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    let ok = false;
    try {
      const o = new URL(origin);
      ok = o.host === host || o.host === new URL(env().APP_URL).host;
    } catch {
      ok = false;
    }
    if (!ok) throw new AppError("FORBIDDEN", "Cross-origin request blocked");
  }
}

function formatZod(e: ZodError) {
  const fieldErrors: Record<string, string[]> = {};
  for (const i of e.issues) {
    const k = i.path.join(".") || "_";
    (fieldErrors[k] ??= []).push(i.message);
  }
  return fieldErrors;
}

export function errorResponse(err: unknown, requestId: string): NextResponse {
  const json = (status: number, code: string, message: string, details?: unknown, headers?: Record<string, string>) => NextResponse.json({ error: { code, message, details, requestId } }, { status, headers: { "x-request-id": requestId, ...headers } });
  if (err instanceof AppError) return json(err.status, err.code, err.message, err.details);
  if (err instanceof ZodError) return json(400, "VALIDATION_ERROR", "Some fields are invalid", { fieldErrors: formatZod(err) });
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") return json(409, "CONFLICT", "That record already exists");
    if (err.code === "P2025") return json(404, "NOT_FOUND", "Record not found");
    if (err.code === "P2003") return json(400, "VALIDATION_ERROR", "A referenced record does not exist");
  }
  captureError(err, { requestId });
  // Never leak internals: no stack, no SQL, no table names.
  return json(500, "INTERNAL", "Something went wrong. Please try again.");
}

export function route<QS extends ZodTypeAny | undefined = undefined, BS extends ZodTypeAny | undefined = undefined>(opts: RouteOptions<QS, BS>, handler: (ctx: RouteContext<Infer<QS>, Infer<BS>>) => Promise<unknown>) {
  return async (req: NextRequest, segment: { params: Promise<Record<string, string>> }): Promise<Response> => {
    const requestId = req.headers.get("x-request-id") ?? randomUUID();
    try {
      const ip = clientIp(req);
      if (!opts.machine) assertSameOrigin(req);
      const token = req.cookies.get(SESSION_COOKIE)?.value ?? null;
      let actor: Actor | null = null;
      if (token) {
        const s = await resolveSession(token);
        if (s) actor = actorFromUser(s.user as any, ip);
      }
      if ((opts.auth ?? true) && !actor) throw new AppError("UNAUTHENTICATED", "Please sign in to continue");

      const lim = opts.rate ?? { limit: 240, windowSec: 60 };
      let body: any = undefined;
      if (opts.body) {
        const len = Number(req.headers.get("content-length") ?? 0);
        if (len > (opts.maxBody ?? 1_000_000)) throw new AppError("PAYLOAD_TOO_LARGE", "Request body too large");
        const text = await req.text();
        if (text.length > (opts.maxBody ?? 1_000_000)) throw new AppError("PAYLOAD_TOO_LARGE", "Request body too large");
        let raw: unknown = {};
        if (text) {
          try {
            raw = JSON.parse(text);
          } catch {
            throw new AppError("BAD_REQUEST", "Request body must be valid JSON");
          }
        }
        body = raw;
      }
      const rlKey = lim.key ? lim.key({ ip, body, actorId: actor?.id ?? null }) : `u:${actor?.id ?? ip ?? "anon"}`;
      const rl = await rateLimit(`${req.method}:${new URL(req.url).pathname.replace(/[0-9a-z]{20,}/g, ":id")}:${rlKey}`, lim.limit, lim.windowSec);
      if (!rl.ok) throw new AppError("RATE_LIMITED", "Too many requests. Please slow down and try again shortly.", { retryAfterSec: rl.retryAfterSec });
      if (opts.body) body = (opts.body as ZodTypeAny).parse(body);

      const query = opts.query ? (opts.query as ZodTypeAny).parse(Object.fromEntries(new URL(req.url).searchParams.entries())) : undefined;
      const params = (await segment?.params) ?? {};
      const out = await handler({ req, actor: actor as Actor, params, query: query as Infer<QS>, body: body as Infer<BS>, ip, requestId, sessionToken: token });
      if (opts.raw || out instanceof Response) {
        const r = out as Response;
        r.headers.set("x-request-id", requestId);
        return r;
      }
      const res = NextResponse.json({ data: out }, { status: opts.status ?? 200, headers: { "x-request-id": requestId, "cache-control": "no-store" } });
      res.headers.set("ratelimit-remaining", String(rl.remaining));
      return res;
    } catch (e) {
      const res = errorResponse(e, requestId);
      if (e instanceof AppError && e.code === "RATE_LIMITED") res.headers.set("retry-after", String((e.details as any)?.retryAfterSec ?? 60));
      return res;
    }
  };
}

// ───── query helpers
export const boolish = z.enum(["1", "true", "0", "false"]).transform((v) => v === "1" || v === "true");
export const pageQuery = { page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(200).default(25) };
export const optNum = z.preprocess((v) => (v === "" || v === undefined ? undefined : v), z.coerce.number().optional());
export const optDateQ = z.preprocess((v) => (v === "" ? undefined : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional());

export function created<T>(data: T) {
  return NextResponse.json({ data }, { status: 201 });
}
