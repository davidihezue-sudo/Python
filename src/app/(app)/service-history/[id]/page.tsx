"use client";
import { useParams } from "next/navigation";
import { PageHeader } from "@/components/ui/primitives";
import { ServiceForm } from "@/components/features/service-form";

export default function EditServicePage() {
  const { id } = useParams<{ id: string }>();
  return (
    <>
      <PageHeader title="Edit service record" description="Saving recalculates the vehicle's schedules, mileage and expense for this record." />
      <ServiceForm recordId={id} />
    </>
  );
}
