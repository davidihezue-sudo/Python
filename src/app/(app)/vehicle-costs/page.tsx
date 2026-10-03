"use client";
import * as React from "react";
import Link from "next/link";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Car, Wrench } from "lucide-react";
import { Badge, Select } from "@/components/ui/primitives";
import { EmptyState } from "@/components/ui/empty";
import { useFin, useFinQuery } from "@/components/finance/provider";
import { Figure, NeedsHousehold, Notice, PageHeader, Section, ViewNote, ViewSwitch, humanize } from "@/components/finance/ui";

export default function VehicleCostsPage() {
  return <NeedsHousehold><Inner /></NeedsHousehold>;
}
const TONE: Record<string, "danger" | "warning" | "neutral" | "success"> = { OVERDUE: "danger", DUE_NOW: "danger", DUE_SOON: "warning", UPCOMING: "neutral", UP_TO_DATE: "success" };

function Inner() {
  const { fmt, view, profile } = useFin();
  const year = Number((profile?.today ?? new Date().toISOString()).slice(0, 4));
  const [range, setRange] = React.useState("ytd");
  const from = range === "ytd" ? `${year}-01-01` : range === "last" ? `${year - 1}-01-01` : `${year - 5}-01-01`;
  const to = range === "last" ? `${year - 1}-12-31` : profile?.today;
  const { data, isLoading } = useFinQuery<any>("/vehicles/overview", { view: view === "my" ? "my" : "household", from, to });
  return (
    <div>
      <PageHeader eyebrow="Vehicles" title="Vehicle running costs" description="What each vehicle costs you, from the transactions you tag with it, next to what it needs next from its maintenance schedule."
        actions={<><ViewSwitch /><Select aria-label="Period" value={range} onChange={(e) => setRange(e.target.value)} className="w-40"><option value="ytd">This year</option><option value="last">Last year</option><option value="all">Last five years</option></Select></>} />
      <ViewNote />
      {isLoading && <div className="skeleton h-40 w-full" aria-hidden />}
      {data && data.vehicles.length === 0 && <EmptyState icon={<Car className="h-5 w-5" />} title="No vehicles yet" description="Add a vehicle to track its maintenance, then tag fuel, insurance and repair transactions with it to see what it really costs." action={<Link href="/vehicles/new" className="rounded-md border border-border px-3 py-1.5 text-sm">Add a vehicle</Link>} />}
      {data && data.vehicles.length > 0 && (
        <>
          <section className="mb-5 grid grid-cols-2 gap-4 rounded-xl border border-border bg-card p-4 sm:p-5 sm:grid-cols-3" aria-label="Summary">
            <Figure label="Total running cost" value={<span className="money text-2xl">{fmt.money(data.totalCost)}</span>} hint={`${fmt.date(data.from)} to ${fmt.date(data.to)}`} />
            <Figure label="Vehicles" value={<span className="text-2xl">{data.vehicles.length}</span>} />
            <Figure label="Maintenance overdue" value={<span className={`text-2xl ${data.vehicles.some((v: any) => v.overdueCount) ? "text-danger" : ""}`}>{data.vehicles.reduce((a: number, v: any) => a + v.overdueCount, 0)}</span>} />
          </section>
          <div className="grid gap-5 lg:grid-cols-2">
            {data.vehicles.map((v: any) => (
              <Section key={v.id} title={<span className="flex items-center gap-2">{v.name}{v.isDemo && <Badge>Demo</Badge>}</span>} description={`${v.year} ${v.make} ${v.model}${v.currentOdometerKm !== null ? `, ${new Intl.NumberFormat(fmt.locale).format(Math.round(data.distanceUnit === "MI" ? v.currentOdometerKm / 1.609344 : v.currentOdometerKm))} ${data.distanceUnit === "MI" ? "mi" : "km"}` : ""}`}
                action={<Link href={`/vehicles/${v.id}`} className="text-sm text-accent hover:underline">Open vehicle</Link>}>
                <div className="grid grid-cols-2 gap-4">
                  {v.costs ? (<>
                    <Figure size="md" label="Running cost" value={<span className="money">{fmt.money(v.costs.total)}</span>} hint={`${v.costs.transactions} transactions`} />
                    <Figure size="md" label={`Cost per ${data.distanceUnit === "MI" ? "mile" : "km"}`} value={v.costs.costPerDistance ? <span className="money">{fmt.money(v.costs.costPerDistance)}</span> : "n/a"} hint={v.costs.distanceDriven !== null ? `${new Intl.NumberFormat(fmt.locale).format(v.costs.distanceDriven)} ${data.distanceUnit === "MI" ? "mi" : "km"} driven` : "Needs two odometer readings"} />
                  </>) : <p className="col-span-2 text-sm text-muted-foreground">Costs for this vehicle are hidden from you.</p>}
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
                  <Wrench className="h-4 w-4 text-muted-foreground" aria-hidden />
                  {v.nextService ? <><span>{v.nextService.name}</span><Badge tone={TONE[v.nextService.status] ?? "neutral"}>{humanize(v.nextService.status)}</Badge><span className="text-muted-foreground">{v.nextService.summary}</span></> : <span className="text-muted-foreground">No maintenance schedule with a due date yet.</span>}
                  {v.openIssues > 0 && <Badge tone="warning">{v.openIssues} open repair issue{v.openIssues === 1 ? "" : "s"}</Badge>}
                </div>
                {v.renewals.length > 0 && <p className="mt-2 text-xs text-muted-foreground">{v.renewals.map((r: any) => `${r.label} ${fmt.date(r.date)}`).join(" · ")}</p>}
                {v.costs && v.costs.byMonth.length > 0 && (
                  <figure className="mt-4 m-0" aria-label={`${v.name} monthly cost`}>
                    <div className="h-36" aria-hidden><ResponsiveContainer width="100%" height="100%"><BarChart data={v.costs.byMonth.map((m: any) => ({ m: fmt.month(m.month), Cost: Number(m.amount) }))} margin={{ top: 4, right: 4, left: -12, bottom: 0 }}><CartesianGrid vertical={false} strokeDasharray="3 3" /><XAxis dataKey="m" tickLine={false} fontSize={11} /><YAxis tickLine={false} axisLine={false} fontSize={11} width={52} tickFormatter={(x) => fmt.money(x).replace(/\.00$/, "")} /><Tooltip formatter={(x: any) => fmt.money(x)} /><Bar dataKey="Cost" fill="#185040" radius={[3, 3, 0, 0]} /></BarChart></ResponsiveContainer></div>
                    <figcaption className="sr-only">{v.costs.byMonth.map((m: any) => `${m.month}: ${fmt.money(m.amount)}`).join(", ")}</figcaption>
                  </figure>
                )}
                {v.costs && v.costs.byCategory.length > 0 && (
                  <table className="mt-3 w-full text-sm"><caption className="sr-only">{v.name} cost by category</caption><tbody>{v.costs.byCategory.map((c: any) => <tr key={c.name} className="border-t border-border/60"><td className="py-1.5">{c.name}</td><td className="money py-1.5 text-right">{fmt.money(c.amount)}</td></tr>)}</tbody></table>
                )}
                {v.costs && (
                  <p className="mt-3 text-sm"><Link className="text-accent hover:underline" href={`/transactions?vehicleId=${v.id}`}>See the transactions tagged with this vehicle</Link></p>
                )}
              </Section>
            ))}
          </div>
          <div className="mt-5 space-y-1 text-xs text-muted-foreground">{data.notes.map((n: string) => <p key={n}>{n}</p>)}</div>
        </>
      )}
    </div>
  );
}
