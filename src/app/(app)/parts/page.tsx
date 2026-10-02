"use client";
import { useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/ui/primitives";
import { PartsPanel } from "@/components/features/parts-panel";
import { useSelectedVehicle, useVehicles } from "@/components/shell/providers";

export default function PartsPage() {
  const { vehicleId } = useSelectedVehicle();
  const { data } = useVehicles();
  const part = useSearchParams().get("part");
  const v = data?.find((x) => x.id === vehicleId);
  return (
    <>
      <PageHeader title="Parts Inventory" description="Installed and spare parts, warranties, and the full replacement history of each component." />
      <PartsPanel vehicleId={vehicleId} openId={part} canWrite={v ? v.canWrite : (data ?? []).some((x) => x.canWrite)} />
    </>
  );
}
