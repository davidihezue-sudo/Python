"use client";
import * as React from "react";
import { Badge, Button } from "@/components/ui/primitives";
import { useConfirm } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty";
import { useFin, useFinMutation, useFinQuery } from "@/components/finance/provider";
import { Add, DataTable, FormModal, Figure, MemberChip, Money, NeedsHousehold, PageHeader, Section, ViewNote, VisibilityBadge, humanize, useMembers, type Col, type FieldDef } from "@/components/finance/ui";
import { Checkbox } from "@/components/ui/primitives";

const KINDS: [string, string][] = [["VEHICLE", "Vehicle"], ["HOME", "Home"], ["TENANT", "Tenant"], ["LIFE", "Life"], ["DISABILITY", "Disability"], ["HEALTH", "Health"], ["TRAVEL", "Travel"], ["OTHER", "Other"]];
export default function InsurancePage() {
  return <NeedsHousehold><Inner /></NeedsHousehold>;
}
function Inner() {
  const { fmt, canWrite } = useFin();
  const { members } = useMembers();
  const confirm = useConfirm();
  const [edit, setEdit] = React.useState<any | "new" | null>(null);
  const { data, isLoading } = useFinQuery<any>("/insurance", { view: "all" });
  const create = useFinMutation<any, any>("POST", "/insurance", { success: "Policy added" });
  const upd = useFinMutation<any, any>("PATCH", (b) => `/insurance/${b.id}`, { success: "Saved" });
  const del = useFinMutation<any, any>("DELETE", (b) => `/insurance/${b.id}`, { success: "Removed" });
  const fields: FieldDef[] = [
    { name: "kind", label: "Type", kind: "select", options: KINDS, half: true },
    { name: "vehicleId", label: "Vehicle", kind: "vehicle", includeNone: "Not a vehicle policy", half: true },
    { name: "provider", label: "Provider", required: true, half: true },
    { name: "policyName", label: "Policy name", required: true },
    { name: "policyNumberLast4", label: "Policy number (last 4 digits)", half: true, hint: "Only the last digits are stored." },
    { name: "coverageAmount", label: "Coverage amount", kind: "money", half: true },
    { name: "premium", label: "Premium", kind: "money", required: true, half: true },
    { name: "frequency", label: "Payment frequency", kind: "frequency", half: true },
    { name: "renewalDate", label: "Renewal date", kind: "date", half: true },
    { name: "expiryDate", label: "Expiry date", kind: "date", half: true },
    { name: "accountId", label: "Paid from", kind: "account", includeNone: "Not set", half: true },
    { name: "beneficiary", label: "Beneficiary (if applicable)", half: true },
    { name: "notes", label: "Notes", kind: "textarea" },
  ];
  const cols: Col<any>[] = [
    { key: "n", header: "Policy", primary: true, cell: (r) => <span className="flex flex-col"><span className="font-medium">{r.policyName}</span><span className="text-xs text-muted-foreground">{humanize(r.kind)} · {r.provider}{r.policyNumber ? ` · ${r.policyNumber}` : ""}</span></span> },
    { key: "i", header: "Insured", hideOnMobile: true, cell: (r) => r.insured.join(", ") || "n/a" },
    { key: "r", header: "Renews", cell: (r) => <span className="flex items-center gap-1.5">{fmt.date(r.renewalDate)}{r.daysToRenewal !== null && r.daysToRenewal >= 0 && r.daysToRenewal <= 45 && <Badge tone="warning">in {r.daysToRenewal} days</Badge>}</span> },
    { key: "v", header: "Sharing", hideOnMobile: true, cell: (r) => <VisibilityBadge visibility={r.visibility} /> },
    { key: "c", header: "Coverage", hideOnMobile: true, align: "right", cell: (r) => <Money value={r.coverageAmount} /> },
    { key: "p", header: "Premium", align: "right", cell: (r) => <span className="flex flex-col items-end"><span className="money">{fmt.money(r.premium)}</span><span className="text-[11px] text-muted-foreground">{humanize(r.frequency)}</span></span> },
  ];
  return (
    <div>
      <PageHeader eyebrow="Protection" title="Insurance" description="Policies, premiums and renewal dates in one place. Renewals appear on the calendar and in alerts." actions={<Add label="Add policy" onClick={() => setEdit("new")} />} />
      <ViewNote />
      {data && <section className="mb-5 grid grid-cols-2 gap-4 rounded-xl border border-border bg-card p-5 sm:grid-cols-3" aria-label="Insurance totals"><Figure label="Premiums per month" value={data.totals.monthly} /><Figure label="Premiums per year" value={data.totals.annual} /><Figure label="Renewing within 60 days" value={<span className="text-2xl">{data.renewingSoon.length}</span>} /></section>}
      <Section flush><DataTable cols={cols} rows={data?.items} loading={isLoading} caption="Insurance policies" onRow={(r) => r.canEdit && setEdit(r)} empty={<EmptyState title="No policies recorded" description="Add vehicle, home, life and other policies to track premiums and renewals." action={canWrite ? <Button onClick={() => setEdit("new")}>Add a policy</Button> : undefined} />} /></Section>
      <FormModal open={!!edit} onClose={() => setEdit(null)} title={edit === "new" ? "Add a policy" : `Edit ${edit?.policyName ?? ""}`} fields={fields} visibility size="lg" initial={edit && edit !== "new" ? { ...edit, accountId: edit.accountId ?? "", coverageAmount: edit.coverageAmount ?? "" } : { kind: "VEHICLE", frequency: "MONTHLY", insuredMemberIds: [] }}
        footerExtra={edit && edit !== "new" && edit.canEdit ? <Button variant="ghost" className="mr-auto text-danger" onClick={async () => { if (await confirm({ title: "Remove this policy?", confirmLabel: "Remove", tone: "danger" })) { del.mutate({ id: edit.id }); setEdit(null); } }}>Remove</Button> : undefined}
        onSubmit={(v) => { const body = { kind: v.kind, provider: v.provider, policyName: v.policyName, policyNumberLast4: v.policyNumberLast4 || null, premium: v.premium, frequency: v.frequency, coverageAmount: v.coverageAmount || null, renewalDate: v.renewalDate || null, expiryDate: v.expiryDate || null, beneficiary: v.beneficiary || null, vehicleId: v.vehicleId || null, accountId: v.accountId || null, insuredMemberIds: v.insuredMemberIds ?? [], notes: v.notes || null, visibility: v.visibility, sharedWithMemberIds: v.visibility === "SELECTED" ? v.sharedWithMemberIds : undefined }; return edit === "new" ? create.mutateAsync(body) : upd.mutateAsync({ id: edit.id, ...body }); }}>
        {({ values, set }) => <fieldset className="rounded-lg border border-border p-3"><legend className="px-1 text-sm font-medium">Insured members</legend><div className="flex flex-wrap gap-3">{members.map((m) => <Checkbox key={m.id} label={m.name} checked={(values.insuredMemberIds ?? []).includes(m.id)} onChange={(e) => set("insuredMemberIds", e.target.checked ? [...(values.insuredMemberIds ?? []), m.id] : (values.insuredMemberIds ?? []).filter((x: string) => x !== m.id))} />)}</div></fieldset>}
      </FormModal>
    </div>
  );
}
