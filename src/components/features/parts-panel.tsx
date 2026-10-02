"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Controller } from "react-hook-form";
import { Package, Plus, Repeat, Trash2, Paperclip } from "lucide-react";
import { api, qs } from "@/lib/client/api";
import { partSchema, replacePartSchema } from "@/lib/validation";
import { today, titleCase } from "@/lib/client/utils";
import { Alert, Badge, Button, Card, CardBody, Field, Input, Select, Skeleton, Textarea } from "@/components/ui/primitives";
import { EmptyState } from "@/components/ui/empty";
import { Modal, useConfirm } from "@/components/ui/dialog";
import { Tabs } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import { DistanceInput, MoneyInput, applyApiErrors, useZodForm } from "@/components/forms";
import { useQuickAdd } from "@/components/forms/quick-dialogs";
import { VehicleSelect, label, useCategories, useDefaultVehicleId } from "@/components/forms/common";
import { useFormat } from "@/components/shell/providers";

const STATUS_TONE: Record<string, any> = { INSTALLED: "success", IN_STORAGE: "info", REMOVED: "neutral", REPLACED: "neutral", RETURNED: "neutral", UNDER_WARRANTY: "primary" };

export function PartsPanel({ vehicleId, openId, canWrite = true }: { vehicleId?: string; openId?: string | null; canWrite?: boolean }) {
  const f = useFormat();
  const [view, setView] = React.useState("inventory");
  const [status, setStatus] = React.useState("");
  const [text, setText] = React.useState("");
  const [detail, setDetail] = React.useState<string | null>(openId ?? null);
  const [adding, setAdding] = React.useState(false);
  const [replacing, setReplacing] = React.useState(false);
  React.useEffect(() => setDetail(openId ?? null), [openId]);
  const single = vehicleId && vehicleId !== "all";
  const params = { vehicleId, status, q: text, pageSize: 100 };
  const { data, isLoading } = useQuery({ queryKey: ["parts", params], queryFn: () => api<any>(`/api/parts${qs(params)}`) });
  const hist = useQuery({ queryKey: ["components", vehicleId], queryFn: () => api<any[]>(`/api/parts/components?vehicleId=${vehicleId}`), enabled: view === "history" && !!single });
  return (
    <div className="space-y-4">
      <Tabs label="Parts views" value={view} onChange={setView} tabs={[{ key: "inventory", label: "Inventory" }, { key: "history", label: "Component history" }]} />
      <div className="flex flex-wrap items-center gap-2">
        {view === "inventory" && <>
          <Select aria-label="Status" className="h-9 w-auto" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Any status</option>{["INSTALLED", "IN_STORAGE", "REMOVED", "REPLACED", "RETURNED", "UNDER_WARRANTY"].map((s) => <option key={s} value={s}>{label(s)}</option>)}</Select>
          <Input type="search" aria-label="Search parts" placeholder="Search name, manufacturer, part #…" className="h-9 w-60" value={text} onChange={(e) => setText(e.target.value)} />
        </>}
        {canWrite && <div className="ml-auto flex gap-2"><Button size="sm" variant="outline" onClick={() => setReplacing(true)}><Repeat className="h-4 w-4" /> Replace component</Button><Button size="sm" onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> Add part</Button></div>}
      </div>
      {view === "inventory" ? (
        isLoading ? <Skeleton className="h-40" /> : !data?.items.length ? <EmptyState icon={<Package className="h-6 w-6" />} title="No parts tracked" description="Track installed and spare parts, their warranties and replacement history. Parts are also created automatically when you tick “Track this part” on a service." action={canWrite ? <Button onClick={() => setAdding(true)}>Add a part</Button> : undefined} /> : (
          <ul className="grid gap-2 md:grid-cols-2">
            {data.items.map((p: any) => (
              <li key={p.id}><button className="w-full text-left" onClick={() => setDetail(p.id)}><Card className="h-full transition-colors hover:border-primary/50"><CardBody className="!py-3">
                <div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="font-medium">{p.name}</p><p className="text-xs text-muted-foreground">{!single && `${p.vehicleName} · `}{[p.manufacturer, p.partNumber && `#${p.partNumber}`, p.origin !== "UNKNOWN" && p.origin].filter(Boolean).join(" · ")}</p></div><Badge tone={STATUS_TONE[p.status]}>{label(p.status)}</Badge></div>
                <p className="mt-1.5 text-xs text-muted-foreground">{p.installedAt ? `Installed ${f.date(p.installedAt)}${p.installedKm != null ? ` at ${f.distance(p.installedKm)}` : ""}` : "Not installed"}{p.purchasePrice != null ? ` · ${f.money(p.purchasePrice, p.currency)}` : ""}</p>
                {p.warrantyEnd && <p className="mt-1"><Badge tone={p.warrantyStatus === "expired" ? "danger" : p.warrantyStatus === "expiring" ? "warning" : "success"}>Warranty {p.warrantyStatus === "expired" ? "expired" : `to ${f.date(p.warrantyEnd)}`}</Badge></p>}
              </CardBody></Card></button></li>
            ))}
          </ul>
        )
      ) : !single ? <Alert tone="info">Select a specific vehicle in the top bar to see its component history.</Alert> : hist.isLoading ? <Skeleton className="h-40" /> : !hist.data?.length ? <EmptyState title="No component history yet" description="Replacements appear here as you track parts." /> : (
        <div className="space-y-3">{hist.data.map((g: any) => (
          <Card key={g.componentKey}><CardBody>
            <div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">{titleCase(g.componentKey)}</h3><Badge>{g.installations.length} installation{g.installations.length > 1 ? "s" : ""}</Badge>{g.replacements > 0 && <Badge tone={g.replacements >= 3 ? "warning" : "neutral"}>{g.replacements} replacement{g.replacements > 1 ? "s" : ""}</Badge>}</div>
            <ol className="mt-3 space-y-2 border-l border-border pl-4">{g.installations.map((i: any) => (
              <li key={i.installationId} className="relative"><span className={`absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full ${i.removedAt ? "bg-muted-foreground" : "bg-success"}`} aria-hidden />
                <p className="text-sm font-medium">{i.partName}{i.manufacturer ? ` · ${i.manufacturer}` : ""}{i.partNumber ? ` · #${i.partNumber}` : ""}</p>
                <p className="text-xs text-muted-foreground">Installed {f.date(i.installedAt)}{i.installedKm != null ? ` at ${f.distance(i.installedKm)}` : ""} → {i.removedAt ? `removed ${f.date(i.removedAt)}${i.removedKm != null ? ` at ${f.distance(i.removedKm)}` : ""}` : "still in service"}{i.kmInService != null ? ` · ${f.distance(i.kmInService)} in service` : ""}{i.removalReason && i.removedAt ? ` · ${i.removalReason}` : ""}{i.purchasePrice != null ? ` · ${f.money(i.purchasePrice)}` : ""}</p></li>
            ))}</ol>
          </CardBody></Card>
        ))}</div>
      )}
      {detail && <PartDetail id={detail} canWrite={canWrite} onClose={() => setDetail(null)} />}
      {adding && <PartDialog vehicleId={vehicleId} onClose={() => setAdding(false)} />}
      {replacing && <ReplaceDialog vehicleId={vehicleId} onClose={() => setReplacing(false)} />}
    </div>
  );
}

function PartDetail({ id, onClose, canWrite }: { id: string; onClose: () => void; canWrite: boolean }) {
  const f = useFormat();
  const qc = useQueryClient();
  const router = useRouter();
  const { toast } = useToast();
  const confirm = useConfirm();
  const { open } = useQuickAdd();
  const { data: p, isLoading } = useQuery({ queryKey: ["part", id], queryFn: () => api<any>(`/api/parts/${id}`) });
  const setStatus = async (s: string) => { await api(`/api/parts/${id}`, { method: "PATCH", body: { status: s } }); toast({ title: `Marked ${label(s).toLowerCase()}` }); void qc.invalidateQueries(); };
  const close = () => { onClose(); if (location.search.includes("part=")) router.replace(location.pathname); };
  return (
    <Modal open onClose={close} title={p?.name ?? "Part"} description={p?.vehicleName} footer={p && canWrite ? <><Button variant="danger" onClick={async () => { if (await confirm({ title: "Delete this part?", confirmLabel: "Delete" })) { await api(`/api/parts/${id}`, { method: "DELETE" }); void qc.invalidateQueries(); close(); } }}><Trash2 className="h-4 w-4" /></Button><Button variant="outline" onClick={() => open("upload", { vehicleId: p.vehicleId, partId: p.id, category: "PART_PHOTO" })}><Paperclip className="h-4 w-4" /> Add photo / receipt</Button></> : undefined}>
      {isLoading || !p ? <Skeleton className="h-40" /> : (
        <div className="space-y-4 text-sm">
          {canWrite && <Field label="Status">{(x) => <Select {...x} value={p.status} onChange={(e) => setStatus(e.target.value)}>{["INSTALLED", "IN_STORAGE", "REMOVED", "REPLACED", "RETURNED", "UNDER_WARRANTY"].map((s) => <option key={s} value={s}>{label(s)}</option>)}</Select>}</Field>}
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">{[["Manufacturer", p.manufacturer], ["Part number", p.partNumber], ["OEM / aftermarket", p.origin !== "UNKNOWN" ? p.origin : null], ["Supplier", p.supplier], ["Purchased", p.purchaseDate && f.date(p.purchaseDate)], ["Price", p.purchasePrice != null ? f.money(p.purchasePrice, p.currency) : null], ["Warranty", p.warrantyEnd && `${p.warrantyStart ? f.date(p.warrantyStart) + " → " : "until "}${f.date(p.warrantyEnd)}`], ["Expected life", [p.expectedLifeKm != null && f.distance(p.expectedLifeKm), p.expectedLifeMonths && `${p.expectedLifeMonths} mo`].filter(Boolean).join(" / ")]].filter(([, v]) => v).map(([k, v]) => <div key={k as string}><dt className="text-xs text-muted-foreground">{k}</dt><dd className="font-medium">{v}</dd></div>)}</dl>
          <div><h3 className="mb-1 font-semibold">Installation history</h3>{p.installations.length === 0 ? <p className="text-muted-foreground">Never installed.</p> : <ul className="space-y-1">{p.installations.map((i: any) => <li key={i.id} className="text-muted-foreground">Installed {f.date(i.installedAt)}{i.installedKm != null ? ` at ${f.distance(i.installedKm)}` : ""} → {i.removedAt ? `removed ${f.date(i.removedAt)}${i.removedKm != null ? ` at ${f.distance(i.removedKm)}` : ""}` : "in service"}</li>)}</ul>}</div>
          {p.notes && <p className="text-muted-foreground">{p.notes}</p>}
          {p.documents.length > 0 && <div className="flex flex-wrap gap-2">{p.documents.map((d: any) => d.mimeType.startsWith("image/") ? <a key={d.id} href={`/api/documents/${d.id}/file`} target="_blank" rel="noreferrer"><img src={`/api/documents/${d.id}/file`} alt={d.title} className="h-20 w-20 rounded-md border border-border object-cover" /></a> : <a key={d.id} className="text-primary hover:underline" href={`/api/documents/${d.id}/file`} target="_blank" rel="noreferrer">{d.title}</a>)}</div>}
        </div>
      )}
    </Modal>
  );
}

function PartFields({ form, err, prefix = "" }: { form: any; err: (k: string) => string | undefined; prefix?: string }) {
  const n = (k: string) => (prefix ? `${prefix}.${k}` : k);
  const { data: cats } = useCategories();
  return (
    <>
      <Field label="Part name" error={err("name")} required>{(p) => <Input {...p} {...form.register(n("name"))} />}</Field>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Manufacturer">{(p) => <Input {...p} {...form.register(n("manufacturer"))} />}</Field>
        <Field label="Part number">{(p) => <Input {...p} {...form.register(n("partNumber"))} />}</Field>
        <Field label="OEM / aftermarket">{(p) => <Select {...p} {...form.register(n("origin"))}><option value="UNKNOWN">Unknown</option><option value="OEM">OEM</option><option value="AFTERMARKET">Aftermarket</option></Select>}</Field>
        <Field label="Category">{(p) => <Select {...p} {...form.register(n("categoryId"))}><option value="">n/a</option>{cats?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>}</Field>
        <Field label="Supplier">{(p) => <Input {...p} {...form.register(n("supplier"))} />}</Field>
        <Field label="Purchase date">{(p) => <Input type="date" {...p} {...form.register(n("purchaseDate"))} />}</Field>
        <Field label="Purchase price">{(p) => <Controller control={form.control} name={n("purchasePrice")} render={({ field }) => <MoneyInput {...p} value={field.value} onChange={field.onChange} />} />}</Field>
        <Field label="Warranty start">{(p) => <Input type="date" {...p} {...form.register(n("warrantyStart"))} />}</Field>
        <Field label="Warranty expiry">{(p) => <Input type="date" {...p} {...form.register(n("warrantyEnd"))} />}</Field>
        <Field label="Expected life (distance)">{(p) => <Controller control={form.control} name={n("expectedLifeKm")} render={({ field }) => <DistanceInput {...p} value={field.value} onChange={field.onChange} />} />}</Field>
        <Field label="Expected life (months)">{(p) => <Input type="number" {...p} {...form.register(n("expectedLifeMonths"))} />}</Field>
      </div>
    </>
  );
}

function PartDialog({ vehicleId, onClose }: { vehicleId?: string; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const def = useDefaultVehicleId(vehicleId !== "all" ? vehicleId : undefined);
  const form = useZodForm(partSchema, { vehicleId: def, status: "IN_STORAGE", origin: "UNKNOWN", installedAt: today() });
  const [err, setErr] = React.useState("");
  React.useEffect(() => { if (!form.getValues("vehicleId") && def) form.setValue("vehicleId", def); }, [def, form]);
  const status = form.watch("status");
  const installed = status === "INSTALLED" || status === "UNDER_WARRANTY";
  const submit = form.handleSubmit(async (v) => { try { await api("/api/parts", { method: "POST", body: v }); toast({ title: "Part added" }); void qc.invalidateQueries(); onClose(); } catch (e) { setErr(applyApiErrors(form, e)); } });
  const e = (k: string) => form.formState.errors[k]?.message as string | undefined;
  return (
    <Modal open onClose={onClose} size="lg" title="Add part" footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" form="part-form" loading={form.formState.isSubmitting}>Save part</Button></>}>
      <form id="part-form" onSubmit={submit} className="space-y-3" noValidate>
        {err && <Alert tone="danger">{err}</Alert>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Vehicle" error={e("vehicleId")} required>{(p) => <Controller control={form.control} name="vehicleId" render={({ field }) => <VehicleSelect {...p} value={field.value} onChange={field.onChange} />} />}</Field>
          <Field label="Status">{(p) => <Select {...p} {...form.register("status")}>{["IN_STORAGE", "INSTALLED", "UNDER_WARRANTY", "REMOVED", "REPLACED", "RETURNED"].map((s) => <option key={s} value={s}>{label(s)}</option>)}</Select>}</Field>
        </div>
        <PartFields form={form} err={e} />
        {installed && <div className="grid gap-3 sm:grid-cols-3 rounded-lg border border-border p-3"><Field label="Component" hint="Groups its replacement history (e.g. battery)">{(p) => <Input {...p} {...form.register("componentKey")} />}</Field><Field label="Installed on">{(p) => <Input type="date" {...p} {...form.register("installedAt")} />}</Field><Field label="Installed at odometer">{(p) => <Controller control={form.control} name="installedKm" render={({ field }) => <DistanceInput {...p} value={field.value} onChange={field.onChange} />} />}</Field></div>}
        <Field label="Notes">{(p) => <Textarea rows={2} {...p} {...form.register("notes")} />}</Field>
      </form>
    </Modal>
  );
}

function ReplaceDialog({ vehicleId, onClose }: { vehicleId?: string; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const def = useDefaultVehicleId(vehicleId !== "all" ? vehicleId : undefined);
  const form = useZodForm(replacePartSchema, { vehicleId: def, installedAt: today(), part: { origin: "UNKNOWN" } });
  const vid = form.watch("vehicleId") as string;
  const { data: comps } = useQuery({ queryKey: ["components", vid], queryFn: () => api<any[]>(`/api/parts/components?vehicleId=${vid}`), enabled: !!vid });
  const [err, setErr] = React.useState("");
  React.useEffect(() => { if (!form.getValues("vehicleId") && def) form.setValue("vehicleId", def); }, [def, form]);
  const submit = form.handleSubmit(async (v) => { try { await api("/api/parts/replace", { method: "POST", body: v }); toast({ title: "Component replaced - previous installation closed" }); void qc.invalidateQueries(); onClose(); } catch (e) { setErr(applyApiErrors(form, e)); } });
  const e = (k: string) => form.formState.errors[k]?.message as string | undefined;
  return (
    <Modal open onClose={onClose} size="lg" title="Replace a component" description="Closes the previous installation period at the new part's install date and odometer." footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" form="replace-form" loading={form.formState.isSubmitting}>Record replacement</Button></>}>
      <form id="replace-form" onSubmit={submit} className="space-y-3" noValidate>
        {err && <Alert tone="danger">{err}</Alert>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Vehicle" error={e("vehicleId")} required>{(p) => <Controller control={form.control} name="vehicleId" render={({ field }) => <VehicleSelect {...p} value={field.value} onChange={field.onChange} />} />}</Field>
          <Field label="Component" error={e("componentKey")} hint="Pick an existing one or type a new key, e.g. front_brake_pads" required>{(p) => <><Input {...p} list="component-list" {...form.register("componentKey")} /><datalist id="component-list">{comps?.map((c) => <option key={c.componentKey} value={c.componentKey} />)}</datalist></>}</Field>
          <Field label="Installed on" required>{(p) => <Input type="date" max={today()} {...p} {...form.register("installedAt")} />}</Field>
          <Field label="Odometer at install">{(p) => <Controller control={form.control} name="installedKm" render={({ field }) => <DistanceInput {...p} value={field.value} onChange={field.onChange} />} />}</Field>
          <Field label="Why was the old one replaced?">{(p) => <Input {...p} {...form.register("removalReason")} />}</Field>
          <Field label="Installation labour">{(p) => <Controller control={form.control} name="installLaborCost" render={({ field }) => <MoneyInput {...p} value={field.value} onChange={field.onChange} />} />}</Field>
        </div>
        <p className="text-sm font-medium">New part</p>
        <PartFields form={form} prefix="part" err={(k) => (form.formState.errors.part as any)?.[k]?.message} />
      </form>
    </Modal>
  );
}
