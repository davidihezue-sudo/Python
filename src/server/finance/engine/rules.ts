// Transaction rules (pure). A rule has conditions that must all hold and actions that fill in details the person left empty.
import { D } from "./decimal";

export interface RuleConditions {
  /** the description (or merchant) contains at least one of these words or phrases */
  textAny?: string[];
  /** the description (or merchant) contains every one of these */
  textAll?: string[];
  minAmount?: string | number | null;
  maxAmount?: string | number | null;
  accountId?: string | null;
  type?: "INCOME" | "EXPENSE" | "REFUND" | null;
}
export interface RuleActions {
  categoryId?: string | null;
  vehicleId?: string | null;
  addTags?: string[];
  merchant?: string | null;
}
export interface RuleLite {
  id: string;
  scope: "MINE" | "HOUSEHOLD";
  priority: number;
  conditions: RuleConditions;
  actions: RuleActions;
}
export interface TxProbe {
  description: string;
  merchant?: string | null;
  amount: string | number;
  type: string;
  accountId: string;
}
export interface RuleOutcome {
  categoryId?: string;
  vehicleId?: string;
  merchant?: string;
  tags: string[];
  /** the rules that supplied at least one value, in the order they were applied */
  matched: string[];
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
export const hasConditions = (c: RuleConditions) => !!((c.textAny?.length ?? 0) || (c.textAll?.length ?? 0) || (c.minAmount !== undefined && c.minAmount !== null && c.minAmount !== "") || (c.maxAmount !== undefined && c.maxAmount !== null && c.maxAmount !== "") || c.accountId || c.type);

/** A rule with no conditions never matches, so an unfinished rule cannot rewrite everything. */
export function ruleMatches(c: RuleConditions, tx: TxProbe): boolean {
  if (!hasConditions(c)) return false;
  const hay = norm(`${tx.description} ${tx.merchant ?? ""}`);
  if (c.textAny?.length && !c.textAny.some((w) => norm(w) && hay.includes(norm(w)))) return false;
  if (c.textAll?.length && !c.textAll.every((w) => !norm(w) || hay.includes(norm(w)))) return false;
  const amt = D(tx.amount).abs();
  if (c.minAmount !== undefined && c.minAmount !== null && c.minAmount !== "" && amt.lt(D(c.minAmount))) return false;
  if (c.maxAmount !== undefined && c.maxAmount !== null && c.maxAmount !== "" && amt.gt(D(c.maxAmount))) return false;
  if (c.accountId && c.accountId !== tx.accountId) return false;
  if (c.type && c.type !== tx.type) return false;
  return true;
}

const cleanTag = (t: string) => t.toLowerCase().trim().replace(/\s+/g, "-").replace(/[^a-z0-9\-_]/g, "").slice(0, 30);
export const normaliseTags = (tags: readonly string[] | null | undefined): string[] => [...new Set((tags ?? []).map(cleanTag).filter(Boolean))].slice(0, 10);

/** Personal rules first, then household rules; lower priority numbers first. The first rule to supply a value wins; tags from every matching rule are combined. */
export function applyRules(rules: RuleLite[], tx: TxProbe): RuleOutcome {
  const ordered = [...rules].sort((a, b) => (a.scope === b.scope ? 0 : a.scope === "MINE" ? -1 : 1) || a.priority - b.priority || a.id.localeCompare(b.id));
  const out: RuleOutcome = { tags: [], matched: [] };
  for (const r of ordered) {
    if (!ruleMatches(r.conditions, tx)) continue;
    let used = false;
    if (r.actions.categoryId && !out.categoryId) { out.categoryId = r.actions.categoryId; used = true; }
    if (r.actions.vehicleId && !out.vehicleId) { out.vehicleId = r.actions.vehicleId; used = true; }
    if (r.actions.merchant && !out.merchant) { out.merchant = r.actions.merchant; used = true; }
    const tags = normaliseTags(r.actions.addTags);
    if (tags.length) { out.tags = normaliseTags([...out.tags, ...tags]); used = true; }
    if (used) out.matched.push(r.id);
  }
  return out;
}
