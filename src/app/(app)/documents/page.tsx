"use client";
import { useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/ui/primitives";
import { DocumentsPanel } from "@/components/features/documents-panel";
import { useSelectedVehicle, useVehicles } from "@/components/shell/providers";

export default function DocumentsPage() {
  const { vehicleId } = useSelectedVehicle();
  const { data } = useVehicles();
  const doc = useSearchParams().get("doc");
  const v = data?.find((x) => x.id === vehicleId);
  return (
    <>
      <PageHeader title="Documents" description="Receipts, invoices, insurance, warranty and registration documents - stored privately with access controls." />
      <DocumentsPanel vehicleId={vehicleId} openId={doc} canWrite={v ? v.canWrite : (data ?? []).some((x) => x.canWrite)} />
    </>
  );
}
