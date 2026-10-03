"use client";
import * as React from "react";
import { Alert, Input } from "@/components/ui/primitives";
import { useFin } from "@/components/finance/provider";
import { useFinQuery } from "@/components/finance/provider";
import { useCalc, num } from "@/components/finance/calc";
import { Figure, NeedsHousehold, PageHeader, Section, VehicleSelect, useVehicleOptions } from "@/components/finance/ui";
import { ChartCard, Lines } from "@/components/ui/charts";

export default function KeepOrReplacePage() {
  return <NeedsHousehold><Inner /></NeedsHousehold>;
}
const KEEP: [string, string][] = [["value", "What it is worth now"], ["annualRepairs", "Repairs and maintenance a year"], ["repairGrowthPct", "Repairs rise each year (%)"], ["annualFuel", "Fuel a year"], ["annualInsurance", "Insurance a year"], ["depreciationPct", "Loses value each year (%)"]];
const REPL: [string, string][] = [["price", "Price of the replacement"], ["downPayment", "Down payment"], ["loanRatePct", "Loan rate (%)"], ["loanMonths", "Loan term (months)"], ["annualRepairs", "Repairs and maintenance a year"], ["annualFuel", "Fuel a year"], ["annualInsurance", "Insurance a year"], ["firstYearDepreciationPct", "Loses value in year one (%)"], ["depreciationPct", "Loses value after (%)"]];

function Inner() {
  const { fmt } = useFin();
  const opts = useVehicleOptions();
  const [vid, setVid] = React.useState("");
  const { data: def, error: defErr } = useFinQuery<any>(`/vehicles/${vid}/replace-defaults`, {}, { enabled: !!vid, retry: false });
  const [years, setYears] = React.useState("5");
  const [k, setK] = React.useState<Record<string, string>>({ value: "8000", annualRepairs: "1500", repairGrowthPct: "10", annualFuel: "2400", annualInsurance: "1500", depreciationPct: "10" });
  const [r, setR] = React.useState<Record<string, string>>({ price: "35000", downPayment: "5000", loanRatePct: "7", loanMonths: "60", annualRepairs: "300", annualFuel: "2000", annualInsurance: "2200", firstYearDepreciationPct: "20", depreciationPct: "12" });
  React.useEffect(() => { if (def) { setK((s) => ({ ...s, annualRepairs: def.annualRepairs, annualFuel: def.annualFuel, annualInsurance: def.annualInsurance })); } }, [def]);
  const text = ["value", "annualRepairs", "annualFuel", "annualInsurance", "price", "downPayment"];
  const conv = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).map(([key, v]) => [key, text.includes(key) ? v : num(v)]));
  const ok = [...Object.values(k), ...Object.values(r), years].every((x) => num(x) !== null);
  const { data: res, error } = useCalc<any>("/vehicles/keep-or-replace", ok ? { years: Number(years), keep: conv(k), replace: conv(r) } : null);
  const field = (o: Record<string, string>, set: (f: (s: Record<string, string>) => Record<string, string>) => void, key: string, label: string) => <label key={key} className="text-sm">{label}<Input inputMode="decimal" value={o[key]} onChange={(e) => set((s) => ({ ...s, [key]: e.target.value }))} className="mt-1 text-right" /></label>;
  return (
    <div className="space-y-4 sm:space-y-6">
      <PageHeader eyebrow="Vehicles" title="Keep or replace" description="Compare the real cost of keeping your current vehicle with replacing it. Pick a vehicle to start from what it has actually cost you." />
      <Section title="Start from a vehicle (optional)"><div className="max-w-sm">{(opts.data?.length ?? 0) > 0 ? <VehicleSelect value={vid} onChange={setVid} /> : <p className="text-sm text-muted-foreground">No vehicles yet. Enter the numbers by hand.</p>}</div>{def && <p className="mt-2 text-xs text-muted-foreground">{def.basis}</p>}{defErr && <p className="mt-2 text-xs text-muted-foreground">Costs for this vehicle are not available to you, so enter them by hand.</p>}</Section>
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Keep what you have"><div className="grid gap-3 sm:grid-cols-2">{KEEP.map(([key, l]) => field(k, setK, key, l))}</div></Section>
        <Section title="Replace it"><div className="grid gap-3 sm:grid-cols-2">{REPL.map(([key, l]) => field(r, setR, key, l))}</div></Section>
      </div>
      <label className="block max-w-xs text-sm">Compare over how many years<Input inputMode="numeric" value={years} onChange={(e) => setYears(e.target.value)} className="mt-1 text-right" /></label>
      {error && <Alert tone="danger">{error}</Alert>}
      {res && (
        <>
          <Alert tone={res.cheaper === "SAME" ? "info" : "success"}>{res.cheaper === "SAME" ? "The two options cost about the same." : `${res.cheaper === "KEEP" ? "Keeping" : "Replacing"} costs about ${fmt.money(res.difference)} less over ${years} years.`}{res.breakEvenYear ? ` Replacing breaks even in year ${res.breakEvenYear}.` : ""}</Alert>
          <section className="grid grid-cols-2 gap-4 rounded-xl border border-border bg-card p-4 sm:p-5 sm:grid-cols-4" aria-label="Totals">
            <Figure label="Keep, total cost" value={<span className="text-2xl money">{fmt.money(res.keepTotal)}</span>} />
            <Figure label="Replace, total cost" value={<span className="text-2xl money">{fmt.money(res.replaceTotal)}</span>} />
            <Figure label="New loan payment" value={<span className="text-2xl money">{fmt.money(res.replaceMonthlyPayment)}</span>} hint="a month" />
            <Figure label="Loan interest" value={<span className="text-2xl money">{fmt.money(res.replaceInterest)}</span>} />
          </section>
          <ChartCard title="Cumulative cost" unit={fmt.currency} data={res.yearly} columns={[{ key: "year", label: "Year" }, { key: "keep", label: "Keep" }, { key: "replace", label: "Replace" }]}>
            <Lines data={res.yearly.map((y: any) => ({ year: `Year ${y.year}`, Keep: Number(y.keep), Replace: Number(y.replace) }))} xKey="year" series={[{ key: "Keep", label: "Keep" }, { key: "Replace", label: "Replace" }]} fmt={(x) => fmt.money(x)} />
          </ChartCard>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">{res.notes.map((t: string) => <li key={t}>{t}</li>)}</ul>
        </>
      )}
    </div>
  );
}
