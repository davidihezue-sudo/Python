"use client";
import * as React from "react";
import { Alert } from "@/components/ui/primitives";
import { Select } from "@/components/ui/primitives";
import { ChartCard, Lines, StackedBars } from "@/components/ui/charts";
import { useFin, useFinQuery } from "@/components/finance/provider";
import { Figure, Money, NeedsHousehold, Notice, PageHeader, Section, ViewNote, ViewSwitch } from "@/components/finance/ui";
import { Input } from "@/components/ui/primitives";

const HORIZONS: [string, string, Record<string, number>][] = [["30 days", "30d", { days: 30 }], ["90 days", "90d", { days: 90 }], ["6 months", "6m", { months: 6 }], ["12 months", "12m", { months: 12 }], ["24 months", "24m", { months: 24 }], ["Custom (months)", "custom", {}]];
export default function ForecastPage() {
  return <NeedsHousehold><Inner /></NeedsHousehold>;
}
function Inner() {
  const { fmt, view } = useFin();
  const [h, setH] = React.useState("12m");
  const [custom, setCustom] = React.useState("18");
  const [sav, setSav] = React.useState("0");
  const [inv, setInv] = React.useState("0");
  const horizon = h === "custom" ? { months: Math.min(60, Math.max(1, Number(custom) || 12)) } : HORIZONS.find((x) => x[1] === h)![2];
  const { data, isLoading } = useFinQuery<any>("/forecast", { view, ...horizon, savingsInterestPct: sav || 0, investmentReturnPct: inv || 0 });
  const f = data?.forecast;
  const rows = f ? [...data.actual.map((a: any) => ({ ...a })), ...f.months] : [];
  return (
    <div>
      <PageHeader eyebrow="Plan" title="Forecast" description="A projection built from your scheduled income and bills, debt payments, savings contributions and past spending. It is an estimate, never a guarantee." actions={<ViewSwitch className="lg:hidden" />} />
      <ViewNote />
      <div className="mb-5 flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-4">
        <label className="text-sm font-medium">Look ahead<Select value={h} onChange={(e) => setH(e.target.value)} className="mt-1 h-9 w-44">{HORIZONS.map(([l, k]) => <option key={k} value={k}>{l}</option>)}</Select></label>
        {h === "custom" && <label className="text-sm font-medium">Months<Input type="number" min={1} max={60} value={custom} onChange={(e) => setCustom(e.target.value)} className="mt-1 h-9 w-24" /></label>}
        <label className="text-sm font-medium">Savings interest % a year<Input inputMode="decimal" value={sav} onChange={(e) => setSav(e.target.value.replace(/[^0-9.]/g, ""))} className="mt-1 h-9 w-28 text-right" /></label>
        <label className="text-sm font-medium">Investment return % a year<Input inputMode="decimal" value={inv} onChange={(e) => setInv(e.target.value.replace(/[^0-9.-]/g, ""))} className="mt-1 h-9 w-28 text-right" /></label>
        <p className="max-w-sm pb-1 text-xs text-muted-foreground">Returns default to zero so nothing assumes market gains. Change them to explore.</p>
      </div>
      {isLoading || !f ? <div className="skeleton h-72 w-full" /> : (
        <div className="space-y-6">
          {f.warnings.map((w: string) => <Alert key={w} tone="warning">{w}</Alert>)}
          <section className="grid gap-5 rounded-xl border border-border bg-card p-5 sm:grid-cols-4" aria-label="Forecast summary">
            <Figure label={`Net worth at ${fmt.date(f.to)}`} value={f.end.netWorth} hint={`Today ${fmt.money(f.start.netWorth)}`} />
            <Figure label="Cash at the end" value={f.end.liquid} hint={`Lowest ${fmt.money(f.lowestLiquid.amount)} on ${fmt.date(f.lowestLiquid.date)}`} />
            <Figure label="Debt at the end" value={f.end.debt} hint={f.debtFreeDate ? `Debt free ${fmt.date(f.debtFreeDate)}` : `Today ${fmt.money(f.start.debt)}`} />
            <Figure label="Net cash flow" value={<Money value={f.totals.netCashFlow} delta size="lg" />} hint="Income minus expenses" />
          </section>
          <div className="grid gap-6 lg:grid-cols-2">
            <ChartCard title="Cash flow by month" description="Actual months first, then forecast" unit={fmt.currency} data={rows} columns={[{ key: "month", label: "Month" }, { key: "kind", label: "Actual or forecast" }, { key: "income", label: "Income" }, { key: "expenses", label: "Expenses" }]}>
              <StackedBars data={rows.map((r: any) => ({ m: `${fmt.month(r.month)}${r.kind === "actual" ? "" : "*"}`, Income: Number(r.income), Expenses: Number(r.expenses) }))} xKey="m" series={[{ key: "Income", label: "Income" }, { key: "Expenses", label: "Expenses" }]} fmt={(v) => fmt.money(v)} />
            </ChartCard>
            <ChartCard title="Projected balances" description="Month end. * marks forecast." unit={fmt.currency} data={f.months} columns={[{ key: "month", label: "Month" }, { key: "endLiquid", label: "Cash" }, { key: "endNetWorth", label: "Net worth" }]}>
              <Lines data={f.months.map((m: any) => ({ m: fmt.month(m.month), Cash: Number(m.endLiquid), Savings: Number(m.endSavings), "Net worth": Number(m.endNetWorth) }))} xKey="m" series={[{ key: "Cash", label: "Cash" }, { key: "Savings", label: "Savings" }, { key: "Net worth", label: "Net worth" }]} fmt={(v) => fmt.money(v)} />
            </ChartCard>
          </div>
          <Section title="Month by month" description="Forecast figures. The first and last months may be partial." flush>
            <div className="overflow-x-auto"><table className="w-full text-sm"><caption className="sr-only">Forecast by month</caption>
              <thead><tr className="border-b border-border text-left text-[11px] uppercase tracking-[0.1em] text-muted-foreground"><th className="px-4 py-2.5 font-medium">Month</th><th className="px-4 py-2.5 text-right font-medium">Income</th><th className="px-4 py-2.5 text-right font-medium">Expenses</th><th className="px-4 py-2.5 text-right font-medium">Net</th><th className="px-4 py-2.5 text-right font-medium">Saved</th><th className="px-4 py-2.5 text-right font-medium">Debt</th><th className="px-4 py-2.5 text-right font-medium">Cash</th><th className="px-4 py-2.5 text-right font-medium">Net worth</th></tr></thead>
              <tbody>{f.months.map((m: any) => <tr key={m.month} className="border-b border-border/70 last:border-0"><td className="px-4 py-2.5">{fmt.month(m.month)}{m.partial ? <span className="ml-1 text-xs text-muted-foreground">(partial)</span> : null} <span className="ml-1 rounded bg-muted px-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">forecast</span></td><td className="px-4 py-2.5 text-right money">{fmt.money(m.income)}</td><td className="px-4 py-2.5 text-right money">{fmt.money(m.expenses)}</td><td className="px-4 py-2.5 text-right"><Money value={m.netCashFlow} delta /></td><td className="px-4 py-2.5 text-right money">{fmt.money(m.savingsContributions)}</td><td className="px-4 py-2.5 text-right money">{fmt.money(m.endDebt)}</td><td className="px-4 py-2.5 text-right money">{fmt.money(m.endLiquid)}</td><td className="px-4 py-2.5 text-right money font-medium">{fmt.money(m.endNetWorth)}</td></tr>)}</tbody></table></div>
          </Section>
          <Section title="Assumptions behind this forecast" description="Read these before relying on any number above."><ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">{f.assumptions.map((a: string) => <li key={a}>{a}</li>)}</ul><p className="mt-3 text-xs text-muted-foreground">{data.disclaimer}</p></Section>
        </div>
      )}
    </div>
  );
}
