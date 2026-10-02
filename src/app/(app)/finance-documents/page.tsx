"use client";
import * as React from "react";
import { FileText, Trash2, Upload } from "lucide-react";
import { Button, Field, Input, Select } from "@/components/ui/primitives";
import { useConfirm } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { EmptyState } from "@/components/ui/empty";
import { api, ApiError } from "@/lib/client/api";
import { useFin, useFinMutation, useFinQuery } from "@/components/finance/provider";
import { NeedsHousehold, PageHeader, Section, humanize } from "@/components/finance/ui";

const ENTITIES = ["transaction", "income", "insurance", "debt", "asset", "investment", "tax", "bill", "subscription"];

export default function FinanceDocumentsPage() {
  return <NeedsHousehold><Inner /></NeedsHousehold>;
}
function Inner() {
  const { hid, fmt, canWrite } = useFin();
  const { toast } = useToast();
  const confirm = useConfirm();
  const [q, setQ] = React.useState("");
  const [entity, setEntity] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const { data, isLoading, refetch } = useFinQuery<{ items: any[]; total: number }>("/documents", { q: q || undefined, entity: entity || undefined });
  const del = useFinMutation<any, any>("DELETE", (d) => `/documents/${d.id}`, { success: "Document removed" });
  const [target, setTarget] = React.useState({ entity: "transaction", entityId: "" });
  const txs = useFinQuery<any>("/transactions", { view: "all", pageSize: 50 });
  const upload = async (f: File | undefined) => {
    if (!f || !target.entityId) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.set("file", f); form.set("entity", target.entity); form.set("entityId", target.entityId);
      await api(`/api/finance/${hid}/documents`, { method: "POST", body: form });
      toast({ title: "Document attached" }); void refetch();
    } catch (e) { toast({ title: "Upload failed", description: e instanceof ApiError ? e.message : (e as Error).message, variant: "error" }); } finally { setBusy(false); }
  };
  return (
    <div>
      <PageHeader eyebrow="Documents" title="Receipts and documents" description="Files inherit the privacy of the record they are attached to. If the record is private, so is the file." />
      {canWrite && (
        <Section title="Attach a document" description="Pick the record, then choose a PDF or image (up to 10 MB). You can also attach files from a transaction's detail panel.">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Attach to">{(p) => <Select id={p.id} value={target.entity} onChange={(e) => setTarget({ entity: e.target.value, entityId: "" })}>{ENTITIES.map((x) => <option key={x} value={x}>{humanize(x)}</option>)}</Select>}</Field>
            <Field label="Record ID" hint={target.entity === "transaction" ? "Choose a recent transaction" : "Open the record and paste its ID"} className="sm:col-span-2">{(p) => target.entity === "transaction" ? <Select id={p.id} value={target.entityId} onChange={(e) => setTarget({ ...target, entityId: e.target.value })}><option value="">Choose</option>{(txs.data?.items ?? []).map((t: any) => <option key={t.id} value={t.id}>{fmt.date(t.date)} {t.description} {fmt.money(t.amount)}</option>)}</Select> : <Input id={p.id} value={target.entityId} onChange={(e) => setTarget({ ...target, entityId: e.target.value })} />}</Field>
          </div>
          <label className={`mt-3 inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-border px-3 text-sm font-medium hover:bg-muted ${!target.entityId || busy ? "pointer-events-none opacity-50" : ""}`}><Upload className="h-4 w-4" aria-hidden />Choose file<input type="file" accept="application/pdf,image/*" className="sr-only" onChange={(e) => void upload(e.target.files?.[0])} /></label>
        </Section>
      )}
      <div className="mt-5"><Section title="Library" action={<div className="flex gap-2"><Input aria-label="Search documents" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} className="w-44" /><Select aria-label="Filter by record type" value={entity} onChange={(e) => setEntity(e.target.value)} className="w-36"><option value="">All types</option>{ENTITIES.map((x) => <option key={x} value={x}>{humanize(x)}</option>)}</Select></div>} flush>
        {isLoading ? <div className="skeleton m-5 h-24" aria-hidden /> : (data?.items.length ?? 0) === 0 ? <EmptyState title="No documents" description="Attached receipts, statements and policies appear here." /> : (
          <ul className="divide-y divide-border/60">{data!.items.map((d) => (
            <li key={d.id} className="flex items-center gap-3 px-5 py-3">
              <FileText className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
              <div className="min-w-0 flex-1"><a className="block truncate font-medium text-accent hover:underline" href={`/api/documents/${d.id}/download`} target="_blank" rel="noreferrer">{d.title || d.fileName}</a><p className="text-xs text-muted-foreground">{humanize(d.entity)} · {fmt.date(d.createdAt)} · {(d.sizeBytes / 1024).toFixed(0)} KB{d.uploadedBy ? ` · ${d.uploadedBy.name ?? d.uploadedBy}` : ""}</p></div>
              {canWrite && <Button variant="ghost" size="icon" aria-label={`Remove ${d.title || d.fileName}`} onClick={async () => { if (await confirm({ title: "Remove this document?", confirmLabel: "Remove" })) del.mutate(d); }}><Trash2 className="h-4 w-4" /></Button>}
            </li>))}</ul>
        )}
      </Section></div>
    </div>
  );
}
