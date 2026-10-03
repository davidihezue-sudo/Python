"use client";
import * as React from "react";
import { Alert, Select } from "@/components/ui/primitives";
import { useFin, useFinQuery } from "@/components/finance/provider";
import { Figure, NeedsHousehold, PageHeader, Section } from "@/components/finance/ui";
import { ChartCard, StackedBars } from "@/components/ui/charts";

export default function YearPage() {
  return <NeedsHousehold><Inner /></NeedsHousehold>;
}
function Inner() {
  const { fmt, view: global } = useFin();
  const thisYear = new Date().getFullYear();
  const [year, setYear] = React.useState(thisYear);
  const [view, setView] = React.useState<"my" | "household">(global === "household" ? "household" : "my");
  const { data: r, isLoading } = useFinQuery<any>("/year-in-review", { view, year });
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Tools" title="Year in review" description="Your year at a glance: what came in, where it went and how you did." actions={<div className="flex gap-2"><Select aria-label="Whose" value={view} onChange={(e) => setView(e.target.value as any)} className="h-10 w-auto"><option value="my">My records</option><option value="household">Shared with the household</option></Select><Select aria-label="Year" value={year} onChange={(e) => setYear(Number(e.target.value))} className="h-10 w-auto">{[0, 1, 2, 3, 4].map((i) => <option key={i}>{thisYear - i}</option>)}</Select></div>} />
      {isLoading || !r ? <div className="skeleton h-64 w-full" /> : (
        <>
          {r.partial && <Alert tone="info">{year} is not over yet, so this covers 1 January to today.</Alert>}
          <section className="hero-card rounded-xl p-6" aria-label="Highlights">
            <ul className="space-y-2 text-lg">{r.highlights.map((h: string) => <li key={h}>{h}</li>)}</ul>
          </section>
          <section className="grid grid-cols-2 gap-4 rounded-xl border border-border bg-card p-5 sm:grid-cols-4" aria-label="Totals">
            <Figure label="Income" value={<span className="text-2xl money">{fmt.money(r.totals.income)}</span>} />
            <Figure label="Spending" value={<span className="text-2xl money">{fmt.money(r.totals.expenses)}</span>} />
            <Figure label="Left over" value={<span className="text-2xl money">{fmt.money(r.totals.netCashFlow)}</span>} />
            <Figure label="Net worth change" value={<span className="text-2xl money">{r.netWorth.change ? fmt.money(r.netWorth.change, { sign: true }) : "n/a"}</span>} />
          </section>
          <div className="grid gap-6 lg:grid-cols-2">
            <ChartCard title="Month by month" unit={fmt.currency} data={r.months} columns={[{ key: "month", label: "Month" }, { key: "income", label: "Income" }, { key: "expenses", label: "Expenses" }]}>
              <StackedBars data={r.months.map((m: any) => ({ month: fmt.month(m.month), Income: Number(m.income), Expenses: Number(m.expenses) }))} xKey="month" series={[{ key: "Income", label: "Income" }, { key: "Expenses", label: "Expenses" }]} fmt={(x) => fmt.money(x)} />
            </ChartCard>
            <Section title="Biggest categories">
              <ul className="divide-y divide-border text-sm">{r.topCategories.map((c: any) => <li key={c.name} className="flex justify-between py-1.5"><span>{c.name}</span><span className="money">{fmt.money(c.amount)}</span></li>)}</ul>
              {r.topCategories.length === 0 && <p className="text-sm text-muted-foreground">No spending recorded for this year.</p>}
            </Section>
          </div>
        </>
      )}
    </div>
  );
}
