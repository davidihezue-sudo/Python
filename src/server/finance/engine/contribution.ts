// Household contribution analysis. It separates:
//   * who PAID an expense (payer),
//   * who it is ALLOCATED to (a member, the shared household pool, or a split),
// and never changes household totals: each expense is counted once. Output is deliberately neutral: it states positions and
// differences without ranking people.
import { D, Dec, ZERO, sum, type Dec as DecT, type DecLike } from "./decimal";
import { apportion, type Allocation } from "./allocation";

export type ArrangementKind = "INDEPENDENT" | "SHARED_EQUAL" | "INCOME_BASED" | "FIXED" | "CUSTOM";
export interface Arrangement {
  kind: ArrangementKind;
  participants: string[];
  /** INCOME_BASED: each participant contributes this percentage of net income toward shared costs (optional target) */
  percentOfNet?: DecLike | null;
  /** FIXED: predetermined monthly amount per member */
  fixedMonthly?: Record<string, DecLike>;
  /** CUSTOM: percentage of the shared pool per member (must total 100) */
  customShares?: Record<string, DecLike>;
}
export interface ContribExpense {
  id: string;
  amount: DecLike; // signed net expense: positive for spending, negative for refunds
  payerId: string | null; // null = paid from a joint account (the household paid)
  allocations: Allocation[]; // signed like amount, summing to amount
}
export interface ContribInput {
  members: { id: string; name: string }[];
  expenses: ContribExpense[];
  settlements: { fromMemberId: string; toMemberId: string; amount: DecLike }[];
  /** Money each member moved into household (joint) accounts, which counts toward what they contributed. */
  transfersToShared?: Record<string, DecLike>;
  netMonthly?: Record<string, DecLike | null>;
  months: number;
  arrangement: Arrangement;
}
export interface MemberContribution {
  memberId: string;
  name: string;
  paidTotal: DecT;
  paidForShared: DecT;
  paidForOthers: DecT;
  allocatedPersonal: DecT;
  shareOfPool: DecT;
  owedTotal: DecT;
  settlementsPaid: DecT;
  settlementsReceived: DecT;
  /** Positive: the household owes this member. Negative: this member owes the household. Zero: even. */
  netPosition: DecT;
  target: DecT | null;
  actualContribution: DecT;
  /** target minus actual contribution: positive means contributions are below the agreed target */
  gapToTarget: DecT | null;
}
export interface ContributionAnalysis {
  arrangement: ArrangementKind;
  pool: DecT;
  personalTotal: DecT;
  total: DecT;
  paidFromJointAccounts: DecT;
  members: MemberContribution[];
  suggestedSettlements: { fromMemberId: string; toMemberId: string; amount: DecT }[];
  notes: string[];
}

export const ARRANGEMENT_LABEL: Record<ArrangementKind, string> = {
  INDEPENDENT: "Independent expenses: each member pays their own",
  SHARED_EQUAL: "Shared expenses: split equally between participants",
  INCOME_BASED: "Income based: in proportion to net income",
  FIXED: "Fixed contribution: a set amount each month",
  CUSTOM: "Custom: a percentage of shared costs per member",
};

export function analyseContributions(i: ContribInput): ContributionAnalysis {
  const notes: string[] = [];
  const ids = i.members.map((m) => m.id);
  const parts = (i.arrangement.participants.length ? i.arrangement.participants : ids).filter((p) => ids.includes(p));
  const z = () => new Map<string, DecT>(ids.map((m) => [m, ZERO]));
  const paidTotal = z(), paidShared = z(), paidOthers = z(), personal = z(), personalPaid = z(), sPaid = z(), sRecv = z();
  const add = (m: Map<string, DecT>, id: string | null, v: DecT) => {
    if (id && m.has(id)) m.set(id, (m.get(id) as DecT).plus(v));
  };
  let pool = ZERO, poolPaid = ZERO, personalTotal = ZERO, joint = ZERO;
  for (const e of i.expenses) {
    const amt = D(e.amount);
    if (e.payerId) add(paidTotal, e.payerId, amt);
    else joint = joint.plus(amt);
    for (const a of e.allocations) {
      if (a.memberId === null) {
        pool = pool.plus(a.amount);
        if (e.payerId) {
          add(paidShared, e.payerId, a.amount);
          poolPaid = poolPaid.plus(a.amount);
        }
      } else {
        personalTotal = personalTotal.plus(a.amount);
        add(personal, a.memberId, a.amount);
        if (e.payerId) add(personalPaid, a.memberId, a.amount);
        if (e.payerId && e.payerId !== a.memberId) add(paidOthers, e.payerId, a.amount);
      }
    }
  }
  for (const s of i.settlements) {
    add(sPaid, s.fromMemberId, D(s.amount));
    add(sRecv, s.toMemberId, D(s.amount));
  }

  // Share of a shared pool borne by each member under the arrangement. Computed for the whole pool (shown to the household) and for
  // the part members actually paid (used for positions: costs paid from joint accounts have no individual payer to settle with).
  const sharesFor = (amount: DecT): Map<string, DecT> => {
    const out = new Map<string, DecT>(ids.map((m) => [m, ZERO]));
    const set = (weights: Record<string, DecLike>) => {
      const keys = Object.keys(weights).filter((k) => ids.includes(k));
      if (!keys.length || sum(keys.map((k) => weights[k])).lte(0)) return false;
      apportion(amount, keys.map((k) => weights[k])).forEach((v, n) => out.set(keys[n], v));
      return true;
    };
    const equal = () => set(Object.fromEntries(parts.map((p) => [p, 1])));
    switch (i.arrangement.kind) {
      case "INDEPENDENT":
        for (const m of ids) out.set(m, paidShared.get(m) as DecT);
        break;
      case "SHARED_EQUAL":
        equal();
        break;
      case "INCOME_BASED": {
        const nets = Object.fromEntries(parts.map((p) => [p, i.netMonthly?.[p] ?? null]));
        if (parts.every((p) => nets[p] !== null && D(nets[p]).gt(0))) set(Object.fromEntries(parts.map((p) => [p, D(nets[p])])));
        else equal();
        break;
      }
      case "FIXED": {
        const fx = i.arrangement.fixedMonthly ?? {};
        if (!set(Object.fromEntries(Object.entries(fx).map(([k, v]) => [k, D(v)])))) equal();
        break;
      }
      case "CUSTOM": {
        const cs = i.arrangement.customShares ?? {};
        if (!set(cs)) equal();
        break;
      }
    }
    return out;
  };
  const share = sharesFor(pool);
  const positionShare = sharesFor(poolPaid);
  if (i.arrangement.kind === "INDEPENDENT") notes.push("Under an independent arrangement each member bears the shared costs they paid, so no settlement is suggested for them.");
  if (i.arrangement.kind === "INCOME_BASED" && !parts.every((p) => i.netMonthly?.[p] !== null && i.netMonthly?.[p] !== undefined && D(i.netMonthly[p]).gt(0))) notes.push("Net income is not available for every participant (it may not be shared), so shared costs are split equally instead.");
  if (i.arrangement.kind === "CUSTOM" && !sum(Object.values(i.arrangement.customShares ?? {})).eq(100)) notes.push("Custom shares do not add up to 100 percent, so they were scaled proportionally.");

  const members: MemberContribution[] = i.members.map((m) => {
    const owed = (personal.get(m.id) as DecT).plus(share.get(m.id) as DecT);
    // positions only consider expenses a member actually paid
    const owedForPosition = (personalPaid.get(m.id) as DecT).plus(positionShare.get(m.id) as DecT);
    const net = (paidTotal.get(m.id) as DecT).minus(owedForPosition).plus(sPaid.get(m.id) as DecT).minus(sRecv.get(m.id) as DecT);
    const toShared = D(i.transfersToShared?.[m.id]);
    const actual = (paidShared.get(m.id) as DecT).plus(toShared);
    let target: DecT | null = null;
    if (i.arrangement.kind === "FIXED" && i.arrangement.fixedMonthly?.[m.id] !== undefined) target = D(i.arrangement.fixedMonthly[m.id]).times(i.months);
    else if (i.arrangement.kind === "INCOME_BASED" && i.arrangement.percentOfNet !== undefined && i.arrangement.percentOfNet !== null && i.netMonthly?.[m.id] !== undefined && i.netMonthly[m.id] !== null) target = D(i.netMonthly[m.id]).times(D(i.arrangement.percentOfNet)).div(100).times(i.months);
    else if (parts.includes(m.id) && i.arrangement.kind !== "INDEPENDENT") target = share.get(m.id) as DecT;
    return { memberId: m.id, name: m.name, paidTotal: paidTotal.get(m.id) as DecT, paidForShared: paidShared.get(m.id) as DecT, paidForOthers: paidOthers.get(m.id) as DecT, allocatedPersonal: personal.get(m.id) as DecT, shareOfPool: share.get(m.id) as DecT, owedTotal: owed, settlementsPaid: sPaid.get(m.id) as DecT, settlementsReceived: sRecv.get(m.id) as DecT, netPosition: net, target, actualContribution: actual, gapToTarget: target === null ? null : target.minus(actual) };
  });
  if (joint.gt(0)) notes.push("Some expenses were paid from joint accounts. They count toward household totals and shares but have no individual payer, so they do not create a position between members.");

  // Suggested settlements: match members who are owed with members who owe (smallest set of payments).
  const creditors = members.filter((m) => m.netPosition.gt(0.004)).map((m) => ({ id: m.memberId, left: m.netPosition })).sort((a, b) => b.left.comparedTo(a.left));
  const debtors = members.filter((m) => m.netPosition.lt(-0.004)).map((m) => ({ id: m.memberId, left: m.netPosition.negated() })).sort((a, b) => b.left.comparedTo(a.left));
  const suggested: ContributionAnalysis["suggestedSettlements"] = [];
  for (const d of debtors) {
    for (const c of creditors) {
      if (d.left.lte(0)) break;
      if (c.left.lte(0)) continue;
      const pay = Dec.min(d.left, c.left).toDecimalPlaces(2);
      if (pay.gt(0)) suggested.push({ fromMemberId: d.id, toMemberId: c.id, amount: pay });
      d.left = d.left.minus(pay);
      c.left = c.left.minus(pay);
    }
  }
  return { arrangement: i.arrangement.kind, pool, personalTotal, total: pool.plus(personalTotal), paidFromJointAccounts: joint, members, suggestedSettlements: suggested, notes };
}
