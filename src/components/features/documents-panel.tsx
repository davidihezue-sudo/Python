"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileText, Image as ImageIcon, Trash2, Upload, ScanText } from "lucide-react";
import { api, qs } from "@/lib/client/api";
import { Badge, Button, Card, CardBody, Input, Select, Skeleton } from "@/components/ui/primitives";
import { EmptyState } from "@/components/ui/empty";
import { Modal, useConfirm } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { useQuickAdd } from "@/components/forms/quick-dialogs";
import { DOC_CATEGORIES, label } from "@/components/forms/common";
import { useFormat } from "@/components/shell/providers";
import { diffDays } from "@/lib/dates";

export function DocumentsPanel({ vehicleId, openId, canWrite = true }: { vehicleId?: string; openId?: string | null; canWrite?: boolean }) {
  const f = useFormat();
  const { open } = useQuickAdd();
  const [category, setCategory] = React.useState("");
  const [text, setText] = React.useState("");
  const [detail, setDetail] = React.useState<any | null>(null);
  const params = { vehicleId, category, q: text, pageSize: 60 };
  const { data, isLoading } = useQuery({ queryKey: ["documents", params], queryFn: () => api<any>(`/api/documents${qs(params)}`) });
  React.useEffect(() => {
    if (openId && data) setDetail(data.items.find((d: any) => d.id === openId) ?? null);
  }, [openId, data]);
  const todayIso = new Date().toISOString().slice(0, 10);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input type="search" aria-label="Search documents" placeholder="Search title, file name…" className="h-9 w-56" value={text} onChange={(e) => setText(e.target.value)} />
        <Select aria-label="Category" className="h-9 w-auto" value={category} onChange={(e) => setCategory(e.target.value)}><option value="">All categories</option>{DOC_CATEGORIES.map((c) => <option key={c} value={c}>{label(c)}</option>)}</Select>
        {canWrite && <Button size="sm" className="ml-auto" onClick={() => open("upload", { vehicleId })}><Upload className="h-4 w-4" /> Upload</Button>}
      </div>
      {isLoading ? <Skeleton className="h-40" /> : !data?.items.length ? (
        <EmptyState icon={<FileText className="h-6 w-6" />} title="No documents" description="Upload maintenance receipts, invoices, insurance and registration documents, inspection reports and photos. Receipts can be attached to services and expenses." action={canWrite ? <Button onClick={() => open("upload", { vehicleId, category: "MAINTENANCE_INVOICE" })}>Upload a maintenance receipt</Button> : undefined} />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.items.map((d: any) => {
            const days = d.expiresOn ? diffDays(d.expiresOn, todayIso) : null;
            return (
              <li key={d.id}><button className="w-full text-left" onClick={() => setDetail(d)}><Card className="h-full overflow-hidden transition-colors hover:border-primary/50">
                <div className="flex h-28 items-center justify-center bg-muted">{d.mimeType.startsWith("image/") ? <img src={d.url} alt="" className="h-full w-full object-cover" loading="lazy" /> : <FileText className="h-10 w-10 text-muted-foreground" aria-hidden />}</div>
                <CardBody className="!py-3"><p className="truncate font-medium">{d.title}</p><p className="text-xs text-muted-foreground">{label(d.category)}{d.vehicleName ? ` · ${d.vehicleName}` : ""} · {f.date(d.uploadedAt)}</p>
                  <div className="mt-1.5 flex flex-wrap gap-1">{d.ocrStatus === "EXTRACTED" && <Badge tone="warning">Details awaiting verification</Badge>}{d.ocrStatus === "CONFIRMED" && <Badge tone="success">Expense created</Badge>}{days !== null && <Badge tone={days < 0 ? "danger" : days <= 30 ? "warning" : "neutral"}>{days < 0 ? "Expired" : `Expires ${f.date(d.expiresOn)}`}</Badge>}{d.maintenanceRecordId && <Badge tone="info">Service</Badge>}{d.repairIssueId && <Badge tone="info">Issue</Badge>}{d.expenseId && <Badge tone="info">Expense</Badge>}</div>
                </CardBody>
              </Card></button></li>
            );
          })}
        </ul>
      )}
      {detail && <DocDetail doc={detail} canWrite={canWrite} onClose={() => setDetail(null)} />}
    </div>
  );
}

function DocDetail({ doc, onClose, canWrite }: { doc: any; onClose: () => void; canWrite: boolean }) {
  const f = useFormat();
  const qc = useQueryClient();
  const router = useRouter();
  const confirm = useConfirm();
  const { toast } = useToast();
  const [busy, setBusy] = React.useState(false);
  const ocr = doc.ocr && doc.ocrStatus === "EXTRACTED" ? doc.ocr : null;
  const extract = async () => {
    setBusy(true);
    try { await api(`/api/documents/${doc.id}/ocr`, { method: "POST" }); toast({ title: "Details extracted - review them below" }); void qc.invalidateQueries(); } catch (e) { toast({ title: "Couldn't extract details", description: (e as Error).message, variant: "error" }); } finally { setBusy(false); }
  };
  const close = () => { onClose(); if (location.search.includes("doc=")) router.replace(location.pathname); };
  return (
    <Modal open onClose={close} size="lg" title={doc.title} description={`${label(doc.category)} · ${f.date(doc.uploadedAt)} · ${(doc.sizeBytes / 1024).toFixed(0)} KB`}
      footer={<>{canWrite && <Button variant="danger" onClick={async () => { if (await confirm({ title: "Delete this document?", confirmLabel: "Delete" })) { await api(`/api/documents/${doc.id}`, { method: "DELETE" }); toast({ title: "Document deleted" }); void qc.invalidateQueries(); close(); } }}><Trash2 className="h-4 w-4" /></Button>}{canWrite && ["MAINTENANCE_INVOICE", "REPAIR_RECEIPT", "PARTS_RECEIPT"].includes(doc.category) && doc.ocrStatus !== "CONFIRMED" && <Button variant="outline" loading={busy} onClick={extract}><ScanText className="h-4 w-4" /> Extract details</Button>}<a href={doc.downloadUrl}><Button><Download className="h-4 w-4" /> Download</Button></a></>}>
      <div className="space-y-3 text-sm">
        {doc.description && <p className="text-muted-foreground">{doc.description}</p>}
        <div className="overflow-hidden rounded-lg border border-border bg-muted">
          {doc.mimeType === "application/pdf" ? <iframe title={doc.title} src={doc.url} className="h-[60vh] w-full" /> : <img src={doc.url} alt={doc.title} className="mx-auto max-h-[60vh] object-contain" />}
        </div>
        {ocr && <div className="rounded-lg border border-warning/40 bg-warning/10 p-3"><p className="font-medium">Extracted details (unverified)</p><p className="text-muted-foreground">Vendor {ocr.vendor ?? "?"} · Date {ocr.date ?? "?"} · Total {ocr.total ?? "?"} · Tax {ocr.tax ?? "?"} · Invoice {ocr.invoiceNumber ?? "?"}. Use <strong>Upload → Verify</strong>, or edit values in a new expense; nothing is created automatically.</p></div>}
        {doc.expiresOn && <p>Expires {f.date(doc.expiresOn)}</p>}
        <p className="flex items-center gap-1 text-xs text-muted-foreground"><ImageIcon className="h-3 w-3" /> Stored privately; only people with access to this vehicle can open it.</p>
      </div>
    </Modal>
  );
}
