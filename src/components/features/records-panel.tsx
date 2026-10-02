"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardList, Download, FileText, Pencil, Plus, Trash2, Paperclip, Wrench } from "lucide-react";
import { api, qs } from "@/lib/client/api";
import { Badge, Button, Card, CardBody, Input, Select, Skeleton } from "@/components/ui/primitives";
import { EmptyState } from "@/components/ui/empty";
import { Modal, useConfirm } from "@/components/ui/dialog";
import { RecordStatusBadge } from "@/components/ui/status";
import { Dropdown, MenuItem } from "@/components/ui/menu";
import { useToast } from "@/components/ui/toast";
import { useQuickAdd } from "@/components/forms/quick-dialogs";
import { label, useCategories } from "@/components/forms/common";
import { useFormat, useVehicles } from "@/components/shell/providers";
import { cn } from "@/lib/client/utils";

export function RecordsPanel({ vehicleId, kind, openId, canWrite = true }: { vehicleId?: string; kind?: "MAINTENANCE" | "REPAIR"; openId?: string | null; canWrite?: boolean }) {
  const f = useFormat();
  const { data: cats } = useCategories();
  const { data: vehicles } = useVehicles();
  const [filters, setFilters] = React.useState<Record<string, any>>({ sort: "date_desc", status: "" });
  const [page, setPage] = React.useState(1);
  const [group, setGroup] = React.useState<"none" | "year" | "category">("none");
  const [show, setShow] = React.useState(false);
  const [detail, setDetail] = React.useState<string | null>(openId ?? null);
  React.useEffect(() => setDetail(openId ?? null), [openId]);
  const set = (k: string, v: any) => {
    setFilters((s) => ({ ...s, [k]: v }));
    setPage(1);
  };
  // distance filters are entered in the user's unit and sent as km
  const params = { vehicleId, kind, page, pageSize: 20, ...filters, minKm: filters.minKm ? f.toKm(Number(filters.minKm)) : undefined, maxKm: filters.maxKm ? f.toKm(Number(filters.maxKm)) : undefined };
  const { data, isLoading, isError, error } = useQuery({ queryKey: ["records", params], queryFn: () => api<any>(`/api/maintenance/records${qs(params)}`) });
  const single = vehicleId && vehicleId !== "all";
  const exportUrl = (fmt: string) => `/api/reports/service-history${qs({ vehicleId, format: fmt })}`;

  const groups = React.useMemo(() => {
    const items: any[] = data?.items ?? [];
    if (group === "none") return [{ key: "", items }];
    const m = new Map<string, any[]>();
    for (const r of items) {
      const k = group === "year" ? String(r.serviceDate).slice(0, 4) : r.items[0]?.categoryName ?? r.items[0]?.assignmentName ?? "Uncategorised";
      m.set(k, [...(m.get(k) ?? []), r]);
    }
    return [...m.entries()].map(([key, items]) => ({ key, items }));
  }, [data, group]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input type="search" aria-label="Search records" placeholder="Search services, parts, providers…" className="h-9 w-full sm:w-64" value={filters.q ?? ""} onChange={(e) => set("q", e.target.value)} />
        <Select aria-label="Status" className="h-9 w-auto" value={filters.status} onChange={(e) => set("status", e.target.value)}><option value="">Any status</option>{["COMPLETED", "IN_PROGRESS", "SCHEDULED", "DRAFT", "CANCELLED"].map((s) => <option key={s} value={s}>{label(s)}</option>)}</Select>
        <Select aria-label="Sort" className="h-9 w-auto" value={filters.sort} onChange={(e) => set("sort", e.target.value)}><option value="date_desc">Newest first</option><option value="date_asc">Oldest first</option><option value="cost_desc">Highest cost</option><option value="cost_asc">Lowest cost</option><option value="km_desc">Highest odometer</option><option value="km_asc">Lowest odometer</option></Select>
        <Select aria-label="Group by" className="h-9 w-auto" value={group} onChange={(e) => setGroup(e.target.value as any)}><option value="none">Timeline</option><option value="year">Group by year</option><option value="category">Group by category</option></Select>
        <Button variant="outline" size="sm" onClick={() => setShow((s) => !s)} aria-expanded={show}>More filters</Button>
        <div className="ml-auto flex gap-2">
          {single && (
            <Dropdown label="Export" trigger={(p) => <Button variant="outline" size="sm" {...p}><Download className="h-4 w-4" /> Export</Button>}>
              {(close) => (<><MenuItem href={exportUrl("pdf")} onClick={close}>PDF service history</MenuItem><MenuItem href={exportUrl("csv")} onClick={close}>CSV</MenuItem><MenuItem href={exportUrl("xlsx")} onClick={close}>Excel (.xlsx)</MenuItem><MenuItem href={exportUrl("json")} onClick={close}>JSON</MenuItem><MenuItem href="/reports" onClick={close}>Sharing & privacy options…</MenuItem></>)}
            </Dropdown>
          )}
          {canWrite && <Link href={`/service-history/new${qs({ vehicleId, kind })}`}><Button size="sm"><Plus className="h-4 w-4" /> {kind === "REPAIR" ? "Record repair" : "Log service"}</Button></Link>}
        </div>
      </div>
      {show && (
        <Card><CardBody className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <label className="text-sm">From<Input type="date" value={filters.from ?? ""} onChange={(e) => set("from", e.target.value)} /></label>
          <label className="text-sm">To<Input type="date" value={filters.to ?? ""} onChange={(e) => set("to", e.target.value)} /></label>
          <label className="text-sm">Category<Select value={filters.category ?? ""} onChange={(e) => set("category", e.target.value)}><option value="">Any</option>{cats?.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}</Select></label>
          <label className="text-sm">Min odometer ({f.unitLabel})<Input type="number" value={filters.minKm ?? ""} onChange={(e) => set("minKm", e.target.value)} /></label>
          <label className="text-sm">Max odometer ({f.unitLabel})<Input type="number" value={filters.maxKm ?? ""} onChange={(e) => set("maxKm", e.target.value)} /></label>
          <label className="text-sm">Min cost<Input type="number" value={filters.minCost ?? ""} onChange={(e) => set("minCost", e.target.value)} /></label>
          <label className="text-sm">Max cost<Input type="number" value={filters.maxCost ?? ""} onChange={(e) => set("maxCost", e.target.value)} /></label>
          <label className="text-sm">Done by<Select value={filters.workPerformedBy ?? ""} onChange={(e) => set("workPerformedBy", e.target.value)}><option value="">Anyone</option><option value="OWNER_DIY">Owner / DIY</option><option value="INDEPENDENT_MECHANIC">Independent mechanic</option><option value="DEALERSHIP">Dealership</option><option value="SPECIALIST_WORKSHOP">Specialist</option></Select></label>
          <div className="flex items-end"><Button variant="ghost" size="sm" onClick={() => { setFilters({ sort: "date_desc", status: "" }); setPage(1); }}>Clear filters</Button></div>
        </CardBody></Card>
      )}

      {isLoading ? <Skeleton className="h-48" /> : isError ? <p className="text-danger">{(error as Error).message}</p> : !data?.items.length ? (
        <EmptyState icon={<ClipboardList className="h-6 w-6" />} title={kind === "REPAIR" ? "No repair records yet" : "No service history"} description={Object.values(filters).some((v) => v && v !== "date_desc") ? "No records match these filters." : "Record your first service to build a complete service book."} action={canWrite ? <Link href={`/service-history/new${qs({ vehicleId, kind })}`}><Button>Record your first service</Button></Link> : undefined} />
      ) : (
        <>
          {groups.map((g) => (
            <section key={g.key} aria-label={g.key || "Records"}>
              {g.key && <h3 className="mb-2 mt-4 text-sm font-semibold text-muted-foreground">{g.key}</h3>}
              <ul className="space-y-2">
                {g.items.map((r: any) => (
                  <li key={r.id}>
                    <button onClick={() => setDetail(r.id)} className="w-full rounded-xl text-left">
                      <Card className="transition-colors hover:border-primary/50">
                        <CardBody className="flex flex-wrap items-center gap-x-4 gap-y-1 !py-3">
                          <div className="w-24 shrink-0 text-sm tabular text-muted-foreground">{f.date(r.serviceDate)}</div>
                          <div className="min-w-0 flex-1">
                            <p className="flex flex-wrap items-center gap-2 font-medium">{r.title}{r.kind === "REPAIR" && <Badge tone="warning">Repair</Badge>}{r.status !== "COMPLETED" && <RecordStatusBadge status={r.status} />}</p>
                            <p className="truncate text-xs text-muted-foreground">{!single && `${r.vehicleName} · `}{r.odometerKm !== null ? f.distance(r.odometerKm) : "odometer not recorded"}{r.providerName ? ` · ${r.providerName}` : r.workPerformedBy === "OWNER_DIY" ? " · DIY" : ""}{r.items.length ? ` · ${r.items.map((i: any) => i.name).slice(0, 3).join(", ")}${r.items.length > 3 ? "…" : ""}` : ""}</p>
                          </div>
                          {r.documents.length > 0 && <Paperclip className="h-4 w-4 text-muted-foreground" aria-label={`${r.documents.length} attachment(s)`} />}
                          <div className="w-24 text-right text-sm font-medium tabular">{r.totalCost !== null ? (r.totalCost > 0 ? f.money(r.totalCost, r.currency) : "—") : <span className="text-xs text-muted-foreground">hidden</span>}</div>
                        </CardBody>
                      </Card>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>{data.total} record{data.total === 1 ? "" : "s"}</span>
            <div className="flex items-center gap-2"><Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button><span className="tabular">Page {page} of {Math.max(1, Math.ceil(data.total / data.pageSize))}</span><Button size="sm" variant="outline" disabled={page >= Math.ceil(data.total / data.pageSize)} onClick={() => setPage(page + 1)}>Next</Button></div>
          </div>
        </>
      )}
      {detail && <RecordDetail id={detail} canWrite={canWrite} onClose={() => setDetail(null)} />}
      <span className="hidden">{vehicles?.length}</span>
    </div>
  );
}

export function RecordDetail({ id, onClose, canWrite }: { id: string; onClose: () => void; canWrite: boolean }) {
  const f = useFormat();
  const router = useRouter();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { toast } = useToast();
  const { open } = useQuickAdd();
  const { data: r, isLoading } = useQuery({ queryKey: ["record", id], queryFn: () => api<any>(`/api/maintenance/records/${id}`) });
  const del = async () => {
    if (!(await confirm({ title: "Delete this record?", description: "Its expense, odometer entry and part installations are removed too, and schedules are recalculated.", confirmLabel: "Delete record" }))) return;
    await api(`/api/maintenance/records/${id}`, { method: "DELETE" });
    toast({ title: "Record deleted" });
    void qc.invalidateQueries();
    onClose();
  };
  return (
    <Modal open onClose={() => { onClose(); if (location.search.includes("record=")) router.replace(location.pathname); }} size="lg" title={r?.title ?? "Service record"} description={r ? `${f.date(r.serviceDate)} · ${r.vehicleName}` : undefined}
      footer={r && canWrite ? <><Button variant="danger" onClick={del}><Trash2 className="h-4 w-4" /> Delete</Button><Button variant="outline" onClick={() => open("upload", { vehicleId: r.vehicleId, recordId: r.id, category: r.kind === "REPAIR" ? "REPAIR_RECEIPT" : "MAINTENANCE_INVOICE" })}><Paperclip className="h-4 w-4" /> Attach receipt</Button><Link href={`/service-history/${r.id}`}><Button><Pencil className="h-4 w-4" /> Edit</Button></Link></> : undefined}>
      {isLoading || !r ? <Skeleton className="h-40" /> : (
        <div className="space-y-4 text-sm">
          <div className="flex flex-wrap items-center gap-2"><RecordStatusBadge status={r.status} />{r.kind === "REPAIR" && <Badge tone="warning">Repair</Badge>}<Badge>{r.workPerformedBy === "OWNER_DIY" ? "Owner / DIY" : label(r.workPerformedBy)}</Badge></div>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div><dt className="text-xs text-muted-foreground">Odometer</dt><dd className="font-medium">{r.odometerKm !== null ? f.distance(r.odometerKm) : "Not recorded"}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Provider</dt><dd className="font-medium">{r.providerName ?? r.mechanicName ?? "—"}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Location</dt><dd className="font-medium">{r.location ?? "—"}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Warranty</dt><dd className="font-medium">{r.warrantyInfo ?? "—"}</dd></div>
          </dl>
          {r.description && <p>{r.description}</p>}
          {r.items.length > 0 && (
            <div>
              <h3 className="mb-1 font-semibold">Work performed</h3>
              <ul className="divide-y divide-border rounded-lg border border-border">
                {r.items.map((i: any) => (
                  <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                    <div><p className={cn("font-medium", !i.completed && "text-muted-foreground line-through")}>{i.name}{!i.completed && " (not completed)"}</p>{(i.partName || i.partNumber) && <p className="text-xs text-muted-foreground">{i.quantity}× {i.partName}{i.partManufacturer ? ` · ${i.partManufacturer}` : ""}{i.partNumber ? ` · #${i.partNumber}` : ""}{i.partOrigin ? ` · ${i.partOrigin}` : ""}</p>}</div>
                    {i.trackAsPart && <Badge tone="primary">Tracked part</Badge>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {r.totalCost !== null && (
            <dl className="grid grid-cols-2 gap-2 rounded-lg bg-muted p-3 sm:grid-cols-5">
              {[["Parts", r.partsCost], ["Labour", r.laborCost], ["Tax", r.tax], ["Discount", r.discount], ["Total", r.totalCost]].map(([k, v]) => <div key={k as string}><dt className="text-xs text-muted-foreground">{k}</dt><dd className={cn("font-medium tabular", k === "Total" && "text-base")}>{f.money(v as number, r.currency)}</dd></div>)}
            </dl>
          )}
          {r.notes && <div><h3 className="font-semibold">Notes</h3><p className="text-muted-foreground">{r.notes}</p></div>}
          <div>
            <h3 className="mb-1 font-semibold">Receipts & documents</h3>
            {r.documents.length === 0 ? <p className="text-muted-foreground">No documents attached.</p> : <ul className="space-y-1">{r.documents.map((d: any) => <li key={d.id}><a className="inline-flex items-center gap-1.5 text-primary hover:underline" href={`/api/documents/${d.id}/file`} target="_blank" rel="noreferrer"><FileText className="h-4 w-4" />{d.title}</a></li>)}</ul>}
          </div>
          <p className="flex items-center gap-1 text-xs text-muted-foreground"><Wrench className="h-3 w-3" /> Completed records feed your schedules, mileage and expense analytics.</p>
        </div>
      )}
    </Modal>
  );
}
