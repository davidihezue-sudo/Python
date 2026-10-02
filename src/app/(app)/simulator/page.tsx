"use client";
import * as React from "react";
import { Plus, Save, X } from "lucide-react";
import { Alert, Button, Field, Input, Select } from "@/components/ui/primitives";
import { EmptyState } from "@/components/ui/empty";
import { useConfirm } from "@/components/ui/dialog";
import { ChartCard, Lines } from "@/components/ui/charts";
import { useFin, useFinMutation, useFinQuery } from "@/components/finance/provider";
import { Figure, Money, NeedsHousehold, PageHeader, Section, ViewNote, ViewSwitch, useMembers } from "@/components/finance/ui";
import { api } from "@/lib/client/api";

type A = { type: string; [k: string]: any };
const TYPES: [string, string, string][] = [
  ["INCOME_CHANGE", "A raise or pay cut", "Income"], ["JOB_LOSS", "Someone loses a job or income", "Income"], ["JOB_CHANGE", "Someone changes jobs", "Income"], ["ADD_INCOME", "Additional recurring income", "Income"], ["BONUS", "A bonus is received", "Income"],
  ["EXPENSE_CHANGE", "An expense changes (rent, mortgage, utilities, vehicle)", "Expenses"], ["ONE_TIME_EXPENSE", "A large unexpected expense", "Expenses"], ["REDUCE_DISCRETIONARY", "Reduce discretionary spending", "Savings"], ["SAVINGS_CHANGE", "Save more each month", "Savings"],
  ["EXTRA_DEBT_PAYMENT", "Extra debt payments", "Debt"], ["DEBT_PAYOFF", "Pay off a debt in full", "Debt"], ["CONTRIBUTION_CHANGE", "Change a member's contribution to shared costs", "Household"], ["HOME_PURCHASE", "Buy a home", "Home"],
];
const blank = (type: string): A => ({ type, ...({ INCOME_CHANGE: { target: "ALL", mode: "PCT", value: 10 }, JOB_LOSS: { target: "ALL", durationMonths: 3, startMonth: 0 }, JOB_CHANGE: { target: "ALL", gapMonths: 1, newNetPerPayment: 0 }, ADD_INCOME: { monthlyAmount: 500, startMonth: 0 }, BONUS: { amount: 3000, month: 1 }, EXPENSE_CHANGE: { target: "ALL_SCHEDULED", mode: "PCT", value: 5 }, ONE_TIME_EXPENSE: { amount: 5000, month: 1 }, REDUCE_DISCRETIONARY: { mode: "AMOUNT", value: 150 }, SAVINGS_CHANGE: { extraMonthly: 200, goalId: null }, EXTRA_DEBT_PAYMENT: { extraMonthly: 300, debtId: null }, DEBT_PAYOFF: { debtId: "", month: 1 }, CONTRIBUTION_CHANGE: { monthlyDelta: 200 }, HOME_PURCHASE: { price: 500000, downPayment: 100000, aprPercent: 5, amortisationYears: 25, month: 3, propertyTaxAnnual: 3600 } } as any)[type] });

export default function SimulatorPage() {
  return <NeedsHousehold><Inner /></NeedsHousehold>;
}
function Inner() {
  const { fmt, view, hid } = useFin();
  const { members } = useMembers();
  const confirm = useConfirm();
  const [items, setItems] = React.useState<A[]>([blank("INCOME_CHANGE")]);
  const [months, setMonths] = React.useState(12);
  const [result, setResult] = React.useState<any>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [name, setName] = React.useState("");
  const [cmp, setCmp] = React.useState<string[]>([]);
  const { data: saved } = useFinQuery<any[]>("/scenarios");
  const { data: debts } = useFinQuery<any>("/debts", { view });
  const { data: goals } = useFinQuery<any>("/goals", { view });
  const { data: income } = useFinQuery<any[]>("/income", { view });
  const { data: comparison } = useFinQuery<any[]>("/scenarios/compare", { ids: cmp.join(",") }, { enabled: cmp.length > 0 });
  const save = useFinMutation<any, any>("POST", "/scenarios", { success: "Scenario saved" });
  const del = useFinMutation<any, any>("DELETE", (b) => `/scenarios/${b.id}`, { success: "Scenario deleted" });
  const run = React.useCallback(async (list: A[]) => {
    setBusy(true); setError("");
    try { setResult(await api(`/api/finance/${hid}/scenarios/run`, { method: "POST", body: { view, months, assumptions: list.map(clean) } })); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }, [hid, view, months]);
  React.useEffect(() => { const t = setTimeout(() => void run(items), 450); return () => clearTimeout(t); }, [items, run]);
  const upd = (i: number, patch: Partial<A>) => setItems((s) => s.map((x, n) => (n === i ? { ...x, ...patch } : x)));
  const memberTarget = (a: A) => (a.target === "ALL" ? "ALL" : a.target?.memberId ? `m:${a.target.memberId}` : a.target?.incomeId ? `i:${a.target.incomeId}` : "ALL");
  const setTarget = (i: number, v: string) => upd(i, { target: v === "ALL" ? "ALL" : v.startsWith("m:") ? { memberId: v.slice(2) } : { incomeId: v.slice(2) } });
  const TargetSelect = ({ a, i }: { a: A; i: number }) => <Select aria-label="Whose income" value={memberTarget(a)} onChange={(e) => setTarget(i, e.target.value)}><option value="ALL">All income</option>{members.map((m) => <option key={m.id} value={`m:${m.id}`}>{m.name}{m.isMe ? " (you)" : ""}</option>)}{(income ?? []).map((s) => <option key={s.id} value={`i:${s.id}`}>{s.name}</option>)}</Select>;
  const num = (i: number, k: string, label: string, step = "any") => <Field label={label}>{(p) => <Input {...p} type="number" step={step} value={items[i][k] ?? ""} onChange={(e) => upd(i, { [k]: e.target.value === "" ? "" : Number(e.target.value) })} className="money text-right" />}</Field>;
  const d = result?.difference;
  return (
    <div>
      <PageHeader eyebrow="Plan" title="What if" description="Change an assumption and see how your finances respond. Scenarios run on a copy: your real records are never altered." actions={<ViewSwitch className="lg:hidden" />} />
      <ViewNote />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,26rem)_1fr]">
        <div className="space-y-4">
          <Section title="Assumptions" description="Each one is applied to the baseline. Months count from today (0 is this month).">
            <ul className="space-y-4">
              {items.map((a, i) => (
                <li key={i} className="rounded-lg border border-border p-3">
                  <div className="mb-2 flex items-center gap-2"><Select aria-label="Scenario type" value={a.type} onChange={(e) => setItems((s) => s.map((x, n) => (n === i ? blank(e.target.value) : x)))}>{["Income", "Expenses", "Savings", "Debt", "Household", "Home"].map((g) => <optgroup key={g} label={g}>{TYPES.filter((t) => t[2] === g).map((t) => <option key={t[0]} value={t[0]}>{t[1]}</option>)}</optgroup>)}</Select><Button variant="ghost" size="icon" aria-label="Remove assumption" onClick={() => setItems((s) => s.filter((_, n) => n !== i))}><X className="h-4 w-4" /></Button></div>
                  <div className="grid grid-cols-2 gap-3">
                    {a.type === "INCOME_CHANGE" && <><div className="col-span-2"><TargetSelect a={a} i={i} /></div><Field label="Change by">{(p) => <Select {...p} value={a.mode} onChange={(e) => upd(i, { mode: e.target.value })}><option value="PCT">Percent</option><option value="AMOUNT">Amount per payment</option></Select>}</Field>{num(i, "value", a.mode === "PCT" ? "Percent (negative for a cut)" : "Amount (negative for a cut)")}{num(i, "startMonth", "Starts in month")}</>}
                    {a.type === "JOB_LOSS" && <><div className="col-span-2"><TargetSelect a={a} i={i} /></div>{num(i, "startMonth", "Starts in month")}{num(i, "durationMonths", "For how many months")}{num(i, "severance", "Severance received")}</>}
                    {a.type === "JOB_CHANGE" && <><div className="col-span-2"><TargetSelect a={a} i={i} /></div>{num(i, "gapMonths", "Months without pay")}{num(i, "newNetPerPayment", "New net per payment")}{num(i, "startMonth", "Starts in month")}</>}
                    {a.type === "ADD_INCOME" && <>{num(i, "monthlyAmount", "Net amount per month")}{num(i, "startMonth", "Starts in month")}{num(i, "durationMonths", "For months (blank = ongoing)")}</>}
                    {a.type === "BONUS" && <>{num(i, "amount", "Amount")}{num(i, "month", "In month")}</>}
                    {a.type === "EXPENSE_CHANGE" && <><Field label="Which expense" className="col-span-2">{(p) => <Select {...p} value={typeof a.target === "string" ? a.target : a.target.kind ? `k:${a.target.kind}` : `o:${a.target.outflowId}`} onChange={(e) => upd(i, { target: e.target.value === "ALL_SCHEDULED" ? "ALL_SCHEDULED" : e.target.value.startsWith("k:") ? { kind: e.target.value.slice(2) } : { outflowId: e.target.value.slice(2) } })}><option value="ALL_SCHEDULED">All bills, subscriptions and insurance</option><option value="k:BILL">All bills (rent, mortgage, utilities)</option><option value="k:SUBSCRIPTION">All subscriptions</option><option value="k:INSURANCE">All insurance</option><option value="k:VARIABLE">Everyday spending</option></Select>}</Field><Field label="Change by">{(p) => <Select {...p} value={a.mode} onChange={(e) => upd(i, { mode: e.target.value })}><option value="PCT">Percent</option><option value="AMOUNT">Amount each time</option></Select>}</Field>{num(i, "value", "Value")}{num(i, "startMonth", "Starts in month")}</>}
                    {a.type === "ONE_TIME_EXPENSE" && <>{num(i, "amount", "Amount")}{num(i, "month", "In month")}</>}
                    {a.type === "REDUCE_DISCRETIONARY" && <><Field label="Reduce by">{(p) => <Select {...p} value={a.mode} onChange={(e) => upd(i, { mode: e.target.value })}><option value="AMOUNT">Amount per month</option><option value="PCT">Percent</option></Select>}</Field>{num(i, "value", "Value")}{num(i, "startMonth", "Starts in month")}</>}
                    {a.type === "SAVINGS_CHANGE" && <><Field label="Goal" className="col-span-2">{(p) => <Select {...p} value={a.goalId ?? ""} onChange={(e) => upd(i, { goalId: e.target.value || null })}><option value="">Extra savings (no goal)</option>{(goals?.items ?? []).map((g: any) => <option key={g.id} value={g.id}>{g.name}</option>)}</Select>}</Field>{num(i, "extraMonthly", "Extra per month")}{num(i, "startMonth", "Starts in month")}</>}
                    {a.type === "EXTRA_DEBT_PAYMENT" && <><Field label="Debt" className="col-span-2">{(p) => <Select {...p} value={a.debtId ?? ""} onChange={(e) => upd(i, { debtId: e.target.value || null })}><option value="">Highest interest debt</option>{(debts?.items ?? []).map((x: any) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select>}</Field>{num(i, "extraMonthly", "Extra per month")}{num(i, "startMonth", "Starts in month")}</>}
                    {a.type === "DEBT_PAYOFF" && <><Field label="Debt" className="col-span-2">{(p) => <Select {...p} value={a.debtId ?? ""} onChange={(e) => upd(i, { debtId: e.target.value })}><option value="">Choose a debt</option>{(debts?.items ?? []).map((x: any) => <option key={x.id} value={x.id}>{x.name} ({fmt.money(x.outstanding)})</option>)}</Select>}</Field>{num(i, "month", "In month")}</>}
                    {a.type === "CONTRIBUTION_CHANGE" && <>{num(i, "monthlyDelta", "Change per month (negative lowers it)")}{num(i, "startMonth", "Starts in month")}<p className="col-span-2 text-xs text-muted-foreground">Affects your personal forecast. Between members it does not change household totals.</p></>}
                    {a.type === "HOME_PURCHASE" && <>{num(i, "price", "Purchase price")}{num(i, "downPayment", "Down payment")}{num(i, "aprPercent", "Mortgage rate %")}{num(i, "amortisationYears", "Amortization (years)", "1")}{num(i, "closingCostsPct", "Closing costs %")}{num(i, "propertyTaxAnnual", "Property tax per year")}{num(i, "insuranceAnnual", "Home insurance per year")}{num(i, "heatingMonthly", "Heating per month")}{num(i, "rentRemovedMonthly", "Rent no longer paid")}{num(i, "month", "In month")}</>}
                  </div>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex flex-wrap items-center gap-2"><Button variant="outline" size="sm" onClick={() => setItems((s) => [...s, blank("ONE_TIME_EXPENSE")])}><Plus className="h-4 w-4" /> Add assumption</Button><label className="ml-auto text-sm">Horizon <Select aria-label="Horizon" value={months} onChange={(e) => setMonths(Number(e.target.value))} className="ml-1 inline-block h-9 w-auto">{[6, 12, 24, 36, 60].map((m) => <option key={m} value={m}>{m} months</option>)}</Select></label></div>
          </Section>
          <Section title="Saved scenarios" description="Private to you. Save a set of assumptions to compare it later.">
            <div className="flex gap-2"><Input aria-label="Scenario name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name this scenario" /><Button disabled={!name.trim()} onClick={() => save.mutate({ name, view, horizonMonths: months, assumptions: items.map(clean) }, { onSuccess: () => setName("") })}><Save className="h-4 w-4" /> Save</Button></div>
            <ul className="mt-3 divide-y divide-border">{(saved ?? []).map((s) => <li key={s.id} className="flex items-center gap-2 py-2 text-sm"><input type="checkbox" aria-label={`Compare ${s.name}`} checked={cmp.includes(s.id)} onChange={(e) => setCmp((c) => (e.target.checked ? [...c, s.id] : c.filter((x) => x !== s.id)))} /><button className="min-w-0 flex-1 truncate text-left font-medium hover:underline" onClick={() => { setItems((s.assumptions as A[]).length ? (s.assumptions as A[]) : [blank("BONUS")]); setMonths(s.horizonMonths); }}>{s.name}</button><span className="text-xs text-muted-foreground">{s.view === "my" ? "personal" : "household"}</span><Button size="sm" variant="ghost" aria-label={`Delete ${s.name}`} onClick={async () => { if (await confirm({ title: `Delete ${s.name}?`, confirmLabel: "Delete", tone: "danger" })) del.mutate({ id: s.id }); }}><X className="h-4 w-4" /></Button></li>)}{!saved?.length && <li className="py-2 text-sm text-muted-foreground">Nothing saved yet.</li>}</ul>
          </Section>
        </div>
        <div className="min-w-0 space-y-6" aria-live="polite" aria-busy={busy}>
          {error && <Alert tone="danger">{error}</Alert>}
          {!result ? <div className="skeleton h-72 w-full" /> : (
            <>
              <section className="rounded-xl border border-border bg-card p-5" aria-label="Scenario result">
                <p className="mb-3 text-xs text-muted-foreground">Real records changed: <strong>none</strong>. {result.notes.join(" ")}</p>
                <div className="grid gap-5 sm:grid-cols-3">
                  <Compare label="Net worth" now={result.current.end.netWorth} sim={result.simulated.end.netWorth} diff={d.netWorth} />
                  <Compare label="Cash" now={result.current.end.liquid} sim={result.simulated.end.liquid} diff={d.liquid} />
                  <Compare label="Debt" now={result.current.end.debt} sim={result.simulated.end.debt} diff={d.debt} inverse />
                  <Compare label="Savings" now={result.current.end.savings} sim={result.simulated.end.savings} diff={d.savings} />
                  <Figure label="Monthly cash flow impact" value={<Money value={d.monthlyCashFlow} delta size="lg" />} hint="Average per month" />
                  <Figure label="Interest impact" value={<Money value={d.interest} delta size="lg" />} hint="Negative is less interest" />
                </div>
                {result.simulated.firstShortfallDate && <Alert tone="warning">In this scenario cash falls below zero on {fmt.date(result.simulated.firstShortfallDate)}.</Alert>}
                <p className="mt-3 text-xs text-muted-foreground">Figures are at the end of the {result.months} month horizon (today versus simulated).</p>
              </section>
              <ChartCard title="Net worth: current path and scenario" unit={fmt.currency} data={result.monthly} columns={[{ key: "month", label: "Month" }, { key: "currentNetWorth", label: "Current" }, { key: "simulatedNetWorth", label: "Scenario" }]}>
                <Lines data={result.monthly.map((m: any) => ({ m: fmt.month(m.month), Current: Number(m.currentNetWorth), Scenario: Number(m.simulatedNetWorth) }))} xKey="m" series={[{ key: "Current", label: "Current path" }, { key: "Scenario", label: "Scenario" }]} fmt={(v) => fmt.money(v)} />
              </ChartCard>
              <ChartCard title="Cash: current path and scenario" unit={fmt.currency} data={result.monthly} columns={[{ key: "month", label: "Month" }, { key: "currentLiquid", label: "Current" }, { key: "simulatedLiquid", label: "Scenario" }]}>
                <Lines data={result.monthly.map((m: any) => ({ m: fmt.month(m.month), Current: Number(m.currentLiquid), Scenario: Number(m.simulatedLiquid) }))} xKey="m" series={[{ key: "Current", label: "Current path" }, { key: "Scenario", label: "Scenario" }]} fmt={(v) => fmt.money(v)} />
              </ChartCard>
              <Section title="Assumptions in the baseline" description="What the 'current' path is built from."><ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">{result.current.assumptions.map((x: string) => <li key={x}>{x}</li>)}</ul></Section>
            </>
          )}
          {cmp.length > 0 && comparison && (
            <Section title="Saved scenarios compared" flush><div className="overflow-x-auto"><table className="w-full text-sm"><caption className="sr-only">Scenario comparison</caption><thead><tr className="border-b border-border text-left text-[11px] uppercase tracking-[0.1em] text-muted-foreground"><th className="px-4 py-2.5 font-medium">Scenario</th><th className="px-4 py-2.5 text-right font-medium">Net worth change</th><th className="px-4 py-2.5 text-right font-medium">Cash flow per month</th><th className="px-4 py-2.5 text-right font-medium">Debt change</th><th className="px-4 py-2.5 text-right font-medium">Net worth at end</th></tr></thead><tbody>{comparison.map((c) => <tr key={c.id} className="border-b border-border/70 last:border-0"><td className="px-4 py-2.5 font-medium">{c.name}</td><td className="px-4 py-2.5 text-right"><Money value={c.difference.netWorth} delta /></td><td className="px-4 py-2.5 text-right"><Money value={c.difference.monthlyCashFlow} delta /></td><td className="px-4 py-2.5 text-right"><Money value={c.difference.debt} delta /></td><td className="px-4 py-2.5 text-right money">{fmt.money(c.endNetWorth)}</td></tr>)}</tbody></table></div></Section>
          )}
        </div>
      </div>
    </div>
  );
}
function clean(a: A): A {
  const o: any = { ...a };
  for (const k of Object.keys(o)) if (o[k] === "" || o[k] === undefined) delete o[k];
  if (o.type === "DEBT_PAYOFF" && !o.debtId) o.debtId = "none";
  return o;
}
function Compare({ label, now, sim, diff, inverse }: { label: string; now: string; sim: string; diff: string; inverse?: boolean }) {
  const { fmt } = useFin();
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl money">{fmt.money(sim)}</p>
      <p className="text-xs text-muted-foreground">Current path {fmt.money(now)}</p>
      <p className="mt-0.5 text-sm"><Money value={diff} delta className={inverse ? "[&]:text-foreground" : ""} /> <span className="text-xs text-muted-foreground">difference</span></p>
    </div>
  );
}
