"use client";
import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Car, Gauge, Plus, AlertTriangle } from "lucide-react";
import { Badge, Button, Card, CardBody, PageHeader, Skeleton, ProgressBar } from "@/components/ui/primitives";
import { EmptyState } from "@/components/ui/empty";
import { ScheduleStatusBadge } from "@/components/ui/status";
import { useFormat, useVehicles } from "@/components/shell/providers";
import { useQuickAdd } from "@/components/forms/quick-dialogs";

export function VehiclesView() {
  const { data, isLoading } = useVehicles();
  const f = useFormat();
  const { open } = useQuickAdd();
  const quick = useSearchParams().get("quick");
  React.useEffect(() => {
    if (quick === "mileage") open("mileage");
  }, [quick, open]);
  return (
    <>
      <PageHeader title="My Vehicles" description="Every vehicle in your household, with its maintenance status at a glance." actions={<Link href="/vehicles/new"><Button><Plus className="h-4 w-4" /> Add vehicle</Button></Link>} />
      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{[0, 1].map((i) => <Skeleton key={i} className="h-56" />)}</div>
      ) : !data?.length ? (
        <EmptyState icon={<Car className="h-6 w-6" />} title="No vehicles registered" description="Add your first vehicle to start tracking maintenance, repairs, mileage and costs." action={<Link href="/vehicles/new"><Button><Plus className="h-4 w-4" /> Add your first vehicle</Button></Link>} />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {data.map((v: any) => (
            <li key={v.id}>
              <Link href={`/vehicles/${v.id}`} className="block h-full rounded-xl">
                <Card className="h-full overflow-hidden transition-colors hover:border-primary/50">
                  <div className="hero-card flex h-32 items-center justify-center">{v.photoUrl ? <img src={v.photoUrl} alt="" className="h-full w-full object-cover" /> : <Car className="h-14 w-14 opacity-40" aria-hidden />}</div>
                  <CardBody className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0"><h2 className="truncate font-semibold">{v.nickname}</h2><p className="text-sm text-muted-foreground">{v.year} {v.make} {v.model}{v.trim ? ` ${v.trim}` : ""}</p></div>
                      {v.isDemo && <Badge tone="info">Demo</Badge>}
                    </div>
                    <p className="flex items-center gap-1.5 text-sm"><Gauge className="h-4 w-4 text-muted-foreground" aria-hidden />{v.currentOdometerKm !== null ? f.distance(v.currentOdometerKm) : <span className="text-muted-foreground">Odometer not recorded</span>}</p>
                    <div className="flex flex-wrap items-center gap-1.5 text-sm">
                      {v.nextService ? <><ScheduleStatusBadge status={v.nextService.status} /><span className="truncate text-muted-foreground">{v.nextService.name}</span></> : <span className="text-muted-foreground">No schedule data yet</span>}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      {v.openIssues > 0 && <span className="flex items-center gap-1 text-warning"><AlertTriangle className="h-3.5 w-3.5" />{v.openIssues} open issue{v.openIssues > 1 ? "s" : ""}</span>}
                      {v.overdueCount > 0 && <span className="text-danger">{v.overdueCount} overdue</span>}
                      {v.accessLevel !== "ADMIN" && v.accessLevel !== "OWNER" && <span>{String(v.accessLevel).toLowerCase().replace("_", " ")} access</span>}
                    </div>
                    {v.health?.score != null ? <div className="flex items-center gap-2"><ProgressBar value={v.health.score} tone={v.health.score >= 70 ? "success" : v.health.score >= 50 ? "warning" : "danger"} label="Maintenance condition" /><span className="text-xs tabular text-muted-foreground">{v.health.score}/100</span></div> : <p className="text-xs text-muted-foreground">Condition: insufficient recorded data</p>}
                  </CardBody>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
