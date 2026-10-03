"use client";
import * as React from "react";
import { Alert, Button, Field, Input, Select } from "@/components/ui/primitives";
import { Tabs, TabPanel } from "@/components/ui/tabs";
import { ChartCard, Lines } from "@/components/ui/charts";
import { api } from "@/lib/client/api";
import { useFin, useFinMutation, useFinQuery } from "@/components/finance/provider";
import { Figure, Money, NeedsHousehold, Notice, PageHeader, Section, ViewSwitch } from "@/components/finance/ui";

const D0 = { price: "500000", downPayment: "100000", aprPercent: "5", amortisationYears: 25, termYears: 5, frequency: "MONTHLY", accelerated: false, propertyTaxAnnual: "3600", insuranceAnnual: "1200", heatingMonthly: "150", condoFeesMonthly: "0", closingCostsPct: "1.5", cashAvailable: "", grossAnnualIncome: "", otherDebtMonthly: "" };
export default function PlannerPage() {
  return <NeedsHousehold><Inner /></NeedsHousehold>;
}
function Inner() {
  const { fmt, hid, view } = useFin();
  const [tab, setTab] = React.useState("mortgage");
  const [inp, setInp] = React.useState<any>(D0);
  const [res, setRes] = React.useState<any>(null);
  const [err, setErr] = React.useState("");
  const [scn, setScn] = React.useState<{ name: string; input: any }[]>([]);
  const [cmp, setCmp] = React.useState<any[] | null>(null);
  const { data: defaults } = useFinQuery<any>("/planner/defaults", { view });
  const { data: saved } = useFinQuery<any[]>("/planner/saved");
  const save = useFinMutation<any, any>("POST", "/planner/saved", { success: "Scenario saved" });
  React.useEffect(() => { if (defaults) setInp((s: any) => ({ ...s, grossAnnualIncome: s.grossAnnualIncome || defaults.grossAnnualIncome, otherDebtMonthly: s.otherDebtMonthly || defaults.monthlyDebtPayments, cashAvailable: s.cashAvailable || defaults.availableCash })); }, [defaults]);
  const body = (i: any) => ({ ...i, amortisationYears: Number(i.amortisationYears), termYears: Number(i.termYears), cashAvailable: i.cashAvailable || null, grossAnnualIncome: i.grossAnnualIncome || undefined, otherDebtMonthly: i.otherDebtMonthly || undefined });
  React.useEffect(() => { const t = setTimeout(async () => { try { setErr(""); setRes(await api(`/api/finance/${hid}/planner/mortgage`, { method: "POST", body: body(inp) })); } catch (e) { setErr((e as Error).message); } }, 400); return () => clearTimeout(t); }, [inp, hid]);
  const set = (k: string, v: any) => setInp((s: any) => ({ ...s, [k]: v }));
  const f = (k: string, label: string, hint?: string) => <Field label={label} hint={hint}>{(p) => <Input {...p} inputMode="decimal" value={inp[k] ?? ""} onChange={(e) => set(k, e.target.value.replace(/[^0-9.]/g, ""))} className="money text-right" />}</Field>;
  const compare = async () => { try { setCmp(await api(`/api/finance/${hid}/planner/mortgage/compare`, { method: "POST", body: { scenarios: scn.map((s) => ({ name: s.name, input: body(s.input) })) } })); } catch (e) { setErr((e as Error).message); } };
  return (
    <div>
      <PageHeader eyebrow="Home" title="Home and mortgage planner" description="Estimate payments, closing costs, cash needed and debt service ratios, and compare purchase scenarios." actions={<ViewSwitch className="lg:hidden" />} />
      <div className="mb-5"><Notice tone="warning">These are estimates for planning only. They are not a mortgage approval or a lender's affordability assessment. Lenders apply their own rates, rules and credit checks.</Notice></div>
      <Tabs label="Planner sections" value={tab} onChange={setTab} tabs={[{ key: "mortgage", label: "Mortgage calculator" }, { key: "afford", label: "How much can we afford" }, { key: "down", label: "Down payment planner" }, { key: "compare", label: "Compare scenarios", count: scn.length }]} />
      <div className="pt-5">
        <TabPanel id="mortgage" active={tab === "mortgage"}>
          <div className="grid gap-4 sm:gap-6 xl:grid-cols-[minmax(0,24rem)_1fr]">
            <Section title="Purchase" description="Change any value to see the effect immediately.">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">{f("price", "Purchase price")}</div>{f("downPayment", "Down payment")}{f("aprPercent", "Interest rate %")}
                <Field label="Amortization">{(p) => <Select {...p} value={inp.amortisationYears} onChange={(e) => set("amortisationYears", Number(e.target.value))}>{[15, 20, 25, 30, 35, 40].map((y) => <option key={y} value={y}>{y} years</option>)}</Select>}</Field>
                <Field label="Term">{(p) => <Select {...p} value={inp.termYears} onChange={(e) => set("termYears", Number(e.target.value))}>{[1, 2, 3, 4, 5, 7, 10].map((y) => <option key={y} value={y}>{y} years</option>)}</Select>}</Field>
                <Field label="Payment frequency" className="col-span-2">{(p) => <Select {...p} value={inp.frequency + (inp.accelerated ? ":A" : "")} onChange={(e) => { const [fq, a] = e.target.value.split(":"); setInp((s: any) => ({ ...s, frequency: fq, accelerated: a === "A" })); }}><option value="MONTHLY">Monthly</option><option value="SEMI_MONTHLY">Semi-monthly</option><option value="BIWEEKLY">Biweekly</option><option value="BIWEEKLY:A">Accelerated biweekly</option><option value="WEEKLY">Weekly</option><option value="WEEKLY:A">Accelerated weekly</option></Select>}</Field>
                {f("propertyTaxAnnual", "Property tax per year")}{f("insuranceAnnual", "Home insurance per year")}{f("heatingMonthly", "Heating per month")}{f("condoFeesMonthly", "Condo fees per month")}{f("closingCostsPct", "Closing costs % of price", "Land transfer tax and legal fees vary by province.")}{f("cashAvailable", "Cash available")}{f("grossAnnualIncome", "Household gross income per year", "Prefilled from your income records.")}{f("otherDebtMonthly", "Other monthly debt payments", "Prefilled from your debts.")}
              </div>
              <div className="mt-4 flex flex-wrap gap-2"><Button variant="outline" size="sm" onClick={() => setScn((s) => [...s, { name: `Scenario ${s.length + 1}: ${fmt.money(inp.price)}`, input: inp }])}>Add to comparison</Button><Button variant="outline" size="sm" onClick={() => save.mutate({ name: `${fmt.money(inp.price)} at ${inp.aprPercent}%`, input: body(inp) })}>Save</Button></div>
              {saved && saved.length > 0 && <div className="mt-3"><p className="text-xs font-medium text-muted-foreground">Saved</p><ul className="mt-1 space-y-1">{saved.map((s) => <li key={s.id}><button className="text-sm text-primary hover:underline" onClick={() => setInp({ ...D0, ...(s.input as any) })}>{s.name}</button></li>)}</ul></div>}
            </Section>
            <div className="min-w-0 space-y-4 sm:space-y-6">
              {err && <Alert tone="danger">{err}</Alert>}
              {res && (
                <>
                  <section className="rounded-xl border border-border bg-card p-4 sm:p-5" aria-label="Mortgage result">
                    <div className="grid gap-5 sm:grid-cols-4">
                      <Figure label={`Payment (${inp.accelerated ? "accelerated " : ""}${inp.frequency.toLowerCase().replace("_", "-")})`} value={<span className="text-3xl money">{fmt.money(res.payment)}</span>} hint={`${fmt.money(res.monthlyEquivalent)} a month equivalent`} />
                      <Figure label="Total housing cost per month" value={res.housingCostMonthly} hint="Mortgage, tax, heat, insurance, condo" />
                      <Figure label="Mortgage amount" value={res.mortgagePrincipal} hint={res.insurancePremium !== "0.00" ? `Includes ${fmt.money(res.insurancePremium)} insurance premium` : "No mortgage insurance"} />
                      <Figure label="Cash needed up front" value={res.cashRequired} hint={`${fmt.money(res.downPayment)} down + ${fmt.money(res.closingCosts)} closing`} />
                    </div>
                    <dl className="mt-5 grid gap-x-8 gap-y-2 border-t border-border pt-4 text-sm sm:grid-cols-2">
                      {[["Down payment", `${fmt.money(res.downPayment)} (${fmt.pct(res.downPaymentPercent)})`], ["Minimum down payment", fmt.money(res.minimumDownPayment)], ["Cash remaining after purchase", res.cashRemaining ? fmt.money(res.cashRemaining) : "n/a"], [`Interest over the ${inp.termYears} year term`, fmt.money(res.totalInterestOverTerm)], ["Balance at the end of the term", fmt.money(res.balanceAtEndOfTerm)], ["Total interest over amortization", fmt.money(res.totalInterestOverAmortisation)]].map(([k, v]) => <div key={k} className="flex justify-between gap-3 border-b border-border/60 py-1.5"><dt className="text-muted-foreground">{k}</dt><dd className="money">{v}</dd></div>)}
                    </dl>
                    {res.ratios && <div className="mt-4 rounded-lg bg-muted p-3 text-sm"><p className="font-medium">Debt service ratios (stress tested at {fmt.pct(res.stressTest.qualifyingRatePercent, 2)})</p><p className="mt-1 text-muted-foreground">GDS {fmt.pct(res.ratios.gds)} (limit {res.ratios.gdsLimit}%) · TDS {fmt.pct(res.ratios.tds)} (limit {res.ratios.tdsLimit}%). {res.ratios.withinLimits ? "Within the configured limits." : "Above the configured limits."}</p></div>}
                    {res.warnings.map((w: string) => <p key={w} className="mt-2 text-sm text-warning">{w}</p>)}
                  </section>
                  <ChartCard title="Mortgage balance over time" unit={fmt.currency} data={res.yearly} columns={[{ key: "year", label: "Year" }, { key: "closing", label: "Balance" }]}><Lines area data={[{ y: 0, Balance: Number(res.mortgagePrincipal) }, ...res.yearly.map((y: any) => ({ y: y.year, Balance: Number(y.closing) }))]} xKey="y" series={[{ key: "Balance", label: "Balance" }]} fmt={(v) => fmt.money(v)} xFmt={(v) => `Year ${v}`} /></ChartCard>
                  <Section title="Assumptions" description="So you can see exactly what was assumed."><ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">{res.assumptions.map((a: string) => <li key={a}>{a}</li>)}</ul><p className="mt-3 text-xs text-muted-foreground">{res.disclaimer}</p></Section>
                </>
              )}
            </div>
          </div>
        </TabPanel>
        <TabPanel id="afford" active={tab === "afford"}>{tab === "afford" && <Afford defaults={defaults} />}</TabPanel>
        <TabPanel id="down" active={tab === "down"}>{tab === "down" && <Down defaults={defaults} />}</TabPanel>
        <TabPanel id="compare" active={tab === "compare"}>
          <Section title="Compare home purchase scenarios" description="Add scenarios from the calculator, then compare them side by side.">
            {scn.length === 0 ? <p className="text-sm text-muted-foreground">Nothing to compare yet. Use "Add to comparison" in the calculator after changing price, down payment, rate or amortization.</p> : <><ul className="mb-3 space-y-1">{scn.map((s, i) => <li key={i} className="flex items-center gap-2 text-sm"><Input aria-label="Scenario name" value={s.name} onChange={(e) => setScn((x) => x.map((y, n) => (n === i ? { ...y, name: e.target.value } : y)))} className="h-8 max-w-xs" /><Button size="sm" variant="ghost" onClick={() => setScn((x) => x.filter((_, n) => n !== i))}>Remove</Button></li>)}</ul><Button onClick={compare}>Compare</Button></>}
            {cmp && <div className="mt-4 overflow-x-auto"><table className="w-full text-sm"><caption className="sr-only">Scenario comparison</caption><thead><tr className="border-b border-border text-left text-[11px] uppercase tracking-[0.1em] text-muted-foreground"><th className="py-2 pr-4 font-medium">Measure</th>{cmp.map((c) => <th key={c.name} className="py-2 pr-4 text-right font-medium">{c.name}</th>)}</tr></thead><tbody>{[["Price", "price"], ["Down payment", "downPayment"], ["Mortgage amount", "mortgagePrincipal"], ["Payment per month (equivalent)", "monthlyEquivalent"], ["Housing cost per month", "housingCostMonthly"], ["Cash needed up front", "cashRequired"], ["Total interest", "totalInterestOverAmortisation"]].map(([l, k]) => <tr key={k} className="border-b border-border/70"><td className="py-2 pr-4 text-muted-foreground">{l}</td>{cmp.map((c) => <td key={c.name} className="py-2 pr-4 text-right money">{fmt.money(c.result[k])}</td>)}</tr>)}</tbody></table></div>}
          </Section>
        </TabPanel>
      </div>
    </div>
  );
}
function Afford({ defaults }: { defaults: any }) {
  const { fmt, hid } = useFin();
  const [i, setI] = React.useState<any>({ grossAnnualIncome: "", downPayment: "", aprPercent: "5", amortisationYears: 25, propertyTaxAnnual: "3600", heatingMonthly: "150", condoFeesMonthly: "0", otherDebtMonthly: "", insuranceAnnual: "1200" });
  const [r, setR] = React.useState<any>(null);
  React.useEffect(() => { if (defaults) setI((s: any) => ({ ...s, grossAnnualIncome: s.grossAnnualIncome || defaults.grossAnnualIncome, otherDebtMonthly: s.otherDebtMonthly || defaults.monthlyDebtPayments, downPayment: s.downPayment || defaults.availableCash })); }, [defaults]);
  React.useEffect(() => { const t = setTimeout(async () => { if (Number(i.grossAnnualIncome) > 0) { try { setR(await api(`/api/finance/${hid}/planner/affordability`, { method: "POST", body: { ...i, amortisationYears: Number(i.amortisationYears) } })); } catch { setR(null); } } }, 400); return () => clearTimeout(t); }, [i, hid]);
  const f = (k: string, label: string, hint?: string) => <Field label={label} hint={hint}>{(p) => <Input {...p} inputMode="decimal" value={i[k]} onChange={(e) => setI((s: any) => ({ ...s, [k]: e.target.value.replace(/[^0-9.]/g, "") }))} className="money text-right" />}</Field>;
  return (
    <div className="grid gap-4 sm:gap-6 xl:grid-cols-[minmax(0,24rem)_1fr]">
      <Section title="Your numbers" description="Prefilled from your records where possible."><div className="grid grid-cols-2 gap-3">{f("grossAnnualIncome", "Household gross income per year")}{f("downPayment", "Down payment available")}{f("aprPercent", "Interest rate %")}{f("amortisationYears", "Amortization (years)")}{f("propertyTaxAnnual", "Property tax per year")}{f("heatingMonthly", "Heating per month")}{f("condoFeesMonthly", "Condo fees per month")}{f("otherDebtMonthly", "Other debt payments per month")}</div></Section>
      {r && <section className="rounded-xl border border-border bg-card p-4 sm:p-5"><Figure label="Estimated maximum purchase price" value={<span className="text-4xl money">{fmt.money(r.maxPrice)}</span>} hint={`At the stress test rate of ${fmt.pct(r.qualifyingRatePercent, 2)}`} />{r.ratios && <p className="mt-3 text-sm text-muted-foreground">GDS {fmt.pct(r.ratios.gds)} and TDS {fmt.pct(r.ratios.tds)} at that price.</p>}<dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2"><div className="flex justify-between border-b border-border/60 py-1.5"><dt className="text-muted-foreground">Estimated payment</dt><dd className="money">{fmt.money(r.estimate.monthlyEquivalent)} a month</dd></div><div className="flex justify-between border-b border-border/60 py-1.5"><dt className="text-muted-foreground">Cash needed</dt><dd className="money">{fmt.money(r.estimate.cashRequired)}</dd></div></dl><p className="mt-3 text-xs text-muted-foreground">{r.disclaimer}</p></section>}
    </div>
  );
}
function Down({ defaults }: { defaults: any }) {
  const { fmt, hid } = useFin();
  const [i, setI] = React.useState<any>({ price: "500000", targetPercent: "20", currentSavings: "", monthlySaving: "1200", targetDate: "" });
  const [r, setR] = React.useState<any>(null);
  React.useEffect(() => { if (defaults) setI((s: any) => ({ ...s, currentSavings: s.currentSavings || defaults.availableCash })); }, [defaults]);
  React.useEffect(() => { const t = setTimeout(async () => { try { setR(await api(`/api/finance/${hid}/planner/down-payment`, { method: "POST", body: { ...i, targetDate: i.targetDate || undefined, currentSavings: i.currentSavings || "0", monthlySaving: i.monthlySaving || "0" } })); } catch { setR(null); } }, 400); return () => clearTimeout(t); }, [i, hid]);
  const f = (k: string, label: string, type = "text") => <Field label={label}>{(p) => <Input {...p} type={type} inputMode={type === "text" ? "decimal" : undefined} value={i[k]} onChange={(e) => setI((s: any) => ({ ...s, [k]: type === "text" ? e.target.value.replace(/[^0-9.]/g, "") : e.target.value }))} className={type === "text" ? "money text-right" : ""} />}</Field>;
  return (
    <div className="grid gap-4 sm:gap-6 xl:grid-cols-[minmax(0,24rem)_1fr]">
      <Section title="Down payment plan"><div className="grid grid-cols-2 gap-3">{f("price", "Target price")}{f("targetPercent", "Down payment %")}{f("currentSavings", "Saved so far")}{f("monthlySaving", "Saving per month")}<div className="col-span-2">{f("targetDate", "Buy by (optional)", "date")}</div></div></Section>
      {r && <section className="rounded-xl border border-border bg-card p-4 sm:p-5"><div className="grid gap-5 sm:grid-cols-3"><Figure label="Target down payment" value={r.targetDownPayment} hint={`Minimum for this price: ${fmt.money(r.minimumForPrice)}`} /><Figure label="Still to save" value={r.remaining} hint={`${fmt.pct(r.percentComplete, 0)} complete`} /><Figure label="Reached around" value={<span className="text-2xl">{r.estimatedDate ? fmt.date(r.estimatedDate) : "n/a"}</span>} hint={r.requiredMonthly ? `${fmt.money(r.requiredMonthly)} a month needed for your date` : undefined} /></div></section>}
    </div>
  );
}
