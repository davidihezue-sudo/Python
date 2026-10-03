"use client";
import * as React from "react";
import { Alert, Input } from "@/components/ui/primitives";
import { useFin } from "@/components/finance/provider";
import { useCalc, num } from "@/components/finance/calc";
import { Figure, NeedsHousehold, PageHeader, Section } from "@/components/finance/ui";
import { ChartCard, Lines } from "@/components/ui/charts";

export default function RespPage() {
  return <NeedsHousehold><Inner /></NeedsHousehold>;
}
function Inner() {
  const { fmt } = useFin();
  const [v, setV] = React.useState({ childAge: "3", balance: "0", annualContribution: "2500", returnPct: "5", grantsReceived: "0" });
  const ok = Object.values(v).every((x) => num(x) !== null);
  const body = ok ? { childAge: num(v.childAge), balance: v.balance, annualContribution: v.annualContribution, returnPct: num(v.returnPct), grantsReceived: v.grantsReceived } : null;
  const { data: r, error } = useCalc<any>("/resp/plan", body);
  const f: [string, string, string?][] = [["childAge", "Child's age now"], ["balance", "RESP balance now"], ["annualContribution", "You contribute each year", "The government adds 20% of the first $2,500 a year."], ["returnPct", "Yearly return (%)"], ["grantsReceived", "Grants received so far", "From your RESP statement."]];
  return (
    <div className="space-y-4 sm:space-y-6">
      <PageHeader eyebrow="Plan" title="RESP and education grant planner" description="See how the Canada Education Savings Grant (CESG) adds to your contributions, and whether you are leaving grant money unclaimed." />
      <Section title="Your numbers"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">{f.map(([k, l, h]) => <label key={k} className="text-sm">{l}<Input inputMode="decimal" value={(v as any)[k]} onChange={(e) => setV((s) => ({ ...s, [k]: e.target.value }))} className="mt-1 text-right" />{h && <span className="mt-0.5 block text-xs text-muted-foreground">{h}</span>}</label>)}</div></Section>
      {error && <Alert tone="danger">{error}</Alert>}
      {r && (
        <>
          {Number(r.grantMissed) > 0 && <Alert tone="warning">At this rate you would miss about {fmt.money(r.grantMissed)} in grants. Contributing {fmt.money(r.bestAnnualContribution)} a year collects the most.</Alert>}
          <section className="grid grid-cols-2 gap-4 rounded-xl border border-border bg-card p-4 sm:p-5 sm:grid-cols-4" aria-label="Summary">
            <Figure label="Balance at 18" value={<span className="text-2xl money">{fmt.money(r.atAge18)}</span>} />
            <Figure label="You contribute" value={<span className="text-2xl money">{fmt.money(r.totalContributed)}</span>} />
            <Figure label="Government grants" value={<span className="text-2xl money">{fmt.money(r.totalGrants)}</span>} />
            <Figure label="Lifetime grant left" value={<span className="text-2xl money">{fmt.money(r.lifetimeGrantLeft)}</span>} />
          </section>
          <ChartCard title="Balance by child's age" unit={fmt.currency} data={r.years} columns={[{ key: "age", label: "Age" }, { key: "contribution", label: "Contribution" }, { key: "grant", label: "Grant" }, { key: "balance", label: "Balance" }]}>
            <Lines area data={r.years.map((y: any) => ({ age: y.age, Balance: Number(y.balance) }))} xKey="age" series={[{ key: "Balance", label: "Balance" }]} fmt={(x) => fmt.money(x)} />
          </ChartCard>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">{r.notes.map((t: string) => <li key={t}>{t}</li>)}</ul>
        </>
      )}
    </div>
  );
}
