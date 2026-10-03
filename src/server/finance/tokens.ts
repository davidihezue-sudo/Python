// Read-only API tokens. Only a SHA-256 hash is stored; the token itself is shown once. A token can read what its owner can read in one
// household and nothing else: it is refused on every request that is not a GET, and it cannot manage tokens.
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { AppError, notFound } from "@/lib/errors";
import { actorFromUser, type Actor } from "../context";
import { audit } from "../services/audit";
import { text } from "./common";
import type { FinCtx } from "./access";

export const TOKEN_PREFIX = "ffh_";
const hash = (t: string) => createHash("sha256").update(t).digest("hex");
export const tokenSchema = z.object({ name: text(60), days: z.number().int().min(1).max(365).default(90) });
const MAX_ACTIVE = 10;

export async function createToken(ctx: FinCtx, input: z.infer<typeof tokenSchema>) {
  const active = await db.apiToken.count({ where: { userId: ctx.actor.id, householdId: ctx.householdId, revokedAt: null, expiresAt: { gt: new Date() } } });
  if (active >= MAX_ACTIVE) throw new AppError("CONFLICT", `You can have up to ${MAX_ACTIVE} active tokens. Revoke one first.`);
  const token = TOKEN_PREFIX + randomBytes(32).toString("base64url");
  const row = await db.apiToken.create({ data: { userId: ctx.actor.id, householdId: ctx.householdId, name: input.name, tokenHash: hash(token), prefix: token.slice(0, 10), expiresAt: new Date(Date.now() + input.days * 86400_000) } });
  await audit(null, ctx.actor, { entity: "ApiToken", entityId: row.id, action: "create", householdId: ctx.householdId, after: { name: input.name, days: input.days } });
  return { id: row.id, token, expiresAt: row.expiresAt.toISOString(), warning: "Copy this token now. It cannot be shown again." };
}

export async function listTokens(ctx: FinCtx) {
  const rows = await db.apiToken.findMany({ where: { userId: ctx.actor.id, householdId: ctx.householdId }, orderBy: { createdAt: "desc" }, take: 50 });
  return rows.map((t) => ({ id: t.id, name: t.name, prefix: t.prefix, expiresAt: t.expiresAt.toISOString(), lastUsedAt: t.lastUsedAt?.toISOString() ?? null, revoked: !!t.revokedAt, active: !t.revokedAt && t.expiresAt > new Date() }));
}

export async function revokeToken(ctx: FinCtx, tokenId: string) {
  const t = await db.apiToken.findFirst({ where: { id: tokenId, userId: ctx.actor.id, householdId: ctx.householdId } });
  if (!t) throw notFound("Token");
  await db.apiToken.update({ where: { id: t.id }, data: { revokedAt: new Date() } });
  await audit(null, ctx.actor, { entity: "ApiToken", entityId: t.id, action: "revoke", householdId: ctx.householdId });
  return { ok: true };
}

/**
 * undefined: no bearer token was sent (use the session cookie). null: a token was sent and is not valid.
 * Otherwise the token owner as the actor. The token must belong to the household in the URL.
 */
export async function authenticateBearer(req: NextRequest, householdId: string | undefined): Promise<Actor | null | undefined> {
  const h = req.headers.get("authorization");
  if (!h) return undefined;
  const m = /^Bearer\s+(ffh_[A-Za-z0-9_-]{20,100})$/.exec(h.trim());
  if (!m) return null;
  const t = await db.apiToken.findUnique({ where: { tokenHash: hash(m[1]) } });
  if (!t || t.revokedAt || t.expiresAt <= new Date() || t.householdId !== householdId) return null;
  const user = await db.user.findFirst({ where: { id: t.userId, disabledAt: null, deletedAt: null }, include: { preference: true } });
  if (!user) return null;
  if (!t.lastUsedAt || Date.now() - t.lastUsedAt.getTime() > 60_000) await db.apiToken.update({ where: { id: t.id }, data: { lastUsedAt: new Date() } });
  return actorFromUser(user as never, null);
}
