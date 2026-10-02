"use client";
import * as React from "react";
import { useSearchParams } from "next/navigation";
import { Tabs } from "@/components/ui/tabs";
import { FinanceReports } from "./finance-reports";
import { VehicleReports } from "./vehicle-reports";

export default function ReportsPage() {
  const [tab, setTab] = React.useState(useSearchParams().get("tab") === "vehicles" ? "vehicles" : "finance");
  return (
    <div>
      <div className="mb-5"><Tabs label="Report type" value={tab} onChange={setTab} tabs={[{ key: "finance", label: "Finance reports" }, { key: "vehicles", label: "Vehicle reports" }]} /></div>
      {tab === "finance" ? <FinanceReports /> : <VehicleReports />}
    </div>
  );
}
