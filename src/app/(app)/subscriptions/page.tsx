"use client";
import * as React from "react";
import { Alert, Badge, Button } from "@/components/ui/primitives";
import { useConfirm } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty";
import { useFin, useFinMutation, useFinQuery } from "@/components/finance/provider";
import { Add, DataTable, FormModal, Figure, MemberChip, Money, NeedsHousehold, PageHeader, Section, ViewNote, VisibilityBadge, humanize, type Col, type FieldDef } from "@/components/finance/ui";

export default function SubscriptionsPage() {
  return <NeedsHousehold><Inner /></NeedsHousehold>;
}
function Inner() {
  const { fmt, canWrite } = useFin();
  const confirm = useConfirm();
  const [edit, setEdit] = React.useState<any | "new" | null>(null);
  const [charge, setCharge] = React.useState<any | null>(null);
  const { data, isLoading } = useFinQuery<any>("/subscriptions", { view: "all" });
  const create = useFinMutation<any, any>("POST", "/subscriptions", { success: "Subscription added" });
  const upd = useFinMutation<any, any>("PATCH", (b) => `/subscriptions/${b.id}`, { success: "Saved" });
  const del = useFinMutation<any, any>("DELETE", (b) => `/subscriptions/${b.id}`, { success: "Removed" });
  const chg = useFinMutation<any, any>("POST", (b) => `/subscriptions/${b.id}/charge`, { success: "Charge recorded" });
  const fields: FieldDef[] = [
    { name: "name", label: "Name", required: true },
    { name: "provider", label: "Provider", half: true },
    { name: "category", label: "Kind", kind: "select", options: ["Streaming", "Software", "Mobile apps", "Membership", "Cloud services", "Fitness", "Other"].map((x) => [x, x]), half: true },
    { name: "amount", label: "Amount", kind: "money", required: true, half: true },
    { name: "frequency", label: "Billing frequency", kind: "frequency", half: true },
    { name: "nextBillingDate", label: "Next billing date", kind: "date", required: true, half: true },
    { name: "accountId", label: "Payment account", kind: "account", includeNone: "Not set", half: true },
    { name: "cancellationInfo", label: "How to cancel", kind: "textarea" },
    { name: "notes", label: "Notes", kind: "textarea" },
  ];
  const cols: Col<any>[] = [
    { key: "n", header: "Subscription", primary: true, cell: (r) => <span className="flex flex-col"><span className="font-medium">{r.name}{!r.active ? " (cancelled)" : ""}</span><span className="text-xs text-muted-foreground">{r.provider ?? r.category}</span></span> },
    { key: "o", header: "Owner", cell: (r) => <MemberChip member={r.owner} /> },
    { key: "nx", header: "Next charge", cell: (r) => fmt.date(r.nextBillingDate) },
    { key: "fl", header: "Flags", cell: (r) => <span className="flex flex-wrap gap-1">{r.priceIncrease && <Badge tone="warning" title={`From ${r.priceIncrease.from} to ${r.priceIncrease.to}`}>Price up</Badge>}{r.needsReview && <Badge tone="info">Review</Badge>}</span> },
    { key: "mo", header: "Monthly", hideOnMobile: true, align: "right", cell: (r) => <Money value={r.monthlyCost} /> },
    { key: "a", header: "Amount", align: "right", cell: (r) => <span className="flex flex-col items-end"><span className="money">{fmt.money(r.amount)}</span><span className="text-[11px] text-muted-foreground">{humanize(r.frequency)}</span></span> },
  ];
  return (
    <div>
      <PageHeader eyebrow="Subscriptions" title="Subscriptions" description="Recurring services, with their monthly and annual cost. Price increases and subscriptions not reviewed in six months are flagged." actions={<Add label="Add subscription" onClick={() => setEdit("new")} />} />
      <ViewNote />
      {data && <section className="mb-5 grid grid-cols-2 gap-4 rounded-xl border border-border bg-card p-5 sm:grid-cols-4" aria-label="Subscription totals"><Figure label="Per month" value={data.totals.monthly} /><Figure label="Per year" value={data.totals.annual} /><Figure label="Active" value={<span className="text-2xl">{data.totals.activeCount}</span>} /><Figure label="Next 30 days" value={<span className="text-2xl">{data.upcoming.length}</span>} hint="charges" /></section>}
      <Section flush><DataTable cols={cols} rows={data?.items} loading={isLoading} caption="Subscriptions" onRow={(r) => r.canEdit && setEdit(r)} empty={<EmptyState title="No subscriptions" description="Add streaming, software and memberships to see what they cost over a year." action={canWrite ? <Button onClick={() => setEdit("new")}>Add subscription</Button> : undefined} />} /></Section>
      <FormModal open={!!edit} onClose={() => setEdit(null)} title={edit === "new" ? "Add a subscription" : `Edit ${edit?.name ?? ""}`} fields={fields} visibility initial={edit && edit !== "new" ? { ...edit, accountId: edit.accountId ?? "" } : { category: "Streaming", frequency: "MONTHLY" }}
        footerExtra={edit && edit !== "new" && edit.canEdit ? <><Button variant="ghost" className="mr-auto text-danger" onClick={async () => { if (await confirm({ title: "Remove this subscription?", confirmLabel: "Remove", tone: "danger" })) { del.mutate({ id: edit.id }); setEdit(null); } }}>Remove</Button><Button variant="outline" onClick={() => { upd.mutate({ id: edit.id, markReviewed: true }); setEdit(null); }}>Mark reviewed</Button><Button variant="outline" onClick={() => { upd.mutate({ id: edit.id, active: !edit.active }); setEdit(null); }}>{edit.active ? "Cancel" : "Reactivate"}</Button><Button variant="outline" onClick={() => { setCharge(edit); setEdit(null); }}>Record a charge</Button></> : undefined}
        onSubmit={(v) => { const body = { name: v.name, provider: v.provider || null, category: v.category, amount: v.amount, frequency: v.frequency, nextBillingDate: v.nextBillingDate, accountId: v.accountId || null, cancellationInfo: v.cancellationInfo || null, notes: v.notes || null, visibility: v.visibility, sharedWithMemberIds: v.visibility === "SELECTED" ? v.sharedWithMemberIds : undefined }; return edit === "new" ? create.mutateAsync(body) : upd.mutateAsync({ id: edit.id, ...body }); }} />
      <FormModal open={!!charge} onClose={() => setCharge(null)} title={`Record a charge: ${charge?.name ?? ""}`} description="Creates one expense and moves the next billing date forward." fields={[{ name: "date", label: "Date charged", kind: "date", required: true, half: true }, { name: "amount", label: "Amount", kind: "money", half: true }, { name: "accountId", label: "Charged to", kind: "account", required: true }]} initial={{ date: new Date().toISOString().slice(0, 10), amount: charge?.amount ?? "", accountId: charge?.accountId ?? "" }} onSubmit={(v) => chg.mutateAsync({ id: charge.id, date: v.date, amount: v.amount || undefined, accountId: v.accountId })} />
    </div>
  );
}

