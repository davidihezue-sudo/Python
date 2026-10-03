"use client";
import * as React from "react";
import { Copy, Paperclip, Pencil, Trash2 } from "lucide-react";
import { api } from "@/lib/client/api";
import { Alert, Badge, Button } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/dialog";
import { CommentsPanel } from "./comments";
import { useConfirm } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { useFin, useFinMutation, useFinQuery } from "./provider";
import { MemberChip, Money, StatusBadge, VisibilityBadge, humanize, useVehicleOptions } from "./ui";
import { useTxDialog } from "./transaction-form";

export function TransactionDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { fmt, hid } = useFin();
  const tx = useTxDialog();
  const confirm = useConfirm();
  const { toast } = useToast();
  const vehicleOpts = useVehicleOptions();
  const { data: t, isLoading, error, refetch } = useFinQuery<any>(`/transactions/${id}`);
  const del = useFinMutation<void, any>("DELETE", `/transactions/${id}`, { success: "Deleted", onSuccess: onClose });
  const dup = useFinMutation<any, any>("POST", `/transactions/${id}/duplicate`, { success: "Duplicated with today's date", onSuccess: onClose });
  const fileRef = React.useRef<HTMLInputElement>(null);
  const upload = async (f: File) => {
    const fd = new FormData();
    fd.set("file", f); fd.set("entity", "transaction"); fd.set("entityId", id); fd.set("title", f.name.replace(/\.[^.]+$/, ""));
    try { await api(`/api/finance/${hid}/documents`, { method: "POST", body: fd }); toast({ title: "Receipt attached" }); void refetch(); } catch (e) { toast({ title: "Could not attach the file", description: (e as Error).message, variant: "error" }); }
  };
  return (
    <Modal open onClose={onClose} title="Transaction" size="lg" footer={t?.canEdit ? (
      <>
        <Button variant="ghost" className="mr-auto text-danger" onClick={async () => { if (await confirm({ title: "Delete this transaction?", description: t.transferGroupId ? "Both sides of the transfer will be removed. Balances update immediately." : "Balances and reports will update immediately. This is recorded in the audit trail.", confirmLabel: "Delete", tone: "danger" })) del.mutate(undefined as never); }}><Trash2 className="h-4 w-4" /> Delete</Button>
        {t.type !== "TRANSFER" && <Button variant="outline" onClick={() => dup.mutate({} as never)}><Copy className="h-4 w-4" /> Duplicate</Button>}
        <Button variant="outline" onClick={() => fileRef.current?.click()}><Paperclip className="h-4 w-4" /> Attach receipt</Button>
        {t.type !== "TRANSFER" && <Button onClick={() => { onClose(); tx.open({ id: t.id, initial: t }); }}><Pencil className="h-4 w-4" /> Edit</Button>}
      </>
    ) : undefined}>
      <input ref={fileRef} type="file" hidden accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ""; }} />
      {isLoading && <div className="skeleton h-40 w-full" />}
      {error && <Alert tone="danger">That transaction is not available. It may be private or deleted.</Alert>}
      {t && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0"><p className="text-lg font-medium">{t.description}</p><p className="text-sm text-muted-foreground">{fmt.date(t.date)} · {humanize(t.type)} · {t.accountName}</p></div>
            <Money value={t.amount} delta size="lg" />
          </div>
          <div className="flex flex-wrap gap-1.5"><StatusBadge status={t.status} /><VisibilityBadge visibility={t.visibility} count={t.sharedWithMemberIds?.length} />{t.reconciliation !== "UNRECONCILED" && <StatusBadge status={t.reconciliation} />}{t.recurring && <Badge>Recurring</Badge>}{t.linked && <Badge>Linked record</Badge>}</div>
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            <Row k="Category" v={t.categoryName ?? "Uncategorised"} />
            <Row k="Merchant" v={t.merchant ?? "n/a"} />
            {t.vehicleId && <Row k="Vehicle" v={vehicleOpts.data?.find((x) => x.id === t.vehicleId)?.name ?? "A vehicle you cannot see"} />}
            <Row k="Owner" v={<MemberChip member={t.owner} />} hint="Whose record this is" />
            <Row k="Paid by" v={t.paidByHousehold ? "The household (joint account)" : <MemberChip member={t.payer} fallback="n/a" />} hint="Who actually paid" />
            <Row k="Entered by" v={<MemberChip member={t.enteredBy} fallback="n/a" />} hint={`on ${fmt.date(t.createdAt)}`} />
            <Row k="Last modified by" v={t.edited ? <MemberChip member={t.lastModifiedBy} fallback="n/a" /> : "Not edited"} hint={t.edited ? `on ${fmt.date(t.updatedAt)}` : undefined} />
          </dl>
          {t.allocations?.length > 0 && (
            <div>
              <p className="mb-1.5 text-sm font-medium">Allocation</p>
              <ul className="divide-y divide-border rounded-lg border border-border">
                {t.allocations.map((a: any, i: number) => <li key={i} className="flex items-center justify-between px-3 py-2 text-sm"><MemberChip member={a.member} fallback="Shared household pool" /><span className="money">{fmt.money(a.amount)}{a.percent && Number(a.percent) !== 100 ? ` (${Number(a.percent)}%)` : ""}</span></li>)}
              </ul>
              <p className="mt-1 text-xs text-muted-foreground">Allocation decides who the cost belongs to. The expense is counted once in household totals.</p>
            </div>
          )}
          {t.transferPeer && <p className="text-sm text-muted-foreground">Other side of the transfer: {t.transferPeer.accountName} ({fmt.money(t.transferPeer.amount, { sign: true })}). Transfers are not income or expenses.</p>}
          {t.notes && <div><p className="text-sm font-medium">Notes</p><p className="whitespace-pre-wrap text-sm text-muted-foreground">{t.notes}</p></div>}
          <div>
            <p className="mb-1.5 text-sm font-medium">Receipts and documents</p>
            {t.documents.length ? <ul className="space-y-1">{t.documents.map((d: any) => <li key={d.id}><a className="text-sm text-primary hover:underline" href={`/api/documents/${d.id}/file`} target="_blank" rel="noreferrer">{d.title}</a> <span className="text-xs text-muted-foreground">({Math.round(d.sizeBytes / 1024)} KB)</span></li>)}</ul> : <p className="text-sm text-muted-foreground">None attached.</p>}
          </div>
          <CommentsPanel entity="transaction" entityId={t.id} />
          <div>
            <p className="mb-1.5 text-sm font-medium">History</p>
            <ol className="space-y-1.5 border-l border-border pl-4">
              {t.history.map((h: any) => <li key={h.id} className="text-sm"><span className="font-medium">{humanize(h.action)}</span> by {h.by?.name ?? "system"} <span className="text-xs text-muted-foreground">{fmt.date(h.at)}</span></li>)}
            </ol>
          </div>
        </div>
      )}
    </Modal>
  );
}
const Row = ({ k, v, hint }: { k: string; v: React.ReactNode; hint?: string }) => <div><dt className="text-xs text-muted-foreground">{k}{hint ? ` · ${hint}` : ""}</dt><dd className="mt-0.5">{v}</dd></div>;
