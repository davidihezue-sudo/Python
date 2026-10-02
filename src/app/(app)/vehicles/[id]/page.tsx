"use client";
import * as React from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, Car, Gauge, Trash2, Wrench, AlertTriangle } from "lucide-react";
import { api } from "@/lib/client/api";
import { Alert, Badge, Button, Card, CardBody, CardHeader, Skeleton } from "@/components/ui/primitives";
import { Tabs, TabPanel } from "@/components/ui/tabs";
import { Dropdown, MenuItem } from "@/components/ui/menu";
import { useConfirm } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { useQuickAdd } from "@/components/forms/quick-dialogs";
import { VehicleForm } from "@/components/features/vehicle-form";
import { SchedulesPanel } from "@/components/features/schedules-panel";
import { RecordsPanel } from "@/components/features/records-panel";
import { IssuesPanel } from "@/components/features/issues-panel";
import { PartsPanel } from "@/components/features/parts-panel";
import { ExpensesPanel, FuelPanel } from "@/components/features/expenses-panels";
import { DocumentsPanel } from "@/components/features/documents-panel";
import { AccessPanel, DiagnosticsPanel, InspectionsPanel, OdometerPanel, OverviewPanel, WarrantyPanel } from "@/components/features/vehicle-panels";
import { useFormat, useSelectedVehicle } from "@/components/shell/providers";

export default function VehiclePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const sp = useSearchParams();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { toast } = useToast();
  const f = useFormat();
  const { open } = useQuickAdd();
  const { setVehicleId } = useSelectedVehicle();
  const [tab, setTab] = React.useState(sp.get("tab") ?? "overview");
  const { data: v, isLoading, error } = useQuery({ queryKey: ["vehicle", id], queryFn: () => api<any>(`/api/vehicles/${id}`) });
  React.useEffect(() => { setVehicleId(id); }, [id, setVehicleId]);
  const changeTab = (t: string) => { setTab(t); history.replaceState(null, "", `?tab=${t}`); };
  const photoRef = React.useRef<HTMLInputElement>(null);

  if (isLoading) return <div className="space-y-4"><Skeleton className="h-32" /><Skeleton className="h-64" /></div>;
  if (error || !v) return <Alert tone="danger" title="Vehicle not found">You may not have access to this vehicle, or it was deleted. <Link className="underline" href="/vehicles">Back to vehicles</Link></Alert>;

  const p = v.permissions;
  const uploadPhoto = async (file: File) => {
    try {
      const fd = new FormData();
      fd.set("file", file); fd.set("vehicleId", v.id); fd.set("category", "VEHICLE_PHOTO"); fd.set("title", `${v.nickname} photo`);
      const doc = await api<any>("/api/documents", { method: "POST", body: fd });
      await api(`/api/vehicles/${v.id}`, { method: "PATCH", body: { photoDocumentId: doc.document.id } });
      toast({ title: "Photo updated" });
      void qc.invalidateQueries();
    } catch (e) { toast({ title: "Couldn't upload photo", description: (e as Error).message, variant: "error" }); }
  };
  const del = async () => {
    if (!(await confirm({ title: `Delete ${v.nickname}?`, description: "The vehicle and its records are hidden for everyone in the household. Exports made earlier are unaffected.", confirmLabel: "Delete vehicle" }))) return;
    await api(`/api/vehicles/${v.id}`, { method: "DELETE" });
    toast({ title: "Vehicle deleted" });
    void qc.invalidateQueries();
    setVehicleId("all");
    router.push("/vehicles");
  };
  const tabs = [
    { key: "overview", label: "Overview" },
    { key: "schedule", label: "Maintenance" },
    { key: "history", label: "Service history", count: v.stats.completedServices },
    { key: "repairs", label: "Repairs", count: v.stats.openIssues },
    { key: "parts", label: "Parts" },
    ...(p.financials ? [{ key: "expenses", label: "Expenses" }] : []),
    { key: "fuel", label: "Fuel" },
    { key: "odometer", label: "Odometer" },
    { key: "documents", label: "Documents", count: v.stats.documents },
    { key: "warranty", label: "Warranty" },
    { key: "diagnostics", label: "Diagnostics" },
    { key: "inspections", label: "Inspections" },
    ...(p.edit ? [{ key: "details", label: "Edit details" }] : []),
    ...(p.manageAccess ? [{ key: "access", label: "Sharing & access" }] : []),
  ];
  return (
    <div className="space-y-4">
      <section className="hero-card overflow-hidden rounded-2xl">
        <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
          <div className="relative flex h-28 w-full shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white/10 sm:w-44">
            {v.photoUrl ? <img src={v.photoUrl} alt={`${v.nickname}`} className="h-full w-full object-cover" /> : <Car className="h-12 w-12 opacity-50" aria-hidden />}
            {p.edit && <><button onClick={() => photoRef.current?.click()} className="absolute bottom-1.5 right-1.5 rounded-full bg-black/60 p-1.5 text-white hover:bg-black/80" aria-label="Change vehicle photo"><Camera className="h-4 w-4" /></button><input ref={photoRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => e.target.files?.[0] && uploadPhoto(e.target.files[0])} /></>}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2"><h1 className="truncate text-2xl font-semibold">{v.nickname}</h1>{v.isDemo && <Badge tone="info">Demo data</Badge>}</div>
            <p className="text-white/70">{v.year} {v.make} {v.model}{v.trim ? ` ${v.trim}` : ""}{v.generation ? ` (${v.generation})` : ""}</p>
            <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-white/80"><span className="flex items-center gap-1.5"><Gauge className="h-4 w-4" />{v.currentOdometerKm !== null ? f.distance(v.currentOdometerKm) : "Odometer not recorded"}</span>{v.stats.lastServiceDate && <span>Last service {f.date(v.stats.lastServiceDate)}</span>}{v.stats.openIssues > 0 && <span className="flex items-center gap-1 text-amber-300"><AlertTriangle className="h-4 w-4" />{v.stats.openIssues} open issue{v.stats.openIssues > 1 ? "s" : ""}</span>}</p>
          </div>
          {p.write && (
            <div className="flex flex-wrap gap-2 sm:flex-col">
              <Button variant="secondary" onClick={() => open("mileage", { vehicleId: v.id })}><Gauge className="h-4 w-4" /> Update mileage</Button>
              <Link href={`/service-history/new?vehicleId=${v.id}`}><Button className="w-full"><Wrench className="h-4 w-4" /> Log service</Button></Link>
              {p.manageAccess && <Dropdown label="More" trigger={(x) => <Button variant="secondary" {...x}>More…</Button>}>{(close) => <><MenuItem href={`/reports?vehicleId=${v.id}`} onClick={close}>Reports & exports</MenuItem><MenuItem danger icon={<Trash2 className="h-4 w-4" />} onClick={() => { close(); void del(); }}>Delete vehicle</MenuItem></>}</Dropdown>}
            </div>
          )}
        </div>
      </section>
      {v.accessLevel !== "ADMIN" && v.accessLevel !== "OWNER" && <Alert tone="info">You have <strong>{String(v.accessLevel).toLowerCase().replace("_", " ")}</strong> access to this vehicle{p.financials ? "" : "; cost details are hidden"}.</Alert>}
      <Tabs tabs={tabs} value={tab} onChange={changeTab} label="Vehicle sections" />
      <TabPanel id="overview" active={tab === "overview"}><OverviewPanel v={v} /></TabPanel>
      <TabPanel id="schedule" active={tab === "schedule"}><SchedulesPanel vehicleId={v.id} canWrite={p.write} /></TabPanel>
      <TabPanel id="history" active={tab === "history"}><RecordsPanel vehicleId={v.id} canWrite={p.write} /></TabPanel>
      <TabPanel id="repairs" active={tab === "repairs"}><IssuesPanel vehicleId={v.id} canWrite={p.write} /></TabPanel>
      <TabPanel id="parts" active={tab === "parts"}><PartsPanel vehicleId={v.id} canWrite={p.write} /></TabPanel>
      <TabPanel id="expenses" active={tab === "expenses"}><ExpensesPanel vehicleId={v.id} canWrite={p.write} /></TabPanel>
      <TabPanel id="fuel" active={tab === "fuel"}><FuelPanel vehicleId={v.id} canWrite={p.write} /></TabPanel>
      <TabPanel id="odometer" active={tab === "odometer"}><OdometerPanel vehicleId={v.id} canWrite={p.write} /></TabPanel>
      <TabPanel id="documents" active={tab === "documents"}><DocumentsPanel vehicleId={v.id} canWrite={p.write} /></TabPanel>
      <TabPanel id="warranty" active={tab === "warranty"}><WarrantyPanel vehicleId={v.id} canWrite={p.write} /></TabPanel>
      <TabPanel id="diagnostics" active={tab === "diagnostics"}><DiagnosticsPanel vehicleId={v.id} canWrite={p.write} canEdit={p.edit} /></TabPanel>
      <TabPanel id="inspections" active={tab === "inspections"}><InspectionsPanel vehicleId={v.id} canWrite={p.write} /></TabPanel>
      <TabPanel id="details" active={tab === "details"}>
        <Card><CardHeader title="Vehicle details" description="Everything is editable. Values you change are marked as confirmed and never overwritten by VIN decoding." /><CardBody>
          <VehicleForm mode="edit" vehicleId={v.id} confirmedFields={v.specification?.confirmedFields ?? []} defaults={{ nickname: v.nickname, make: v.make, model: v.model, year: v.year, trim: v.trim ?? "", generation: v.generation ?? "", engineType: v.engineType ?? "", engineDisplacementL: v.engineDisplacementL ?? "", engineCode: v.engineCode ?? "", fuelType: v.fuelType, transmission: v.transmission ?? "", drivetrain: v.drivetrain ?? "", vin: v.vin ?? "", registrationNumber: v.registrationNumber ?? "", colour: v.colour ?? "", bodyType: v.bodyType ?? "", market: v.market ?? "", purchaseDate: v.purchaseDate ?? "", purchasePrice: v.purchasePrice, purchaseOdometerKm: v.purchaseOdometerKm, ownershipStatus: v.ownershipStatus, currency: v.currency, insuranceProvider: v.insuranceProvider ?? "", insurancePolicyNumber: v.insurancePolicyNumber ?? "", insuranceRenewalDate: v.insuranceRenewalDate ?? "", registrationExpiryDate: v.registrationExpiryDate ?? "", nextInspectionDate: v.nextInspectionDate ?? "", notes: v.notes ?? "" }} onSaved={() => { toast({ title: "Vehicle updated" }); void qc.invalidateQueries(); changeTab("overview"); }} />
          <div className="mt-6 flex justify-end border-t border-border pt-4"><Button type="submit" form="vehicle-form">Save changes</Button></div>
        </CardBody></Card>
      </TabPanel>
      <TabPanel id="access" active={tab === "access"}><AccessPanel v={v} /></TabPanel>
    </div>
  );
}
