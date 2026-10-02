"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/client/api";
import { Alert, Button, Card, CardBody, CardHeader, PageHeader, Skeleton } from "@/components/ui/primitives";
import { VehicleForm } from "@/components/features/vehicle-form";
import { cn } from "@/lib/client/utils";
import { useToast } from "@/components/ui/toast";

export default function NewVehiclePage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: templates, isLoading } = useQuery({ queryKey: ["vehicle-templates"], queryFn: () => api<any[]>("/api/vehicles/templates") });
  const [tpl, setTpl] = React.useState<string>("");
  const t = templates?.find((x) => x.key === tpl);
  return (
    <>
      <PageHeader title="Add a vehicle" description="Start from scratch or from a starter profile. Everything stays editable." />
      <div className="mb-5 grid gap-3 sm:grid-cols-2">
        <button type="button" onClick={() => setTpl("")} aria-pressed={!tpl} className={cn("rounded-xl border p-4 text-left transition-colors", !tpl ? "border-primary bg-primary/5" : "border-border hover:border-primary/40")}>
          <p className="font-medium">Blank vehicle</p><p className="text-sm text-muted-foreground">Enter any vehicle's details yourself.</p>
        </button>
        {isLoading ? <Skeleton className="h-20" /> : templates?.map((x) => (
          <button key={x.key} type="button" onClick={() => setTpl(x.key)} aria-pressed={tpl === x.key} className={cn("rounded-xl border p-4 text-left transition-colors", tpl === x.key ? "border-primary bg-primary/5" : "border-border hover:border-primary/40")}>
            <p className="font-medium">{x.label}</p><p className="text-sm text-muted-foreground">Starter profile · {x.scheduleCount} checklist items, no history pre-filled</p>
          </button>
        ))}
      </div>
      {t && <Alert tone="info" title="About this starter profile" className="mb-5">{t.note}</Alert>}
      <Card>
        <CardHeader title="Vehicle details" />
        <CardBody>
          <VehicleForm key={tpl || "blank"} mode="create" defaults={t ? { ...t.vehicle, templateKey: t.key } : {}} onSaved={(id) => { toast({ title: "Vehicle added" }); void qc.invalidateQueries(); router.push(`/vehicles/${id}`); }} />
          <div className="mt-6 flex justify-end gap-2 border-t border-border pt-4">
            <Button variant="outline" onClick={() => router.push("/vehicles")}>Cancel</Button>
            <Button type="submit" form="vehicle-form">Add vehicle</Button>
          </div>
        </CardBody>
      </Card>
    </>
  );
}
