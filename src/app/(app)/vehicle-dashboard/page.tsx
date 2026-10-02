import type { Metadata } from "next";
import { DashboardView } from "../dashboard/dashboard-view";

export const metadata: Metadata = { title: "Vehicle overview" };
export default function VehicleDashboardPage() {
  return <DashboardView />;
}
