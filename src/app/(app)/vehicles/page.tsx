import type { Metadata } from "next";
import { VehiclesView } from "./vehicles-view";
export const metadata: Metadata = { title: "My Vehicles" };
export default function Page() {
  return <VehiclesView />;
}
