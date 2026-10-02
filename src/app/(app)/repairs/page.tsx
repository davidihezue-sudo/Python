"use client";
import { useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/ui/primitives";
import { IssuesPanel } from "@/components/features/issues-panel";
import { RecordsPanel } from "@/components/features/records-panel";
import { Tabs } from "@/components/ui/tabs";
import { useSelectedVehicle, useVehicles } from "@/components/shell/providers";
import * as React from "react";

export default function RepairsPage() {
  const { vehicleId } = useSelectedVehicle();
  const { data } = useVehicles();
  const issue = useSearchParams().get("issue");
  const [tab, setTab] = React.useState("issues");
  const v = data?.find((x) => x.id === vehicleId);
  const canWrite = v ? v.canWrite : (data ?? []).some((x) => x.canWrite);
  return (
    <>
      <PageHeader title="Repairs & Issues" description="Repairs fix problems; routine maintenance is preventative. Track an issue from first symptom to resolution." />
      <Tabs label="Repairs views" value={tab} onChange={setTab} tabs={[{ key: "issues", label: "Issues" }, { key: "repairs", label: "Completed repairs" }]} />
      <div className="pt-4">{tab === "issues" ? <IssuesPanel vehicleId={vehicleId} openId={issue} canWrite={canWrite} /> : <RecordsPanel vehicleId={vehicleId} kind="REPAIR" canWrite={canWrite} />}</div>
    </>
  );
}
