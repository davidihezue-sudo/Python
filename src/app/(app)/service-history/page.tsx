"use client";
import { useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/ui/primitives";
import { RecordsPanel } from "@/components/features/records-panel";
import { useSelectedVehicle, useVehicles } from "@/components/shell/providers";

export default function ServiceHistoryPage() {
  const { vehicleId } = useSelectedVehicle();
  const { data } = useVehicles();
  const record = useSearchParams().get("record");
  const v = data?.find((x) => x.id === vehicleId);
  return (
    <>
      <PageHeader title="Service History" description={v ? `Every recorded service and repair for ${v.nickname}.` : "Every recorded service and repair across your vehicles."} />
      <RecordsPanel vehicleId={vehicleId} openId={record} canWrite={v ? v.canWrite : (data ?? []).some((x) => x.canWrite)} />
    </>
  );
}
