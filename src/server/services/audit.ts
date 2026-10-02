import type { Db } from "@/lib/db";
import { db } from "@/lib/db";
import type { Actor } from "../context";

export interface AuditInput {
  entity: string;
  entityId?: string | null;
  action: string;
  before?: unknown;
  after?: unknown;
  vehicleId?: string | null;
  householdId?: string | null;
}

const clean = (v: unknown) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v, (_k, val) => (typeof val === "bigint" ? val.toString() : val))));
const REDACT = new Set(["passwordHash", "tokenHash", "password", "token"]);
function strip(v: any): any {
  if (Array.isArray(v)) return v.map(strip);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).filter(([k]) => !REDACT.has(k)).map(([k, x]) => [k, strip(x)]));
  return v;
}

export async function audit(client: Db | null, actor: Pick<Actor, "id" | "ip"> | null, e: AuditInput) {
  const c = client ?? db;
  await c.auditLog.create({
    data: {
      userId: actor?.id ?? null,
      householdId: e.householdId ?? null,
      vehicleId: e.vehicleId ?? null,
      entity: e.entity,
      entityId: e.entityId ?? null,
      action: e.action,
      before: e.before === undefined ? undefined : strip(clean(e.before)),
      after: e.after === undefined ? undefined : strip(clean(e.after)),
      ip: actor?.ip ?? null,
    },
  });
}
