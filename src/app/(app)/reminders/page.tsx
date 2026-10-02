"use client";
import * as React from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, CalendarClock, Check, Plus, Trash2, X } from "lucide-react";
import { Controller } from "react-hook-form";
import { api, qs } from "@/lib/client/api";
import { reminderSchema } from "@/lib/validation";
import { Alert, Badge, Button, Card, CardBody, CardHeader, Field, Input, PageHeader, Select, Skeleton, Textarea } from "@/components/ui/primitives";
import { EmptyState } from "@/components/ui/empty";
import { Modal, useConfirm } from "@/components/ui/dialog";
import { Tabs } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import { DistanceInput, applyApiErrors, useZodForm } from "@/components/forms";
import { VehicleSelect, useDefaultVehicleId } from "@/components/forms/common";
import { BASIS_LABEL } from "@/components/ui/status";
import { useFormat, useSelectedVehicle, useVehicles } from "@/components/shell/providers";
import { cn } from "@/lib/client/utils";

export default function RemindersPage() {
  const [tab, setTab] = React.useState("upcoming");
  React.useEffect(() => { if (location.hash === "#notifications") setTab("notifications"); }, []);
  return (
    <>
      <PageHeader title="Reminders" description="Everything due or coming due — maintenance, registration, insurance, warranties and your own reminders. Notifications are generated in the background, even when you're not using the app." actions={<Link href="/settings?tab=notifications"><Button variant="outline" size="sm">Notification settings</Button></Link>} />
      <Tabs label="Reminder views" value={tab} onChange={setTab} tabs={[{ key: "upcoming", label: "Upcoming & overdue" }, { key: "custom", label: "My reminders" }, { key: "notifications", label: "Notifications" }]} />
      <div className="pt-4">{tab === "upcoming" ? <Upcoming /> : tab === "custom" ? <Custom /> : <Inbox />}</div>
    </>
  );
}

function Upcoming() {
  const { vehicleId } = useSelectedVehicle();
  const { data, isLoading } = useQuery({ queryKey: ["upcoming", vehicleId], queryFn: () => api<any[]>(`/api/reminders/upcoming${qs({ vehicleId, horizonDays: 180 })}`) });
  if (isLoading) return <Skeleton className="h-48" />;
  if (!data?.length) return <EmptyState icon={<CalendarClock className="h-6 w-6" />} title="All configured schedules are currently up to date" description="Nothing is due or coming up. Record when items were last done so due dates can be calculated." action={<Link href="/maintenance"><Button variant="outline">Review maintenance schedules</Button></Link>} />;
  const groups = [["overdue", "Overdue"], ["due", "Due now"], ["soon", "Due soon"], ["upcoming", "Coming up"]] as const;
  return (
    <div className="space-y-5">
      {groups.map(([k, title]) => {
        const items = data.filter((d) => d.state === k);
        if (!items.length) return null;
        return (
          <section key={k} aria-label={title}>
            <h2 className="mb-2 text-sm font-semibold text-muted-foreground">{title} ({items.length})</h2>
            <ul className="space-y-2">{items.map((u) => (
              <li key={u.key}><Card><CardBody className="flex flex-wrap items-center justify-between gap-3 !py-3">
                <div className="min-w-0"><p className="font-medium">{u.title}</p><p className="text-sm text-muted-foreground">{u.vehicleName} · {u.summary}</p>{u.basis?.length > 0 && <p className="text-[11px] text-muted-foreground">Based on: {u.basis.map((b: string) => BASIS_LABEL[b]).join(" + ")}</p>}</div>
                <div className="flex items-center gap-2"><Badge tone={k === "overdue" ? "danger" : k === "upcoming" ? "info" : "warning"}>{title}</Badge><Link href={u.actionUrl}><Button size="sm" variant={u.kind === "maintenance" ? "primary" : "outline"}>{u.kind === "maintenance" ? "Record service" : "Open"}</Button></Link></div>
              </CardBody></Card></li>
            ))}</ul>
          </section>
        );
      })}
    </div>
  );
}

function Custom() {
  const f = useFormat();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { vehicleId } = useSelectedVehicle();
  const { data, isLoading } = useQuery({ queryKey: ["reminders", vehicleId], queryFn: () => api<any[]>(`/api/reminders${qs({ vehicleId })}`) });
  const { data: vehicles } = useVehicles();
  const [adding, setAdding] = React.useState(false);
  const canAdd = (vehicles ?? []).some((v) => v.canWrite);
  return (
    <div className="space-y-3">
      {canAdd && <div className="flex justify-end"><Button size="sm" onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> New reminder</Button></div>}
      {isLoading ? <Skeleton className="h-24" /> : !data?.length ? <EmptyState icon={<Bell className="h-6 w-6" />} title="No custom reminders" description="Create reminders by date or odometer — e.g. swap to winter tires, renew a permit, or check tire pressure at 150,000 km." action={canAdd ? <Button onClick={() => setAdding(true)}>Create a reminder</Button> : undefined} /> : (
        <ul className="space-y-2">{data.map((r) => (
          <li key={r.id}><Card><CardBody className="flex flex-wrap items-center justify-between gap-2 !py-3">
            <div><p className="font-medium">{r.title}</p><p className="text-xs text-muted-foreground">{r.vehicleName} · {[r.dueDate && `on ${f.date(r.dueDate)}`, r.dueKm != null && `at ${f.distance(r.dueKm)}`].filter(Boolean).join(" or ")}</p>{r.notes && <p className="text-xs text-muted-foreground">{r.notes}</p>}</div>
            <div className="flex gap-1"><Button size="sm" variant="outline" onClick={async () => { await api(`/api/reminders/${r.id}`, { method: "PATCH", body: { status: "DONE" } }); void qc.invalidateQueries(); }}><Check className="h-4 w-4" /> Done</Button><Button size="icon" variant="ghost" aria-label="Delete reminder" onClick={async () => { if (await confirm({ title: "Delete this reminder?", confirmLabel: "Delete" })) { await api(`/api/reminders/${r.id}`, { method: "DELETE" }); void qc.invalidateQueries(); } }}><Trash2 className="h-4 w-4" /></Button></div>
          </CardBody></Card></li>
        ))}</ul>
      )}
      {adding && <ReminderDialog onClose={() => setAdding(false)} />}
    </div>
  );
}

function ReminderDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const def = useDefaultVehicleId();
  const form = useZodForm(reminderSchema, { vehicleId: def, type: "CUSTOM", leadDays: [7, 1], leadKm: [] });
  const [err, setErr] = React.useState("");
  React.useEffect(() => { if (!form.getValues("vehicleId") && def) form.setValue("vehicleId", def); }, [def, form]);
  const submit = form.handleSubmit(async (v) => { try { await api("/api/reminders", { method: "POST", body: v }); toast({ title: "Reminder created" }); void qc.invalidateQueries(); onClose(); } catch (e) { setErr(applyApiErrors(form, e)); } });
  const e = (k: string) => form.formState.errors[k]?.message as string | undefined;
  return (
    <Modal open onClose={onClose} title="New reminder" footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" form="reminder-form">Create</Button></>}>
      <form id="reminder-form" onSubmit={submit} className="space-y-3" noValidate>
        {err && <Alert tone="danger">{err}</Alert>}
        <Field label="Vehicle" error={e("vehicleId")} required>{(p) => <Controller control={form.control} name="vehicleId" render={({ field }) => <VehicleSelect {...p} value={field.value} onChange={field.onChange} />} />}</Field>
        <Field label="Title" error={e("title")} required>{(p) => <Input {...p} {...form.register("title")} placeholder="e.g. Swap to winter tires" />}</Field>
        <div className="grid grid-cols-2 gap-3"><Field label="Due date" error={e("dueDate")}>{(p) => <Input type="date" {...p} {...form.register("dueDate")} />}</Field><Field label="Or at odometer">{(p) => <Controller control={form.control} name="dueKm" render={({ field }) => <DistanceInput {...p} value={field.value} onChange={field.onChange} />} />}</Field></div>
        <Field label="Notify me (days before)" hint="Comma-separated, e.g. 14, 7, 1">{(p) => <Input {...p} defaultValue="7, 1" onChange={(ev) => form.setValue("leadDays", ev.target.value.split(",").map((x) => parseInt(x)).filter((x) => !isNaN(x)))} />}</Field>
        <Field label="Notes">{(p) => <Textarea rows={2} {...p} {...form.register("notes")} />}</Field>
      </form>
    </Modal>
  );
}

function Inbox() {
  const qc = useQueryClient();
  const router = React.useMemo(() => ({ push: (u: string) => (window.location.href = u) }), []);
  const [unreadOnly, setUnread] = React.useState(false);
  const { data, isLoading } = useQuery({ queryKey: ["notifications", "inbox", unreadOnly], queryFn: () => api<any>(`/api/notifications${qs({ unread: unreadOnly ? "true" : undefined, pageSize: 50 })}`) });
  const act = async (ids: string[], action: string) => { await api("/api/notifications", { method: "PATCH", body: { ids, action } }); void qc.invalidateQueries({ queryKey: ["notifications"] }); };
  return (
    <div className="space-y-3" id="notifications">
      <div className="flex items-center gap-3"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={unreadOnly} onChange={(e) => setUnread(e.target.checked)} /> Unread only</label>{data?.unread > 0 && <Button size="sm" variant="outline" onClick={async () => { await api("/api/notifications", { method: "PATCH", body: { all: true, action: "read" } }); void qc.invalidateQueries({ queryKey: ["notifications"] }); }}>Mark all read</Button>}</div>
      {isLoading ? <Skeleton className="h-32" /> : !data?.items.length ? <EmptyState icon={<Bell className="h-6 w-6" />} title="No notifications" description="You'll be notified when maintenance approaches its due point, warranties or registrations near expiry, and when budgets are close to their limit." /> : (
        <ul className="space-y-2">{data.items.map((n: any) => (
          <li key={n.id}><Card className={cn(!n.read && "border-primary/40")}><CardBody className="flex flex-wrap items-start justify-between gap-3 !py-3">
            <div className="min-w-0"><p className="flex items-center gap-2 font-medium"><span className={cn("h-2 w-2 rounded-full", n.severity === "CRITICAL" ? "bg-danger" : n.severity === "WARNING" ? "bg-warning" : "bg-info")} aria-hidden />{n.title}</p><p className="text-sm text-muted-foreground">{n.body}</p><p className="mt-1 text-[11px] text-muted-foreground">{new Date(n.createdAt).toLocaleString()} · delivered: in-app{n.delivery.email ? ", email" : ""}{n.delivery.push ? ", push" : ""}{n.actioned ? " · actioned" : n.read ? " · read" : ""}</p></div>
            <div className="flex gap-1">{n.actionUrl && <Button size="sm" onClick={async () => { await act([n.id], "actioned"); router.push(n.actionUrl); }}>Open</Button>}{!n.read && <Button size="sm" variant="outline" onClick={() => act([n.id], "read")}>Mark read</Button>}<Button size="icon" variant="ghost" aria-label="Dismiss" onClick={() => act([n.id], "dismiss")}><X className="h-4 w-4" /></Button></div>
          </CardBody></Card></li>
        ))}</ul>
      )}
    </div>
  );
}
