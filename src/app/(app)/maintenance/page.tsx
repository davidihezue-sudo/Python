"use client";
import { PageHeader } from "@/components/ui/primitives";
import { SchedulesPanel } from "@/components/features/schedules-panel";
import { useSelectedVehicle, useVehicles } from "@/components/shell/providers";
import { EmptyState } from "@/components/ui/empty";
import Link from "next/link";
import { Button } from "@/components/ui/primitives";

export default function MaintenancePage() {
  const { vehicleId } = useSelectedVehicle();
  const { data: vehicles } = useVehicles();
  const v = vehicles?.find((x) => x.id === vehicleId);
  if (vehicles && vehicles.length === 0)
    return (<><PageHeader title="Maintenance" /><EmptyState title="Add a vehicle to plan maintenance" description="Schedules are configured per vehicle." action={<Link href="/vehicles/new"><Button>Add vehicle</Button></Link>} /></>);
  return (
    <>
      <PageHeader title="Maintenance" description={v ? `Maintenance planner for ${v.nickname}. Statuses recalculate whenever mileage or records change.` : "Maintenance planner across all your vehicles. Pick a vehicle in the top bar to add or customise schedules."} />
      <SchedulesPanel vehicleId={vehicleId} canWrite={v ? v.canWrite : false} />
    </>
  );
}
