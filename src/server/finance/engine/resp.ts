// RESP planner with the Canada Education Savings Grant (CESG). The rules are configurable constants: confirm them at canada.ca.
import { D, Dec, ZERO, money, type DecLike } from "./decimal";
import { realMonthlyRate } from "./retirement";

export const RESP_RULES = { matchRate: "0.20", annualMatchedContribution: "2500", annualGrantMax: "500", annualGrantMaxWithCarry: "1000", lifetimeGrant: "7200", lastGrantAge: 17, lifetimeContribution: "50000" };
export const RESP_SOURCE = "CESG rules as of the last update of this app. Confirm the current rates, carry-forward rules and age conditions at canada.ca before relying on them.";

export interface RespInput {
  childAge: number; balance: DecLike; annualContribution: DecLike; returnPct: DecLike; grantsReceived: DecLike;
  /** years of grant room unused before this year, if known. When omitted it is estimated from the child's age. */
  carryForwardYears?: number;
}
export interface RespYear { age: number; contribution: string; grant: string; balance: string }
export interface RespResult {
  years: RespYear[]; totalContributed: string; totalGrants: string; atAge18: string; lifetimeGrantLeft: string;
  bestAnnualContribution: string; grantMissed: string; notes: string[];
}

/** Grant for one year: 20 percent of what is paid in, up to the yearly cap (500, or 1000 using carried-forward room), and never past the lifetime cap. */
export function yearGrant(contribution: DecLike, roomYears: number, lifetimeLeft: DecLike): { grant: Dec; roomUsed: number } {
  const cap = roomYears > 0 ? D(RESP_RULES.annualGrantMaxWithCarry) : D(RESP_RULES.annualGrantMax);
  let g = D(contribution).times(RESP_RULES.matchRate);
  if (g.gt(cap)) g = cap;
  const left = D(lifetimeLeft);
  if (g.gt(left)) g = left;
  const extra = g.minus(RESP_RULES.annualGrantMax);
  return { grant: g.toDecimalPlaces(2), roomUsed: extra.gt(0) ? 1 : 0 };
}

function run(i: RespInput, contribution: Dec) {
  const rm = realMonthlyRate(i.returnPct, "0");
  let bal = D(i.balance), left = Dec.max(D(RESP_RULES.lifetimeGrant).minus(D(i.grantsReceived)), ZERO);
  // each past year without a full grant leaves 500 of room, which can be used at up to one extra 500 a year
  let room = i.carryForwardYears ?? Math.max(0, Math.min(i.childAge, RESP_RULES.lastGrantAge) - Math.floor(D(i.grantsReceived).div(RESP_RULES.annualGrantMax).toNumber()));
  const years: RespYear[] = [];
  let tc = ZERO, tg = ZERO;
  for (let age = i.childAge; age <= RESP_RULES.lastGrantAge; age++) {
    const { grant, roomUsed } = yearGrant(contribution, room, left);
    room = Math.max(0, room - roomUsed);
    // a year with a smaller grant than 500 adds to the carry room
    if (grant.lt(RESP_RULES.annualGrantMax) && left.gt(0)) room += 1;
    left = left.minus(grant);
    const deposit = contribution.plus(grant);
    for (let m = 0; m < 12; m++) bal = bal.times(rm.plus(1)).plus(deposit.div(12));
    tc = tc.plus(contribution); tg = tg.plus(grant);
    years.push({ age, contribution: money(contribution), grant: money(grant), balance: money(bal) });
  }
  return { years, bal, tc, tg, left };
}

export function planResp(i: RespInput): RespResult {
  const cur = run(i, D(i.annualContribution));
  // the contribution that collects the largest grant: 5000 a year catches up, 2500 a year is the steady maximum
  const best = D(RESP_RULES.annualMatchedContribution).times((i.carryForwardYears ?? i.childAge) > 0 ? 2 : 1);
  const top = run(i, best);
  const missed = Dec.max(top.tg.minus(cur.tg), ZERO);
  const notes = [
    "The government adds 20 percent of what you contribute each year, up to $500, and up to $1,000 a year when catching up on unused room, to a lifetime maximum of $7,200 per child.",
    "Grants are available until the end of the year the child turns 17. Contributions in the later years have extra conditions, so check the current rules.",
    "Growth uses the return you enter as is, without adjusting for inflation.",
    RESP_SOURCE,
  ];
  return { years: cur.years, totalContributed: money(cur.tc), totalGrants: money(cur.tg), atAge18: money(cur.bal), lifetimeGrantLeft: money(cur.left), bestAnnualContribution: money(best), grantMissed: money(missed), notes };
}
