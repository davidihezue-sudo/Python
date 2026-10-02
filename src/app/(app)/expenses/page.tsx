"use client";
import * as React from "react";
import { useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/ui/primitives";
import { Tabs } from "@/components/ui/tabs";
import { BudgetsPanel, ExpensesPanel, FuelPanel } from "@/components/features/expenses-panels";
import { useSelectedVehicle, useVehicles } from "@/components/shell/providers";

export default function ExpensesPage() {
  const { vehicleId } = useSelectedVehicle();
  const { data } = useVehicles();
  const [tab, setTab] = React.useState(useSearchParams().get("tab") ?? "expenses");
  const v = data?.find((x) => x.id === vehicleId);
  const canWrite = v ? v.canWrite : (data ?? []).some((x) => x.canWrite);
  return (
    <>
      <PageHeader title="Expenses" description="Every cost of ownership — maintenance, repairs, fuel, insurance and more. Services and fuel create their expenses automatically." />
      <Tabs label="Expense views" value={tab} onChange={setTab} tabs={[{ key: "expenses", label: "Expenses" }, { key: "fuel", label: "Fuel" }, { key: "budgets", label: "Budgets" }]} />
      <div className="pt-4">
        {tab === "expenses" && <ExpensesPanel vehicleId={vehicleId} canWrite={canWrite} />}
        {tab === "fuel" && <FuelPanel vehicleId={vehicleId} canWrite={canWrite} />}
        {tab === "budgets" && <BudgetsPanel vehicleId={vehicleId} canWrite={canWrite} />}
      </div>
    </>
  );
}
