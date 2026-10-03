"use client";
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { Download, FileSpreadsheet, FileText, FileJson, ShieldCheck } from "lucide-react";
import { api, qs } from "@/lib/client/api";
import { Alert, Badge, Button, Card, CardBody, CardHeader, Checkbox, Field, Input, PageHeader, Select, Skeleton } from "@/components/ui/primitives";
import { ChartCard, Donut, Lines, StackedBars } from "@/components/ui/charts";
import { Tabs } from "@/components/ui/tabs";
import { label } from "@/components/forms/common";
import { useFormat, useMe, useSelectedVehicle, useVehicles } from "@/components/shell/providers";

const RANGES = [["30d", "Last 30 days"], ["90d", "Last 90 days"], ["ytd", "Year to date"], ["12m", "Last 12 months"], ["all", "All time"], ["custom", "Custom range"]];

export function VehicleReports() {
  const [tab, setTab] = React.useState("analytics");
  return (
    <>
      <p className="mb-4 max-w-2xl text-sm text-muted-foreground">Understand what your vehicles cost, and export service history, repair, warranty and fuel reports to share with a mechanic, insurer or buyer.</p>
      <Tabs label="Vehicle report views" value={tab} onChange={setTab} tabs={[{ key: "analytics", label: "Analytics" }, { key: "exports", label: "Reports and exports" }]} />
      <div className="pt-4">{tab === "analytics" ? <Analytics /> : <Exports />}</div>
    </>
  );
}

function Analytics() {
  const f = useFormat();
  const { vehicleId } = useSelectedVehicle();
  const [range, setRange] = React.useState("12m");
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const [exclude, setExclude] = React.useState<string[]>([]);
  const { data: a, isLoading } = useQuery({ queryKey: ["analytics", vehicleId, range, from, to, exclude], queryFn: () => api<any>(`/api/analytics/expenses${qs({ vehicleId, range, from: range === "custom" ? from : undefined, to: range === "custom" ? to : undefined, exclude: exclude.join(",") })}`) });
  const toggle = (c: string) => setExclude((x) => (x.includes(c) ? x.filter((y) => y !== c) : [...x, c]));
  if (isLoading || !a) return <Skeleton className="h-96" />;
  if (!a.hasFinancialAccess) return <Alert tone="info" title="Financial analytics are restricted">You don't have permission to view cost details for the selected vehicle(s).</Alert>;
  const cur = a.currency;
  const m = (n: number | null | undefined) => (n == null ? "n/a" : f.money(n, cur));
  const cpd = a.costPerDistance;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Select aria-label="Date range" className="h-9 w-auto" value={range} onChange={(e) => setRange(e.target.value)}>{RANGES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
        {range === "custom" && <><input aria-label="From" type="date" className="h-9 rounded-md border border-input bg-card px-2 text-sm" value={from} onChange={(e) => setFrom(e.target.value)} /><input aria-label="To" type="date" className="h-9 rounded-md border border-input bg-card px-2 text-sm" value={to} onChange={(e) => setTo(e.target.value)} /></>}
        <fieldset className="flex flex-wrap items-center gap-3 text-sm"><legend className="sr-only">Exclude categories from totals and cost per distance</legend><span className="text-muted-foreground">Exclude:</span>{["FINANCING", "INSURANCE", "FUEL"].map((c) => <Checkbox key={c} label={label(c)} checked={exclude.includes(c)} onChange={() => toggle(c)} />)}</fieldset>
      </div>
      {a.otherCurrencyExpenses > 0 && <Alert tone="warning">{a.otherCurrencyExpenses} expense(s) in other currencies are excluded, no exchange rates are applied.</Alert>}
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4" aria-label="Spending summary">
        {[["Total (selected)", m(a.totals.all), `${a.totals.count} expenses`], ["Maintenance", m(a.totals.maintenance), `avg ${m(a.averages.monthlyMaintenance)} / month`], ["Repairs", m(a.totals.repairs), a.averages.averageRepairCost != null ? `avg ${m(a.averages.averageRepairCost)} per repair` : "none"], ["Ownership / month", m(a.averages.monthlyOwnership), `≈ ${m(a.averages.annualOwnership)} / year`]].map(([k, v, h]) => <Card key={k as string} className="p-4"><p className="text-xs uppercase tracking-wide text-muted-foreground">{k}</p><p className="mt-2 text-2xl font-semibold tabular">{v}</p><p className="text-xs text-muted-foreground">{h}</p></Card>)}
      </section>
      <Card>
        <CardHeader title={`Cost per ${f.unitLabel === "mi" ? "mile" : "kilometre"}`} description={cpd.note} />
        <CardBody>
          <div className="grid gap-3 sm:grid-cols-3">
            {([["Total ownership expense", cpd.totalOwnership], ["Maintenance only", cpd.maintenanceOnly], ["Repairs only", cpd.repairOnly]] as const).map(([k, c]) => (
              <div key={k} className="rounded-lg border border-border p-4"><p className="text-sm text-muted-foreground">{k}</p><p className="mt-1 text-2xl font-semibold tabular">{c.costPerKm === null ? "n/a" : f.perDistance(c.costPerKm)}</p><p className="text-xs text-muted-foreground">{c.distanceKm ? `${m(c.totalCost)} over ${f.distance(c.distanceKm)}` : "Needs at least two odometer readings in this period"}{c.partialCoverage ? " · partial coverage" : ""}</p></div>
            ))}
          </div>
          {cpd.totalOwnership.excludedOutsideCoverage?.count > 0 && <p className="mt-3 text-sm text-warning">{cpd.totalOwnership.excludedOutsideCoverage.count} expense(s) totalling {m(cpd.totalOwnership.excludedOutsideCoverage.amount)} fall outside your odometer history, so they are not included in this figure.</p>}
          {cpd.totalOwnership.notes?.map((n: string) => <p key={n} className="mt-1 text-xs text-muted-foreground">{n}</p>)}
        </CardBody>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Spending by month" unit={cur} data={a.byMonth} columns={[{ key: "month", label: "Month" }, { key: "maintenance", label: "Maintenance" }, { key: "repairs", label: "Repairs" }, { key: "other", label: "Other" }]}><StackedBars data={a.byMonth} xKey="month" series={[{ key: "maintenance", label: "Maintenance" }, { key: "repairs", label: "Repairs" }, { key: "other", label: "Other" }]} fmt={(v) => f.money(v, cur)} /></ChartCard>
        <ChartCard title="Spending by category" unit={cur} data={a.byCategory.map((c: any) => ({ ...c, name: label(c.key) }))} columns={[{ key: "name", label: "Category" }, { key: "total", label: "Total" }]}><Donut data={a.byCategory.map((c: any) => ({ ...c, name: label(c.key) }))} nameKey="name" valueKey="total" fmt={(v) => f.money(v, cur)} /></ChartCard>
        <ChartCard title="Spending by year" unit={cur} data={a.byYear} columns={[{ key: "key", label: "Year" }, { key: "total", label: "Total" }]}><StackedBars data={a.byYear} xKey="key" series={[{ key: "total", label: "Total" }]} fmt={(v) => f.money(v, cur)} /></ChartCard>
        <ChartCard title="Spending by service provider" unit={cur} data={a.byProvider} empty="No provider or vendor names recorded" columns={[{ key: "key", label: "Provider" }, { key: "total", label: "Total" }]}><StackedBars data={a.byProvider} xKey="key" series={[{ key: "total", label: "Total" }]} fmt={(v) => f.money(v, cur)} /></ChartCard>
        <ChartCard title="Repair cost by component" unit={cur} data={a.repairByComponent.map((c: any) => ({ ...c, name: label(c.component) }))} columns={[{ key: "name", label: "Component" }, { key: "total", label: "Total" }, { key: "count", label: "Repairs" }]}><StackedBars data={a.repairByComponent.map((c: any) => ({ ...c, name: label(c.component) }))} xKey="name" series={[{ key: "total", label: "Repair cost" }]} fmt={(v) => f.money(v, cur)} /></ChartCard>
        <ChartCard title="Distance driven per month" unit={f.unitLabel} empty={vehicleId === "all" || !vehicleId ? "Select one vehicle to see monthly mileage" : undefined} data={a.mileageMonthly.map((x: any) => ({ month: x.month, d: f.distanceValue(x.km) }))} columns={[{ key: "month", label: "Month" }, { key: "d", label: f.unitLabel }]}><Lines area data={a.mileageMonthly.map((x: any) => ({ month: x.month, d: f.distanceValue(x.km) }))} xKey="month" series={[{ key: "d", label: `Distance (${f.unitLabel})` }]} fmt={(v) => f.number(v)} /></ChartCard>
      </div>
    </div>
  );
}

function Exports() {
  const f = useFormat();
  const me = useMe();
  const sp = useSearchParams();
  const { vehicleId: selected } = useSelectedVehicle();
  const { data: vehicles } = useVehicles();
  const { data: cat } = useQuery({ queryKey: ["report-catalog"], queryFn: () => api<{ reports: any[] }>("/api/reports") });
  const [type, setType] = React.useState("service-history");
  const [vehicleId, setVehicle] = React.useState(sp.get("vehicleId") ?? "");
  const [year, setYear] = React.useState(String(new Date().getFullYear()));
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const [hideVin, setHideVin] = React.useState(me.preferences.shareHideVin);
  const [hideCosts, setHideCosts] = React.useState(me.preferences.shareHideCosts);
  const [hideProviders, setHideProviders] = React.useState(me.preferences.shareHideProviders);
  React.useEffect(() => { if (!vehicleId) setVehicle(selected !== "all" ? selected : vehicles?.[0]?.id ?? ""); }, [selected, vehicles, vehicleId]);
  const meta = cat?.reports.find((r) => r.type === type);
  const v = vehicles?.find((x) => x.id === vehicleId);
  const link = (fmt: string) => `/api/reports/${type}${qs({ format: fmt, vehicleId: meta?.needsVehicle || vehicleId ? vehicleId : undefined, year: meta?.needsYear ? year : undefined, from, to, hideVin: hideVin ? "1" : "0", hideCosts: hideCosts ? "1" : "0", hideProviders: hideProviders ? "1" : "0" })}`;
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader title="Generate a report" description="PDF reports are formatted for sharing with a mechanic, dealership, insurer or buyer." />
        <CardBody className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Report" className="sm:col-span-2">{(p) => <Select {...p} value={type} onChange={(e) => setType(e.target.value)}>{cat?.reports.map((r) => <option key={r.type} value={r.type}>{r.label}</option>)}</Select>}</Field>
            <Field label="Vehicle">{(p) => <Select {...p} value={vehicleId} onChange={(e) => setVehicle(e.target.value)}>{!meta?.needsVehicle && <option value="">All vehicles</option>}{vehicles?.map((x) => <option key={x.id} value={x.id}>{x.nickname}</option>)}</Select>}</Field>
            {meta?.needsYear ? <Field label="Year">{(p) => <Input type="number" {...p} value={year} onChange={(e) => setYear(e.target.value)} />}</Field> : <span />}
            {!meta?.needsYear && <><Field label="From (optional)">{(p) => <Input type="date" {...p} value={from} onChange={(e) => setFrom(e.target.value)} />}</Field><Field label="To (optional)">{(p) => <Input type="date" {...p} value={to} onChange={(e) => setTo(e.target.value)} />}</Field></>}
          </div>
          {meta && <p className="text-sm text-muted-foreground">{meta.description}</p>}
          <fieldset className="rounded-lg border border-border p-3"><legend className="flex items-center gap-1.5 px-1 text-sm font-medium"><ShieldCheck className="h-4 w-4 text-primary" /> Privacy before sharing</legend>
            <div className="grid gap-2 sm:grid-cols-3"><Checkbox label="Hide VIN & plate" checked={hideVin} onChange={(e) => setHideVin(e.target.checked)} /><Checkbox label="Hide all costs" checked={hideCosts || (v ? !v.canViewFinancials : false)} disabled={v ? !v.canViewFinancials : false} onChange={(e) => setHideCosts(e.target.checked)} /><Checkbox label="Hide provider names" checked={hideProviders} onChange={(e) => setHideProviders(e.target.checked)} /></div>
            <p className="mt-2 text-xs text-muted-foreground">Defaults come from Settings → Privacy. Hidden data is removed from the file itself, not just masked.</p></fieldset>
          <div className="flex flex-wrap gap-2">
            <a href={link("pdf")}><Button><FileText className="h-4 w-4" /> Download PDF</Button></a>
            <a href={link("csv")}><Button variant="outline"><Download className="h-4 w-4" /> CSV</Button></a>
            <a href={link("xlsx")}><Button variant="outline"><FileSpreadsheet className="h-4 w-4" /> Excel</Button></a>
            <a href={link("json")}><Button variant="outline"><FileJson className="h-4 w-4" /> JSON</Button></a>
          </div>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Available reports" />
        <CardBody><ul className="space-y-2 text-sm">{cat?.reports.map((r) => <li key={r.type}><button className="text-left hover:text-primary" onClick={() => setType(r.type)}><span className="font-medium">{r.label}</span> {r.shareable && <Badge tone="primary">shareable</Badge>}{r.financial && <Badge>financial</Badge>}</button></li>)}</ul>
          <p className="mt-4 text-xs text-muted-foreground">Distances are shown in {f.unitLabel}; amounts in {f.prefs.currency}. Change units in Settings.</p></CardBody>
      </Card>
    </div>
  );
}
