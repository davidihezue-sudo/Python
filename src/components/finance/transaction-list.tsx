"use client";
import * as React from "react";
import { Download, Filter, X } from "lucide-react";
import { Button, Checkbox, Input, Select } from "@/components/ui/primitives";
import { EmptyState } from "@/components/ui/empty";
import { useFin, useFinMutation, useFinQuery } from "./provider";
import { CategorySelect, DataTable, MemberChip, Money, VisibilityBadge, humanize, useAccounts, useMembers, useVehicleOptions, type Col } from "./ui";
import { TransactionDetail } from "./tx-detail";
import { useTxDialog } from "./transaction-form";

export interface TxFilters { view: string; q: string; types: string; accountId: string; vehicleId: string; tag: string; categoryIds: string; member: string; from: string; to: string; minAmount: string; maxAmount: string; status: string; recurring: string; reconciliation: string; sort: string }
export const emptyFilters = (over: Partial<TxFilters> = {}): TxFilters => ({ view: "all", q: "", types: "", accountId: "", vehicleId: "", tag: "", categoryIds: "", member: "", from: "", to: "", minAmount: "", maxAmount: "", status: "", recurring: "", reconciliation: "", sort: "date_desc", ...over });

export function TransactionList({ initial, lockedTypes, showAdd = true, exportEntity = "transactions", focus }: { initial?: Partial<TxFilters>; lockedTypes?: string; showAdd?: boolean; exportEntity?: string; focus?: string | null }) {
  const { fmt, view: globalView, hid } = useFin();
  const [f, setF] = React.useState<TxFilters>(() => emptyFilters({ view: "all", ...initial }));
  const [page, setPage] = React.useState(1);
  const [open, setOpen] = React.useState<string | null>(focus ?? null);
  const [showFilters, setShowFilters] = React.useState(Object.values(initial ?? {}).some((x) => x && x !== "all"));
  const [picked, setPicked] = React.useState<Set<string>>(new Set());
  const [bulkCat, setBulkCat] = React.useState("");
  const tx = useTxDialog();
  const { accounts } = useAccounts();
  const vehicleOpts = useVehicleOptions();
  const { members } = useMembers();
  const tags = useFinQuery<any[]>("/tags");
  const saved = useFinQuery<any[]>("/saved-views", { kind: "transactions" });
  const saveView = useFinMutation<any, any>("POST", "/saved-views", { success: "Filter saved" });
  const delView = useFinMutation<any, any>("DELETE", (b) => `/saved-views/${b.id}`, { success: "Saved filter removed" });
  const [savedPick, setSavedPick] = React.useState("");
  const set = (k: keyof TxFilters, v: string) => { setF((s) => ({ ...s, [k]: v })); setPage(1); };
  const params: Record<string, string | number> = { page, pageSize: 40, sort: f.sort };
  for (const [k, v] of Object.entries(f)) if (v && k !== "sort") params[k] = v;
  if (lockedTypes) params.types = lockedTypes;
  const { data, isLoading, isFetching } = useFinQuery<any>("/transactions", params);
  const bulk = useFinMutation<any, any>("POST", "/transactions/bulk", { success: "Updated", onSuccess: () => setPicked(new Set()) });
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const exportHref = `/api/finance/${hid}/export/${exportEntity}?view=${f.view === "all" ? globalView : f.view}${f.from ? `&from=${f.from}` : ""}${f.to ? `&to=${f.to}` : ""}&format=csv`;
  const cols: Col<any>[] = [
    { key: "pick", header: "", className: "w-8", hideOnMobile: true, cell: (r) => <span onClick={(e) => e.stopPropagation()}><Checkbox aria-label={`Select ${r.description}`} checked={picked.has(r.id)} disabled={!r.canEdit || r.type === "TRANSFER"} onChange={(e) => setPicked((s) => { const n = new Set(s); if (e.target.checked) n.add(r.id); else n.delete(r.id); return n; })} /></span> },
    { key: "date", header: "Date", cell: (r) => <span className="whitespace-nowrap text-muted-foreground">{fmt.date(r.date)}</span> },
    { key: "desc", header: "Description", primary: true, cell: (r) => <span className="flex min-w-0 flex-col"><span className="truncate font-medium">{r.description}{r.status === "PLANNED" ? " (expected)" : ""}</span>{r.tags?.length > 0 && <span className="flex flex-wrap gap-1">{r.tags.map((t: string) => <span key={t} className="rounded bg-muted px-1.5 text-[11px] text-muted-foreground">#{t}</span>)}</span>}{r.merchant && r.merchant !== r.description && <span className="truncate text-xs text-muted-foreground">{r.merchant}</span>}</span> },
    { key: "cat", header: "Category", cell: (r) => <span className="text-muted-foreground">{r.type === "TRANSFER" ? "Transfer" : r.categoryName ?? humanize(r.type)}</span> },
    { key: "acct", header: "Account", hideOnMobile: true, cell: (r) => <span className="text-muted-foreground">{r.accountName}</span> },
    { key: "owner", header: "Owner", cell: (r) => <MemberChip member={r.owner} /> },
    { key: "payer", header: "Paid by", hideOnMobile: true, cell: (r) => (r.type === "INCOME" || r.type === "TRANSFER" ? <span className="text-muted-foreground">n/a</span> : r.paidByHousehold ? <span className="text-muted-foreground">Household</span> : <MemberChip member={r.payer} />) },
    { key: "share", header: "Sharing", hideOnMobile: true, cell: (r) => <VisibilityBadge visibility={r.visibility} /> },
    { key: "amt", header: "Amount", align: "right", cell: (r) => <Money value={r.amount} delta={r.type !== "TRANSFER" && r.type !== "ADJUSTMENT"} /> },
  ];
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input aria-label="Search transactions" type="search" value={f.q} onChange={(e) => set("q", e.target.value)} placeholder="Search description, merchant or notes" className="h-9 max-w-xs flex-1" />
        <Select aria-label="Whose transactions" value={f.view} onChange={(e) => set("view", e.target.value)} className="h-9 w-auto"><option value="all">Everything I can see</option><option value="my">Mine</option><option value="household">Shared with the household</option></Select>
        <Button variant="outline" size="sm" onClick={() => setShowFilters((s) => !s)} aria-expanded={showFilters}><Filter className="h-4 w-4" /> Filters</Button>
        {(saved.data?.length ?? 0) > 0 && <Select aria-label="Saved filters" value={savedPick} onChange={(e) => { const v = saved.data!.find((x) => x.id === e.target.value); setSavedPick(e.target.value); if (v) { setF(emptyFilters({ ...v.params })); setPage(1); setShowFilters(true); } }} className="h-9 w-auto"><option value="">Saved filters</option>{saved.data!.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select>}
        {savedPick && <Button variant="ghost" size="sm" onClick={() => { delView.mutate({ id: savedPick }); setSavedPick(""); }}>Delete saved filter</Button>}
        <Button variant="outline" size="sm" onClick={() => { const name = window.prompt("Name this filter"); if (name?.trim()) { const p: Record<string, string> = {}; for (const [k, v] of Object.entries(f)) if (v && k !== "sort" && !(k === "view" && v === "all")) p[k] = v; saveView.mutate({ name: name.trim(), kind: "transactions", params: p }); } }}>Save filter</Button>
        <a href={exportHref} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-input bg-card px-3 text-sm font-medium hover:bg-muted"><Download className="h-4 w-4" aria-hidden /> CSV</a>
        {showAdd && <><Button size="sm" onClick={() => tx.open()}>Add</Button><Button size="sm" variant="outline" onClick={() => tx.open({ kind: "TRANSFER" })}>Transfer</Button></>}
      </div>
      {showFilters && (
        <div className="mb-3 grid gap-2 rounded-lg border border-border bg-card p-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-xs">From<Input type="date" value={f.from} onChange={(e) => set("from", e.target.value)} className="mt-1 h-9" /></label>
          <label className="text-xs">To<Input type="date" value={f.to} onChange={(e) => set("to", e.target.value)} className="mt-1 h-9" /></label>
          {!lockedTypes && <label className="text-xs">Type<Select value={f.types} onChange={(e) => set("types", e.target.value)} className="mt-1 h-9"><option value="">All types</option>{["INCOME", "EXPENSE", "TRANSFER", "REFUND", "REIMBURSEMENT", "ADJUSTMENT", "SETTLEMENT"].map((t) => <option key={t} value={t}>{humanize(t)}</option>)}</Select></label>}
          <label className="text-xs">Category<div className="mt-1"><CategorySelect value={f.categoryIds} onChange={(v) => set("categoryIds", v)} includeNone="All categories" /></div></label>
          <label className="text-xs">Account<Select value={f.accountId} onChange={(e) => set("accountId", e.target.value)} className="mt-1 h-9"><option value="">All accounts</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></label>
          {(vehicleOpts.data?.length ?? 0) > 0 && <label className="text-xs">Vehicle<Select value={f.vehicleId} onChange={(e) => set("vehicleId", e.target.value)} className="mt-1 h-9"><option value="">All vehicles</option>{vehicleOpts.data!.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></label>}
          <label className="text-xs">Tag<Select value={f.tag} onChange={(e) => set("tag", e.target.value)} className="mt-1 h-9"><option value="">Any tag</option>{(tags.data ?? []).map((t: any) => <option key={t.tag} value={t.tag}>{t.tag} ({t.count})</option>)}</Select></label>
          <label className="text-xs">Member<Select value={f.member} onChange={(e) => set("member", e.target.value)} className="mt-1 h-9"><option value="">All members</option>{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select></label>
          <label className="text-xs">Smallest amount<Input inputMode="decimal" value={f.minAmount} onChange={(e) => set("minAmount", e.target.value)} className="mt-1 h-9 text-right" /></label>
          <label className="text-xs">Largest amount<Input inputMode="decimal" value={f.maxAmount} onChange={(e) => set("maxAmount", e.target.value)} className="mt-1 h-9 text-right" /></label>
          <label className="text-xs">Recurring<Select value={f.recurring} onChange={(e) => set("recurring", e.target.value)} className="mt-1 h-9"><option value="">Any</option><option value="1">Recurring only</option><option value="0">One-off only</option></Select></label>
          <label className="text-xs">Status<Select value={f.status} onChange={(e) => set("status", e.target.value)} className="mt-1 h-9"><option value="">Posted and expected</option><option value="POSTED">Posted</option><option value="PLANNED">Expected</option></Select></label>
          <label className="text-xs">Reconciliation<Select value={f.reconciliation} onChange={(e) => set("reconciliation", e.target.value)} className="mt-1 h-9"><option value="">Any</option><option value="UNRECONCILED">Unreconciled</option><option value="CLEARED">Cleared</option><option value="RECONCILED">Reconciled</option></Select></label>
          <label className="text-xs">Sort<Select value={f.sort} onChange={(e) => set("sort", e.target.value)} className="mt-1 h-9"><option value="date_desc">Newest first</option><option value="date_asc">Oldest first</option><option value="amount_desc">Largest first</option><option value="amount_asc">Smallest first</option></Select></label>
          <div className="flex items-end"><Button variant="ghost" size="sm" onClick={() => { setF(emptyFilters(initial)); setPage(1); }}><X className="h-4 w-4" /> Clear filters</Button></div>
        </div>
      )}
      {picked.size > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-primary/40 bg-primary/5 p-3 text-sm" role="region" aria-label="Bulk actions">
          <span className="font-medium">{picked.size} selected</span>
          <div className="w-56"><CategorySelect value={bulkCat} onChange={setBulkCat} includeNone="Choose a category" /></div>
          <Button size="sm" disabled={!bulkCat} loading={bulk.isPending} onClick={() => bulk.mutate({ ids: [...picked], categoryId: bulkCat })}>Categorise</Button>
          <Button size="sm" variant="outline" onClick={() => bulk.mutate({ ids: [...picked], reconciliation: "CLEARED" })}>Mark cleared</Button>
          <Button size="sm" variant="ghost" onClick={() => setPicked(new Set())}>Clear</Button>
        </div>
      )}
      {data && (
        <p className="mb-2 text-sm text-muted-foreground" aria-live="polite">
          {data.total} transaction{data.total === 1 ? "" : "s"}. Income <Money value={data.summary.income} />, expenses <Money value={data.summary.expenses} />, net <Money value={data.summary.net} delta />. <span className="text-xs">{data.summary.note}</span>
        </p>
      )}
      <div className={`rounded-xl border border-border bg-card ${isFetching ? "opacity-80" : ""}`}>
        <DataTable cols={cols} rows={data?.items} loading={isLoading} caption="Transactions" onRow={(r) => setOpen(r.id)} empty={<EmptyState title="No transactions match" description="Adjust the filters, or add a transaction. Records other members keep private are never shown here." />} />
        {data && pages > 1 && (
          <div className="flex items-center justify-between border-t border-border px-4 py-2 text-sm">
            <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
            <span className="text-muted-foreground">Page {page} of {pages}</span>
            <Button variant="ghost" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next</Button>
          </div>
        )}
      </div>
      {open && <TransactionDetail id={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
