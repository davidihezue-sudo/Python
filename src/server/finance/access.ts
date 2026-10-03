// Household scoped authorisation for finance data.
//
// Model: every financial record has an OWNER (a household member), a VISIBILITY and, for SELECTED, a list of members it is
// shared with. Three visibility levels exist:
//   PERSONAL   visible only to the owner. Nobody else can read it, including household administrators.
//   HOUSEHOLD  visible to every member and included in the consolidated household views.
//   SELECTED   visible to the owner and the explicitly listed members only.
// Joint records have no owner and are always HOUSEHOLD. Roles control WRITING (READ_ONLY cannot write, ADMIN manages members
// and invitations); roles never widen what can be READ. All checks run on the server inside the service layer.
import type { Household, HouseholdRole, RecordVisibility } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { AppError, forbidden, notFound } from "@/lib/errors";
import { todayInTz, type IsoDate } from "@/lib/dates";
import type { Actor } from "../context";

export type Vis = RecordVisibility;
export type SharingKind = "income" | "accounts" | "transactions" | "savings" | "debts" | "other";
export type Defaults = Record<SharingKind, Vis>;
export const DEFAULT_SHARING: Defaults = { income: "HOUSEHOLD", accounts: "HOUSEHOLD", transactions: "HOUSEHOLD", savings: "HOUSEHOLD", debts: "HOUSEHOLD", other: "HOUSEHOLD" };

export interface MemberInfo {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: HouseholdRole;
  accessExpiresAt: Date | null;
  avatarColor: string | null;
  responsibilities: string | null;
  defaults: Defaults;
}
export type View = "my" | "household";
export interface FinCtx {
  actor: Actor;
  householdId: string;
  household: Household;
  me: MemberInfo;
  members: MemberInfo[];
  base: string;
  today: IsoDate;
  canWrite: boolean;
  isAdmin: boolean;
  /** Accounts the actor may see (own, household shared, or shared with them). */
  accountIds: Set<string>;
  hiddenAccountCount: number;
}
export type Need = "read" | "write" | "admin";

export interface Shareable {
  ownerMemberId: string | null;
  visibility: Vis;
  sharedWithMemberIds: string[];
}

/** Can the actor read this record? Roles never widen this: a PERSONAL record is only ever readable by its owner. */
export function canSee(ctx: Pick<FinCtx, "me">, r: Shareable): boolean {
  if (r.ownerMemberId === ctx.me.id) return true;
  // A child only sees their own records and what has been shared with them by name, never the household's shared books.
  if (r.visibility === "HOUSEHOLD") return ctx.me.role !== "CHILD";
  if (r.visibility === "SELECTED") return r.sharedWithMemberIds.includes(ctx.me.id);
  return false;
}
/** Is the record part of the given view? "my" = records I own; "household" = records shared with the household (or with me). */
export function inView(ctx: Pick<FinCtx, "me">, view: View, r: Shareable): boolean {
  if (view === "my") return r.ownerMemberId === ctx.me.id;
  if (r.visibility === "PERSONAL") return false;
  return canSee(ctx, r);
}
/** Writers may edit any record they can see (shared records are collaborative and every change is audited). */
export const canEdit = (ctx: FinCtx, r: Shareable) => ctx.canWrite && canSee(ctx, r);

/** Prisma filter for records visible in a scope. `all` = everything the actor may read. Combine with householdId at the call site. */
export function visWhere(ctx: Pick<FinCtx, "me">, scope: View | "all" | { member: string }) {
  const me = ctx.me.id;
  const named = { visibility: "SELECTED" as const, sharedWithMemberIds: { has: me } };
  const shared = ctx.me.role === "CHILD" ? [named] : [{ visibility: "HOUSEHOLD" as const }, named];
  if (scope === "my") return { ownerMemberId: me };
  if (scope === "household") return { OR: [...shared, { visibility: "SELECTED" as const, ownerMemberId: me }] };
  if (scope === "all") return { OR: [{ ownerMemberId: me }, ...shared] };
  return { AND: [{ ownerMemberId: scope.member }, { OR: shared }] }; // another member's records that I am allowed to see
}

export async function finCtx(actor: Actor, householdId: string, need: Need = "read"): Promise<FinCtx> {
  if (typeof householdId !== "string" || householdId.length < 5 || householdId.length > 40) throw notFound("Household");
  const rows = await db.householdMember.findMany({ where: { householdId, household: { deletedAt: null } }, include: { household: true, user: { select: { name: true, email: true } }, privacy: true }, orderBy: { createdAt: "asc" } });
  const meRow = rows.find((r) => r.userId === actor.id);
  if (!meRow) throw notFound("Household"); // never reveal that the household exists
  if (meRow.accessExpiresAt && meRow.accessExpiresAt.getTime() <= Date.now()) throw forbidden("Your access to this household has ended");
  const members: MemberInfo[] = rows.map((r) => ({
    id: r.id, userId: r.userId, name: r.user.name, email: r.user.email, role: r.role, accessExpiresAt: r.accessExpiresAt, avatarColor: r.avatarColor, responsibilities: r.responsibilities,
    defaults: r.privacy ? { income: r.privacy.incomeDefault, accounts: r.privacy.accountsDefault, transactions: r.privacy.transactionsDefault, savings: r.privacy.savingsDefault, debts: r.privacy.debtsDefault, other: r.privacy.otherDefault } : { ...DEFAULT_SHARING },
  }));
  const me = members.find((m) => m.userId === actor.id) as MemberInfo;
  const isAdmin = me.role === "ADMIN";
  const canWrite = me.role !== "READ_ONLY" && me.role !== "ACCOUNTANT";
  if (need === "write" && !canWrite) throw forbidden("Your access to this household is read-only");
  if (need === "admin" && !isAdmin) throw forbidden("Only household administrators can do that");
  const accounts = await db.finAccount.findMany({ where: { householdId, deletedAt: null }, select: { id: true, ownerMemberId: true, visibility: true, sharedWithMemberIds: true } });
  const accountIds = new Set<string>();
  let hidden = 0;
  for (const a of accounts) {
    if (canSee({ me }, a)) accountIds.add(a.id);
    else hidden++;
  }
  return { actor, householdId, household: rows[0].household, me, members, base: rows[0].household.currency, today: todayInTz(rows[0].household.timezone), canWrite, isAdmin, accountIds, hiddenAccountCount: hidden };
}

// ───── visibility input handling
export const visibilityFields = {
  visibility: z.enum(["PERSONAL", "HOUSEHOLD", "SELECTED"]).optional(),
  sharedWithMemberIds: z.array(z.string().min(5).max(40)).max(50).optional(),
};
export interface VisInput {
  visibility?: Vis;
  sharedWithMemberIds?: string[];
}
/** Validates and normalises a visibility choice. SELECTED needs at least one other household member; other levels clear the list. */
export function resolveVisibility(ctx: FinCtx, input: VisInput, kind: SharingKind, opts: { joint?: boolean; current?: Shareable } = {}): { visibility: Vis; sharedWithMemberIds: string[] } {
  if (opts.joint) return { visibility: "HOUSEHOLD", sharedWithMemberIds: [] };
  // What a child records stays visible to the household's adults, so a child cannot hide things from them.
  if (ctx.me.role === "CHILD") return { visibility: "HOUSEHOLD", sharedWithMemberIds: [] };
  const visibility = input.visibility ?? opts.current?.visibility ?? ctx.me.defaults[kind];
  if (visibility !== "SELECTED") return { visibility, sharedWithMemberIds: [] };
  const list = [...new Set(input.sharedWithMemberIds ?? opts.current?.sharedWithMemberIds ?? [])].filter((m) => m !== ctx.me.id);
  if (!list.length) throw new AppError("VALIDATION_ERROR", "Choose at least one household member to share this with", { fieldErrors: { sharedWithMemberIds: ["Choose at least one member"] } });
  if (list.some((m) => !ctx.members.some((x) => x.id === m))) throw new AppError("VALIDATION_ERROR", "You can only share with members of this household");
  return { visibility, sharedWithMemberIds: list };
}
/** A record may never be broader than the account it sits on. */
export function clampToAccount(acct: Shareable, v: { visibility: Vis; sharedWithMemberIds: string[] }): { visibility: Vis; sharedWithMemberIds: string[] } {
  if (acct.visibility === "HOUSEHOLD") return v;
  if (acct.visibility === "PERSONAL") return { visibility: "PERSONAL", sharedWithMemberIds: [] };
  if (v.visibility === "HOUSEHOLD") return { visibility: "SELECTED", sharedWithMemberIds: acct.sharedWithMemberIds };
  if (v.visibility === "SELECTED") return { visibility: "SELECTED", sharedWithMemberIds: v.sharedWithMemberIds.filter((m) => acct.sharedWithMemberIds.includes(m)) };
  return v;
}

export const memberName = (ctx: FinCtx, memberId: string | null | undefined) => (memberId ? (ctx.members.find((m) => m.id === memberId)?.name ?? null) : null);
export const memberRef = (ctx: FinCtx, memberId: string | null | undefined) => {
  const m = memberId ? ctx.members.find((x) => x.id === memberId) : null;
  return m ? { id: m.id, name: m.name, color: m.avatarColor } : null;
};
export function requireMember(ctx: FinCtx, memberId: string | null | undefined) {
  if (!memberId) return null;
  if (!ctx.members.some((m) => m.id === memberId)) throw notFound("Household member");
  return memberId;
}
/** The member a new record belongs to: always the authenticated user unless they explicitly assign it to another member. */
export function ownerFor(ctx: FinCtx, assignTo?: string | null) {
  if (!assignTo || assignTo === ctx.me.id) return ctx.me.id;
  requireMember(ctx, assignTo);
  if (ctx.me.role !== "ADMIN" && ctx.me.role !== "MEMBER") throw forbidden();
  return assignTo;
}

/** Resolves an account the actor may see. Missing or hidden accounts are both NOT_FOUND. */
export async function requireAccount(ctx: FinCtx, accountId: string | null | undefined, opts: { write?: boolean } = {}) {
  if (!accountId || typeof accountId !== "string" || accountId.length > 40) throw notFound("Account");
  // The row itself is the authority (not a set cached when the context was built), so newly created accounts resolve correctly.
  const a = await db.finAccount.findFirst({ where: { id: accountId, householdId: ctx.householdId, deletedAt: null } });
  if (!a || !canSee(ctx, a)) throw notFound("Account");
  if (opts.write && !canEdit(ctx, a)) throw forbidden();
  return a;
}

/** Loads a household owned, non-deleted row the actor can see, or throws NOT_FOUND (never FORBIDDEN, so existence is not leaked). */
export function requireVisible<T extends Shareable & { householdId: string; deletedAt?: Date | null }>(ctx: FinCtx, row: T | null | undefined, what: string, opts: { write?: boolean } = {}): T {
  if (!row || row.householdId !== ctx.householdId || row.deletedAt || !canSee(ctx, row)) throw notFound(what);
  if (opts.write && !canEdit(ctx, row)) throw forbidden();
  return row;
}
/** For household level records without a privacy setting (e.g. categories): must belong to the household. */
export function requireInHousehold<T extends { householdId: string; deletedAt?: Date | null }>(ctx: FinCtx, row: T | null | undefined, what: string): T {
  if (!row || row.householdId !== ctx.householdId || row.deletedAt) throw notFound(what);
  return row;
}
export const requireWriter = (ctx: FinCtx) => {
  if (!ctx.canWrite) throw forbidden("Your access to this household is read-only");
};

// ───── helpers shared by every record type that carries ownership and visibility
export interface MetaInput extends VisInput {
  assignToMemberId?: string | null;
}
/** Ownership and visibility columns for a new record. The owner is the signed-in member unless explicitly assigned. */
export function newRecordMeta(ctx: FinCtx, input: MetaInput, kind: SharingKind, opts: { joint?: boolean } = {}) {
  const owner = opts.joint ? null : ownerFor(ctx, input.assignToMemberId);
  return { ownerMemberId: owner, ...resolveVisibility(ctx, input, kind, { joint: opts.joint }), createdById: ctx.actor.id, updatedById: ctx.actor.id };
}
/** Column changes for an update. Only the owner may change visibility or ownership; any writer who can see a record may edit its content. */
export function updateRecordMeta(ctx: FinCtx, row: Shareable, patch: MetaInput, kind: SharingKind) {
  const touchesVis = patch.visibility !== undefined || patch.sharedWithMemberIds !== undefined || (patch.assignToMemberId !== undefined && patch.assignToMemberId !== row.ownerMemberId);
  if (touchesVis && row.ownerMemberId !== ctx.me.id) throw forbidden("Only the owner can change who can see this record or who it belongs to");
  const data: Record<string, unknown> = { updatedById: ctx.actor.id };
  if (patch.visibility !== undefined || patch.sharedWithMemberIds !== undefined) Object.assign(data, resolveVisibility(ctx, patch, kind, { current: row }));
  if (patch.assignToMemberId) data.ownerMemberId = ownerFor(ctx, patch.assignToMemberId);
  return data;
}
/** The ownership block of an API response. Share lists are only revealed to the owner. */
export function metaView(ctx: FinCtx, row: Shareable & { createdById?: string | null; updatedById?: string | null; createdAt?: Date; updatedAt?: Date }) {
  const byUser = (uid?: string | null) => (uid ? memberRef(ctx, ctx.members.find((m) => m.userId === uid)?.id) : null);
  return { owner: memberRef(ctx, row.ownerMemberId), ownerMemberId: row.ownerMemberId, mine: row.ownerMemberId === ctx.me.id, visibility: row.visibility, sharedWithMemberIds: row.ownerMemberId === ctx.me.id ? row.sharedWithMemberIds : undefined, canEdit: canEdit(ctx, row), enteredBy: byUser(row.createdById), lastModifiedBy: byUser(row.updatedById) };
}

export const requireAdminOnly = (ctx: FinCtx) => {
  if (!ctx.isAdmin) throw forbidden("Only household administrators can do that");
};


// ───── what each limited role may reach. The check runs on the server before any handler.
const CHILD_AREAS = new Set(["profile", "members", "accounts", "transactions", "transfers", "categories", "merchants", "goals", "wishlist", "comments", "tags", "saved-views"]);
const ACCOUNTANT_AREAS = new Set(["profile", "members", "accounts", "transactions", "categories", "merchants", "income", "tax", "reports", "export", "export-all", "documents", "assets", "investments", "debts", "networth", "bills", "subscriptions", "insurance", "comments", "tags"]);
/** Throws unless the member's role may use this part of the API. Adults and read-only members are limited only by record visibility. */
export function assertAreaAllowed(role: HouseholdRole, method: string, area: string | undefined) {
  if (role === "CHILD" && !CHILD_AREAS.has(area ?? "")) throw forbidden("This part of the app is not available for your role");
  if (role === "ACCOUNTANT") {
    if (!ACCOUNTANT_AREAS.has(area ?? "")) throw forbidden("This part of the app is not available for your role");
    if (method !== "GET" && !(area === "comments" && method === "POST")) throw forbidden("Your access to this household is read-only");
  }
}
