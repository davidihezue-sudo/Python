"use client";
import { useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/ui/primitives";
import { ServiceForm } from "@/components/features/service-form";

export default function NewServicePage() {
  const p = useSearchParams();
  const kind = p.get("kind") === "REPAIR" ? "REPAIR" : "MAINTENANCE";
  return (
    <>
      <PageHeader title={kind === "REPAIR" ? "Record a repair" : "Log maintenance"} description="Only the items you mark completed update your schedules, mileage and expenses." />
      <ServiceForm initialAssignmentId={p.get("assignmentId")} initialKind={kind} initialVehicleId={p.get("vehicleId")} />
    </>
  );
}
