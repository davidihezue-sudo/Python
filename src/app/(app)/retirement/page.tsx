"use client";
import * as React from "react";
import { Alert, Input } from "@/components/ui/primitives";
import { useFin, useFinQuery } from "@/components/finance/provider";
import { useCalc, num } from "@/components/finance/calc";
import { Figure, NeedsHousehold, PageHeader, Section } from "@/components/finance/ui";
import { ChartCard, Lines } from "@/components/ui/charts";

export default function RetirementPage() {
  return <NeedsHousehold><Inner /></NeedsHousehold>;
}
const FIELDS: [string, string, string?][] = [
  ["currentAge", "Your age now"], ["retireAge", "Retire at"], ["lifeAge", "Plan to age", "Most plans use 90 to 95."],
  ["savings", "Invested savings now", "Prefilled from your own investment accounts."], ["monthlyContribution", "You save each month"],
  ["returnPct", "Yearly return (%)", "Before inflation."], ["inflationPct", "Inflation (%)"], ["annualSpending", "Yearly spending in retirement", "In today's dollars."],
  ["benefitIncome", "Yearly pension income (CPP, OAS, workplace)", "In today's dollars. Check your statements."], ["benefitAge", "Pension starts at"], ["withdrawalPct", "Withdrawal rate (%)", "4 is the common rule of thumb."],
];

function Inner() {
  const { fmt } = useFin();
  const { data: def } = useFinQuery<any>("/retirement/defaults");
  const [v, setV] = React.useState<Record<string, string>>({ currentAge: "35", retireAge: "65", lifeAge: "95", savings: "", monthlyContribution: "500", returnPct: "6", inflationPct: "2", annualSpending: "50000", benefitIncome: "20000", benefitAge: "65", withdrawalPct: "4" });
  React.useEffect(() => { if (def && !v.savings) setV((s) => ({ ...s, savings: def.savings })); }, [def]); // eslint-disable-line react-hooks/exhaustive-deps
  const n = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, num(x)]));
  const ok = Object.values(n).every((x) => x !== null);
  const body = ok ? { currentAge: n.currentAge, retireAge: n.retireAge, lifeAge: n.lifeAge, savings: v.savings, monthlyContribution: v.monthlyContribution, returnPct: n.returnPct, inflationPct: n.inflationPct, annualSpending: v.annualSpending, benefitIncome: v.benefitIncome, benefitAge: n.benefitAge, withdrawalPct: n.withdrawalPct } : null;
  const { data: r, error } = useCalc<any>("/retirement/project", body);
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Plan" title="Retirement and financial independence" description="See whether your savings can carry you, and what to change if not. Nothing here is saved." />
      <Section title="Your numbers">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {FIELDS.map(([k, label, hint]) => (
            <label key={k} className="text-sm">{label}<Input inputMode="decimal" value={v[k]} onChange={(e) => setV((s) => ({ ...s, [k]: e.target.value }))} className="mt-1 text-right" />{hint && <span className="mt-0.5 block text-xs text-muted-foreground">{hint}</span>}</label>
          ))}
        </div>
      </Section>
      {error && <Alert tone="danger">{error}</Alert>}
      {r && (
        <>
          <Alert tone={r.onTrack ? "success" : "warning"}>{r.onTrack ? `On track: your money lasts to age ${v.lifeAge} in this projection.` : `Your money runs out around age ${r.depletionAge} in this projection.`}</Alert>
          <section className="grid grid-cols-2 gap-4 rounded-xl border border-border bg-card p-5 sm:grid-cols-4" aria-label="Summary">
            <Figure label="Independence number" value={<span className="text-2xl money">{fmt.money(r.fiNumber)}</span>} hint="What you need at retirement" />
            <Figure label="Projected at retirement" value={<span className="text-2xl money">{fmt.money(r.atRetirement)}</span>} hint={`${r.fundedPercent}% of the number`} />
            <Figure label="Gap" value={<span className="text-2xl money">{fmt.money(r.gap)}</span>} />
            <Figure label="Save each month to reach it" value={<span className="text-2xl money">{r.requiredMonthly ? fmt.money(r.requiredMonthly) : "n/a"}</span>} hint={`Real return ${r.realReturnPct}%`} />
          </section>
          <ChartCard title="Savings over your life" description="In today's dollars" unit={fmt.currency} data={r.series} columns={[{ key: "age", label: "Age" }, { key: "balance", label: "Balance" }]}>
            <Lines area data={r.series.map((p: any) => ({ age: p.age, Balance: Number(p.balance) }))} xKey="age" series={[{ key: "Balance", label: "Balance" }]} fmt={(x) => fmt.money(x)} />
          </ChartCard>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">{r.notes.map((t: string) => <li key={t}>{t}</li>)}</ul>
        </>
      )}
    </div>
  );
}
