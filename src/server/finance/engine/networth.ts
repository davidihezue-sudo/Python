// Net worth = total assets - total liabilities. Every item is counted exactly once.
//  * Ledger accounts contribute their signed balance (liability types carry negative balances).
//  * Investment accounts contribute their latest manual valuation (on or before the date) instead of the ledger balance, never both.
//  * Property, vehicles and other valuables are separate assets with dated valuations. A mortgage or car loan is a ledger
//    liability account, so owning the asset and owing the loan are two different lines, not duplicates.
import { D, Dec, ZERO, sum, type Dec as DecT, type DecLike } from "./decimal";
import { balances, isLiabilityType, type LedgerAccount, type LedgerTx } from "./ledger";
import { addMonths, endOfMonth, type IsoDate } from "./dates";
import type { Fx } from "./fx";

export interface ValuationPoint {
  date: IsoDate;
  value: DecLike;
}
export interface NwAccount extends LedgerAccount {
  name: string;
  valuations?: ValuationPoint[]; // investment accounts only
}
export interface NwAsset {
  id: string;
  name: string;
  kind: string;
  currency: string;
  currentValue: DecLike;
  valuationDate: IsoDate;
  valuations?: ValuationPoint[];
  acquiredOn?: IsoDate | null;
  soldOn?: IsoDate | null;
}
export interface NetWorthLine {
  id: string;
  name: string;
  group: "cash" | "savings" | "investments" | "property" | "vehicles" | "other_assets" | "credit_cards" | "lines_of_credit" | "mortgages" | "loans" | "other_liabilities";
  side: "asset" | "liability";
  value: DecT; // always positive, in base currency
  currency: string;
  nativeValue: DecT;
  valuedOn: IsoDate | null;
  source: "ledger" | "valuation";
}
export interface NetWorth {
  asOf: IsoDate;
  assets: DecT;
  liabilities: DecT;
  netWorth: DecT;
  lines: NetWorthLine[];
  unconverted: string[];
}

function latest(vals: ValuationPoint[] | undefined, on: IsoDate): ValuationPoint | null {
  let best: ValuationPoint | null = null;
  for (const v of vals ?? []) if (v.date <= on && (!best || v.date > best.date)) best = v;
  return best;
}

const ACCOUNT_GROUP: Record<string, NetWorthLine["group"]> = { CHEQUING: "cash", CASH: "cash", SAVINGS: "savings", HIGH_INTEREST_SAVINGS: "savings", INVESTMENT: "investments", OTHER_ASSET: "other_assets", CREDIT_CARD: "credit_cards", LINE_OF_CREDIT: "lines_of_credit", MORTGAGE: "mortgages", LOAN: "loans", OTHER_LIABILITY: "other_liabilities" };
const LIABILITY_GROUP_BY_TYPE: Record<string, NetWorthLine["group"]> = { CHEQUING: "other_liabilities", CASH: "other_liabilities", SAVINGS: "other_liabilities", HIGH_INTEREST_SAVINGS: "other_liabilities", INVESTMENT: "other_liabilities", OTHER_ASSET: "other_liabilities" };

export function computeNetWorth(p: { accounts: NwAccount[]; txs: LedgerTx[]; assets: NwAsset[]; baseCurrency: string; fx: Fx; asOf: IsoDate }): NetWorth {
  const bal = balances(p.accounts, p.txs, p.asOf);
  const lines: NetWorthLine[] = [];
  const unconverted: string[] = [];
  const conv = (v: DecT, cur: string) => p.fx.convert(v, cur, p.baseCurrency, p.asOf);

  for (const a of p.accounts) {
    let native = bal.get(a.id) ?? ZERO;
    let source: NetWorthLine["source"] = "ledger";
    let valuedOn: IsoDate | null = null;
    if (a.type === "INVESTMENT") {
      const v = latest(a.valuations, p.asOf);
      if (v) {
        native = D(v.value);
        source = "valuation";
        valuedOn = v.date;
      }
    }
    if (a.openingDate > p.asOf && native.isZero()) continue;
    const c = conv(native, a.currency);
    if (!c) {
      unconverted.push(a.name);
      continue;
    }
    const isLiabType = isLiabilityType(a.type);
    const signedBase = c.amount;
    // A positive balance on a liability account (credit balance) is an asset; a negative balance on an asset account (overdraft) is a liability.
    const side: "asset" | "liability" = signedBase.gte(0) ? "asset" : "liability";
    const group = side === "liability" && !isLiabType ? LIABILITY_GROUP_BY_TYPE[a.type] : isLiabType && side === "asset" ? "other_assets" : ACCOUNT_GROUP[a.type];
    if (signedBase.isZero()) continue;
    lines.push({ id: a.id, name: a.name, group, side, value: signedBase.abs(), currency: a.currency, nativeValue: native.abs(), valuedOn, source });
  }

  for (const s of p.assets) {
    if (s.soldOn && s.soldOn <= p.asOf) continue;
    const vals = s.valuations ?? [];
    const v = latest(vals, p.asOf);
    let native: DecT;
    let valuedOn: IsoDate | null;
    if (v) {
      native = D(v.value);
      valuedOn = v.date;
    } else if (!vals.length && s.valuationDate <= p.asOf) {
      native = D(s.currentValue);
      valuedOn = s.valuationDate;
    } else if (vals.length && s.acquiredOn && s.acquiredOn <= p.asOf) {
      const first = [...vals].sort((a, b) => (a.date < b.date ? -1 : 1))[0]; // best available estimate: the earliest recorded valuation
      native = D(first.value);
      valuedOn = first.date;
    } else continue; // not valued yet at this date, so history does not invent a value
    const c = conv(native, s.currency);
    if (!c) {
      unconverted.push(s.name);
      continue;
    }
    const group: NetWorthLine["group"] = s.kind === "PROPERTY" ? "property" : s.kind === "VEHICLE" ? "vehicles" : "other_assets";
    lines.push({ id: s.id, name: s.name, group, side: "asset", value: c.amount, currency: s.currency, nativeValue: native, valuedOn, source: "valuation" });
  }

  const assets = sum(lines.filter((l) => l.side === "asset").map((l) => l.value));
  const liabilities = sum(lines.filter((l) => l.side === "liability").map((l) => l.value));
  return { asOf: p.asOf, assets, liabilities, netWorth: assets.minus(liabilities), lines, unconverted: [...new Set(unconverted)] };
}

export interface NetWorthPoint {
  date: IsoDate;
  month: string;
  assets: DecT;
  liabilities: DecT;
  netWorth: DecT;
  changeFromPrevious: DecT | null;
}
/** Month-end history. Rebuilt from the ledger and valuations each time, so back-dated entries correct history consistently. */
export function netWorthHistory(p: { accounts: NwAccount[]; txs: LedgerTx[]; assets: NwAsset[]; baseCurrency: string; fx: Fx; endDate: IsoDate; months: number }): NetWorthPoint[] {
  const out: NetWorthPoint[] = [];
  for (let i = p.months - 1; i >= 0; i--) {
    const monthEnd = endOfMonth(addMonths(p.endDate, -i));
    const date = i === 0 && p.endDate < monthEnd ? p.endDate : monthEnd;
    const nw = computeNetWorth({ ...p, asOf: date });
    out.push({ date, month: date.slice(0, 7), assets: nw.assets, liabilities: nw.liabilities, netWorth: nw.netWorth, changeFromPrevious: out.length ? nw.netWorth.minus(out[out.length - 1].netWorth) : null });
  }
  return out;
}

/** Change versus an earlier month-end, as an amount and a percentage of the starting absolute value. */
export function compareNetWorth(now: DecLike, earlier: DecLike | null): { change: DecT; percent: DecT | null } | null {
  if (earlier === null) return null;
  const change = D(now).minus(D(earlier));
  const base = D(earlier).abs();
  return { change, percent: base.isZero() ? null : change.div(base).times(100).toDecimalPlaces(2) };
}

export { Dec };
