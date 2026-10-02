"use client";
import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, Car, Gauge, Plus, ShieldAlert, Sparkles, Wrench, Wallet, CalendarClock, Info } from "lucide-react";
import { api, qs } from "@/lib/client/api";
import { Alert, Badge, Button, Card, CardBody, CardHeader, Select, Skeleton, ProgressBar, PageHeader } from "@/components/ui/primitives";
import { EmptyState, Stat } from "@/components/ui/empty";
import { ChartCard, Donut, Lines, StackedBars } from "@/components/ui/charts";
import { ScheduleStatusBadge, SeverityBadge, IssueStatusBadge, BASIS_LABEL } from "@/components/ui/status";
import { useFormat, useSelectedVehicle, useVehicles } from "@/components/shell/providers";
import { useQuickAdd } from "@/components/forms/quick-dialogs";
import { titleCase } from "@/lib/client/utils";

const RANGES = [["30d", "Last 30 days"], ["90d", "Last 90 days"], ["ytd", "Year to date"], ["12m", "Last 12 months"], ["all", "All time"], ["custom", "Custom range"]] as const;

export function DashboardView() {
  const f = useFormat();
  const { vehicleId } = useSelectedVehicle();
  const { data: vehicles, isLoading: vLoading } = useVehicles();
  const { open } = useQuickAdd();
  const [range, setRange] = React.useState<string>("12m");
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const q = useQuery({
    queryKey: ["dashboard", vehicleId, range, from, to],
    queryFn: () => api<any>(`/api/analytics/dashboard${qs({ vehicleId, range, from: range === "custom" ? from : undefined, to: range === "custom" ? to : undefined })}`),
    enabled: !vLoading && (vehicles?.length ?? 0) > 0,
  });

  if (vLoading) return <DashboardSkeleton />;
  if (!vehicles?.length)
    return (
      <>
        <PageHeader title="Vehicle overview" />
        <EmptyState icon={<Car className="h-6 w-6" />} title="Add your first vehicle" description="Register a vehicle to start tracking maintenance, repairs, mileage and expenses. You can start from a template, such as the 2015 BMW X3 28i starter profile." action={<><Link href="/vehicles/new"><Button><Plus className="h-4 w-4" /> Add vehicle</Button></Link></>} />
      </>
    );
  const d = q.data;
  const k = d?.kpis;
  const ex = d?.expense;
  const money = (n: number | null | undefined) => (n === null || n === undefined ? "n/a" : f.money(n, k?.currency));
  const selected = vehicles.find((v) => v.id === vehicleId);

  return (
    <div className="space-y-6">
      <PageHeader
        title={selected ? selected.nickname : "Vehicle overview"}
        description={selected ? `${selected.year} ${selected.make} ${selected.model}` : "Household overview across all your vehicles"}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Select aria-label="Date range" value={range} onChange={(e) => setRange(e.target.value)} className="h-9 w-auto">
              {RANGES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
            {range === "custom" && (
              <>
                <input aria-label="From date" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 rounded-md border border-input bg-card px-2 text-sm" />
                <input aria-label="To date" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 rounded-md border border-input bg-card px-2 text-sm" />
              </>
            )}
          </div>
        }
      />
      {d?.hasDemo && <Alert tone="info" title="Demo data">This account contains clearly-labelled demo vehicles for development. Delete them from the vehicle page when you're done.</Alert>}
      {q.isError && <Alert tone="danger" title="Couldn't load the dashboard">{(q.error as Error).message}</Alert>}

      {/* KPI cards */}
      <section aria-label="Key figures" className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {!k ? Array.from({ length: 8 }).map((_, i) => <Card key={i} className="p-4"><Skeleton className="h-3 w-20" /><Skeleton className="mt-3 h-7 w-24" /></Card>) : (
          <>
            <Stat label="Vehicles" value={k.vehicles} icon={<Car className="h-4 w-4" />} href="/vehicles" />
            <Stat label="Combined mileage" value={f.distance(k.combinedKm)} icon={<Gauge className="h-4 w-4" />} />
            <Stat label="Upcoming maintenance" value={k.upcomingMaintenance} icon={<CalendarClock className="h-4 w-4" />} href="/maintenance" />
            <Stat label="Overdue maintenance" value={k.overdueMaintenance} tone={k.overdueMaintenance ? "danger" : undefined} icon={<ShieldAlert className="h-4 w-4" />} href="/maintenance" />
            <Stat label="Outstanding repairs" value={k.outstandingRepairs} tone={k.outstandingRepairs ? "warning" : undefined} icon={<AlertTriangle className="h-4 w-4" />} href="/repairs" />
            <Stat label="Maintenance spend (YTD)" value={money(k.maintenanceSpendYtd)} icon={<Wrench className="h-4 w-4" />} href="/expenses" />
            <Stat label="Repair spend (YTD)" value={money(k.repairSpendYtd)} icon={<Wrench className="h-4 w-4" />} href="/expenses" />
            <Stat label="Lifetime expenses" value={money(k.lifetimeSpend)} hint={k.lifetimeSpend === null ? "No financial access" : undefined} icon={<Wallet className="h-4 w-4" />} href="/expenses" />
          </>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-3 [&>*]:min-w-0">
        {/* Vehicle health */}
        <Card className="lg:col-span-2">
          <CardHeader title="Vehicle health overview" description={k?.health ? (k.health.score === null ? "Maintenance condition: insufficient recorded data to estimate" : `Household maintenance condition ${k.health.score}/100 - ${k.health.label} (based on ${k.health.known} schedules with recorded history)`) : undefined} action={<Link href="/vehicles"><Button variant="ghost" size="sm">All vehicles <ArrowRight className="h-4 w-4" /></Button></Link>} />
          <CardBody>
            <ul className="grid gap-3 sm:grid-cols-2">
              {(d?.vehicles ?? vehicles.map((v) => ({ id: v.id, name: v.nickname, subtitle: `${v.year} ${v.make} ${v.model}`, currentKm: v.currentOdometerKm, photoUrl: v.photoUrl, health: { score: null }, nextService: null, overdue: 0 }))).map((v: any) => (
                <li key={v.id}>
                  <Link href={`/vehicles/${v.id}`} className="group flex gap-3 rounded-xl border border-border p-3 transition-colors hover:border-primary/50">
                    <div className="flex h-16 w-24 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted">
                      {v.photoUrl ? <img src={v.photoUrl} alt="" className="h-full w-full object-cover" /> : <Car className="h-7 w-7 text-muted-foreground" aria-hidden />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2"><p className="truncate font-medium">{v.name}</p>{v.isDemo && <Badge tone="info">Demo</Badge>}</div>
                      <p className="text-xs text-muted-foreground">{v.subtitle} · {f.distance(v.currentKm)}</p>
                      <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
                        {v.nextService ? <><ScheduleStatusBadge status={v.nextService.status} /><span className="truncate text-muted-foreground">{v.nextService.name}</span></> : <span className="text-muted-foreground">{v.unknown ? `${v.unknown} schedules need history` : "No schedule data yet"}</span>}
                      </p>
                      {v.health?.score != null && <div className="mt-1.5 flex items-center gap-2"><ProgressBar value={v.health.score} tone={v.health.score >= 70 ? "success" : v.health.score >= 50 ? "warning" : "danger"} label={`Maintenance condition ${v.health.score} of 100`} /><span className="text-xs tabular text-muted-foreground">{v.health.score}</span></div>}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>

        {/* Insights */}
        <Card>
          <CardHeader title="Insights" description="Calculated from your recorded data" action={<Link href="/assistant"><Button variant="ghost" size="sm"><Sparkles className="h-4 w-4" /> Ask AI</Button></Link>} />
          <CardBody className="space-y-3">
            {!d ? <Skeleton className="h-24" /> : d.insights.length === 0 ? <p className="py-4 text-sm text-muted-foreground">Nothing needs your attention right now.</p> : d.insights.slice(0, 5).map((i: any) => (
              <div key={i.id + i.vehicleId} className="rounded-lg border border-border p-3">
                <div className="flex items-start gap-2">
                  <Info className={`mt-0.5 h-4 w-4 shrink-0 ${i.severity === "critical" ? "text-danger" : i.severity === "warning" ? "text-warning" : "text-info"}`} aria-hidden />
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{i.title}</p>
                    <p className="text-xs text-muted-foreground">{i.vehicleName} - {i.detail}</p>
                    {i.basis?.length > 0 && <p className="mt-1 text-[11px] text-muted-foreground">Based on: {i.basis.map((b: string) => BASIS_LABEL[b] ?? b).join(" + ")}</p>}
                    {i.action && <Link href={i.action.href} className="mt-1 inline-block text-xs font-medium text-primary hover:underline">{i.action.label}</Link>}
                  </div>
                </div>
              </div>
            ))}
          </CardBody>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        {/* Upcoming */}
        <Card>
          <CardHeader title="Upcoming maintenance" description="Sorted by urgency, then due date" action={<Link href="/reminders"><Button variant="ghost" size="sm">All reminders</Button></Link>} />
          <CardBody>
            {!d ? <Skeleton className="h-32" /> : d.upcoming.length === 0 ? <EmptyState className="py-6" title="All configured schedules are currently up to date" description="Add history to schedules with unknown status so due dates can be calculated." action={<Link href="/maintenance"><Button variant="outline" size="sm">Review schedules</Button></Link>} /> : (
              <ul className="divide-y divide-border">
                {d.upcoming.slice(0, 7).map((u: any) => (
                  <li key={u.key} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{u.title}</p>
                      <p className="truncate text-xs text-muted-foreground">{u.vehicleName} · {u.summary}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Badge tone={u.state === "overdue" ? "danger" : u.state === "due" ? "warning" : u.state === "soon" ? "warning" : "info"}>{u.state === "overdue" ? "Overdue" : u.state === "due" ? "Due" : u.state === "soon" ? "Soon" : "Upcoming"}</Badge>
                      {u.kind === "maintenance" && <Link href={u.actionUrl}><Button size="sm" variant="outline">Log</Button></Link>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        {/* Repairs */}
        <Card>
          <CardHeader title="Repair management" description="Unresolved issues" action={<Button variant="ghost" size="sm" onClick={() => open("issue")}><Plus className="h-4 w-4" /> Report</Button>} />
          <CardBody>
            {!d ? <Skeleton className="h-32" /> : d.openIssues.length === 0 ? <EmptyState className="py-6" title="No outstanding issues" description="Report a warning light, noise or leak to start tracking it." /> : (
              <ul className="divide-y divide-border">
                {d.openIssues.map((i: any) => (
                  <li key={i.id}>
                    <Link href={`/repairs?issue=${i.id}`} className="flex items-center justify-between gap-3 py-2.5 hover:text-primary">
                      <div className="min-w-0"><p className="truncate text-sm font-medium">{i.title}</p><p className="text-xs text-muted-foreground">{i.vehicleName} · since {f.date(i.discoveredAt)}</p></div>
                      <div className="flex shrink-0 gap-1.5"><SeverityBadge severity={i.severity} /><IssueStatusBadge status={i.status} /></div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      {/* Expense analytics */}
      <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <ChartCard title="Monthly maintenance & repair spending" unit={ex?.currency} data={ex?.hasFinancialAccess === false ? [] : (ex?.byMonth ?? [])} loading={!ex} empty={ex?.hasFinancialAccess === false ? "Financial details aren't visible with your access level" : undefined} columns={[{ key: "month", label: "Month" }, { key: "maintenance", label: "Maintenance" }, { key: "repairs", label: "Repairs" }, { key: "other", label: "Other" }]}>
          <StackedBars data={ex?.byMonth ?? []} xKey="month" series={[{ key: "maintenance", label: "Maintenance" }, { key: "repairs", label: "Repairs" }, { key: "other", label: "Other" }]} fmt={(v) => f.money(v, ex?.currency)} />
        </ChartCard>
        <ChartCard title="Expense breakdown by category" unit={ex?.currency} data={(ex?.byCategory ?? []).map((c: any) => ({ ...c, name: titleCase(c.key) }))} loading={!ex} columns={[{ key: "name", label: "Category" }, { key: "total", label: "Total" }]}>
          <Donut data={(ex?.byCategory ?? []).map((c: any) => ({ ...c, name: titleCase(c.key) }))} nameKey="name" valueKey="total" fmt={(v) => f.money(v, ex?.currency)} />
        </ChartCard>
        <ChartCard title="Annual expense trend" unit={ex?.currency} data={ex?.byYear ?? []} loading={!ex} columns={[{ key: "key", label: "Year" }, { key: "total", label: "Total" }]} height={220}>
          <StackedBars data={ex?.byYear ?? []} xKey="key" series={[{ key: "total", label: "Total expenses" }]} fmt={(v) => f.money(v, ex?.currency)} />
        </ChartCard>
        <Card>
          <CardHeader title="Cost per distance" description={ex ? ex.costPerDistance.note : undefined} />
          <CardBody>
            {!ex ? <Skeleton className="h-28" /> : (
              <div className="grid grid-cols-3 gap-3 text-center">
                {([["Total ownership", ex.costPerDistance.totalOwnership], ["Maintenance only", ex.costPerDistance.maintenanceOnly], ["Repairs only", ex.costPerDistance.repairOnly]] as const).map(([label, c]) => (
                  <div key={label} className="rounded-lg border border-border p-3">
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className="mt-1 text-lg font-semibold tabular">{c.costPerKm === null ? "n/a" : f.perDistance(c.costPerKm)}</p>
                    <p className="text-[11px] text-muted-foreground">{c.distanceKm ? `${f.distance(c.distanceKm)} covered` : "needs odometer history"}</p>
                  </div>
                ))}
              </div>
            )}
            {ex && ex.costPerDistance.totalOwnership.excludedOutsideCoverage?.count > 0 && <p className="mt-3 text-xs text-warning">{ex.costPerDistance.totalOwnership.excludedOutsideCoverage.count} expense(s) fall outside your odometer history and were left out so this figure isn't misleading.</p>}
          </CardBody>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <Card>
          <CardHeader title="Recent service activity" action={<Link href="/service-history"><Button variant="ghost" size="sm">History</Button></Link>} />
          <CardBody>
            {!d ? <Skeleton className="h-32" /> : d.recentActivity.length === 0 ? <EmptyState className="py-6" title="No service history yet" description="Record your first service to build the timeline." action={<Link href="/service-history/new"><Button size="sm">Record a service</Button></Link>} /> : (
              <ol className="relative ml-2 space-y-4 border-l border-border pl-5">
                {d.recentActivity.map((r: any) => (
                  <li key={r.id} className="relative">
                    <span className="absolute -left-[26px] top-1.5 h-2.5 w-2.5 rounded-full bg-primary ring-4 ring-background" aria-hidden />
                    <Link href={`/service-history?record=${r.id}`} className="block hover:text-primary"><p className="text-sm font-medium">{r.title}</p><p className="text-xs text-muted-foreground">{f.date(r.date)} · {r.vehicleName}{r.odometerKm !== null ? ` · ${f.distance(r.odometerKm)}` : ""}{r.totalCost ? ` · ${f.money(r.totalCost, r.currency)}` : ""}</p></Link>
                  </li>
                ))}
              </ol>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Warranty monitoring" description="Coverage ending within 60 days or recently expired" />
          <CardBody>
            {!d ? <Skeleton className="h-24" /> : d.warranties.length === 0 ? <p className="py-4 text-sm text-muted-foreground">No warranties are about to expire. Add warranties from a vehicle's page to monitor them.</p> : (
              <ul className="divide-y divide-border">
                {d.warranties.map((w: any) => (
                  <li key={w.id} className="flex items-center justify-between gap-3 py-2.5"><div><p className="text-sm font-medium">{w.name}</p><p className="text-xs text-muted-foreground">{w.vehicleName} · ends {f.date(w.endDate)}</p></div><Badge tone={w.status === "expired" ? "danger" : "warning"}>{w.status === "expired" ? "Expired" : `${w.daysRemaining} days left`}</Badge></li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading dashboard">
      <Skeleton className="h-8 w-48" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{Array.from({ length: 8 }).map((_, i) => <Card key={i} className="p-4"><Skeleton className="h-3 w-20" /><Skeleton className="mt-3 h-7 w-24" /></Card>)}</div>
      <Skeleton className="h-64" />
    </div>
  );
}
export { Lines };
