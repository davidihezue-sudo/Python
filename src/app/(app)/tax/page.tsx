"use client";
import * as React from "react";
import { Button, Select } from "@/components/ui/primitives";
import { useConfirm } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty";
import { useFin, useFinMutation, useFinQuery } from "@/components/finance/provider";
import { Add, DataTable, FormModal, MemberChip, Money, NeedsHousehold, Notice, PageHeader, Section, ViewNote, VisibilityBadge, humanize, type Col, type FieldDef } from "@/components/finance/ui";

const KINDS: [string, string][] = [["EMPLOYMENT_INCOME", "Employment income"], ["SELF_EMPLOYMENT_INCOME", "Self-employment income"], ["TAX_DEDUCTED", "Income tax deducted at source"], ["PENSION_CONTRIBUTION", "Pension contributions"], ["RRSP_CONTRIBUTION", "RRSP contributions"], ["FHSA_CONTRIBUTION", "FHSA contributions"], ["CHARITABLE_DONATION", "Charitable donations"], ["MEDICAL_EXPENSE", "Eligible medical expenses"], ["TUITION", "Tuition amounts"], ["EMPLOYMENT_EXPENSE", "Employment expenses"], ["OTHER_DEDUCTION", "Other deductions"], ["OTHER", "Other"]];

export default function TaxPage() {
  return <NeedsHousehold><Inner /></NeedsHousehold>;
}
function Inner() {
  const { fmt, canWrite, profile } = useFin();
  const confirm = useConfirm();
  const thisYear = Number((profile?.today ?? new Date().toISOString()).slice(0, 4));
  const [year, setYear] = React.useState(thisYear);
  const [edit, setEdit] = React.useState<any | "new" | null>(null);
  const records = useFinQuery<any[]>("/tax/records", { year });
  const summary = useFinQuery<any>("/tax/summary", { year });
  const create = useFinMutation<any, any>("POST", "/tax/records", { success: "Tax record added" });
  const upd = useFinMutation<any, any>("PATCH", (b) => `/tax/records/${b.id}`, { success: "Saved" });
  const del = useFinMutation<any, any>("DELETE", (b) => `/tax/records/${b.id}`, { success: "Removed" });
  const fields: FieldDef[] = [
    { name: "kind", label: "Type", kind: "select", options: KINDS, half: true },
    { name: "taxYear", label: "Tax year", kind: "number", half: true },
    { name: "amount", label: "Amount", kind: "money", required: true, half: true },
    { name: "date", label: "Date (optional)", kind: "date", half: true },
    { name: "description", label: "Description" },
    { name: "notes", label: "Notes", kind: "textarea" },
  ];
  const cols: Col<any>[] = [
    { key: "k", header: "Type", primary: true, cell: (r) => <span className="flex flex-col"><span className="font-medium">{r.label}</span>{r.description && <span className="text-xs text-muted-foreground">{r.description}</span>}</span> },
    { key: "o", header: "Member", hideOnMobile: true, cell: (r) => <MemberChip member={r.owner} /> },
    { key: "v", header: "Sharing", hideOnMobile: true, cell: (r) => <VisibilityBadge visibility={r.visibility} /> },
    { key: "a", header: "Amount", align: "right", cell: (r) => <span className="money">{fmt.money(r.amount)}</span> },
  ];
  const s = summary.data;
  return (
    <div>
      <PageHeader eyebrow="Tax" title="Tax summary and estimate" description="Record the figures that matter at tax time and see a planning estimate. Rules are stored as data for your region and can be updated by an administrator."
        actions={<><Select aria-label="Tax year" value={year} onChange={(e) => setYear(Number(e.target.value))} className="w-28">{[thisYear + 1, thisYear, thisYear - 1, thisYear - 2, thisYear - 3].map((y) => <option key={y} value={y}>{y}</option>)}</Select>{canWrite && <Add label="Add record" onClick={() => setEdit("new")} />}</>} />
      <ViewNote />
      {s && <Notice tone="warning" title="Estimate only">{s.disclaimer}</Notice>}
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        {(s?.members ?? []).map((m: any, i: number) => (
          <Section key={i} title={<span className="flex items-center gap-2">{m.member?.name ?? "Member"} <span className="text-xs font-normal text-muted-foreground">{year}</span></span>}>
            {m.estimate ? (
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                {[["Total income", m.estimate.totalIncome], ["Deductions", m.estimate.totalDeductions], ["Taxable income", m.estimate.taxableIncome], ["Federal tax", m.estimate.federalTax], ["Provincial tax", m.estimate.provincialTax], ["Estimated tax", m.estimate.estimatedTax], ["Tax actually deducted", m.estimate.actualTaxDeducted]].map(([l, v]) => (
                  <React.Fragment key={l as string}><dt className="text-muted-foreground">{l}</dt><dd className="text-right"><Money value={v as string} /></dd></React.Fragment>
                ))}
                <dt className="font-medium">{Number(m.estimate.estimatedRefund) > 0 ? "Estimated refund" : "Estimated amount owing"}</dt>
                <dd className="text-right font-medium"><Money value={Number(m.estimate.estimatedRefund) > 0 ? m.estimate.estimatedRefund : m.estimate.estimatedOwing} /></dd>
                <dt className="text-muted-foreground">Average / marginal rate</dt><dd className="text-right tabular">{fmt.pct(m.estimate.averageRate)} / {fmt.pct(m.estimate.marginalRate)}</dd>
                {m.estimate.payrollEstimate && <><dt className="text-muted-foreground">CPP / EI (estimate)</dt><dd className="text-right tabular">{fmt.money(m.estimate.payrollEstimate.cpp)} / {fmt.money(m.estimate.payrollEstimate.ei)}</dd></>}
              </dl>
            ) : <p className="text-sm text-muted-foreground">No tax rules are loaded for {year}. An administrator can add them below, or you can keep records without an estimate.</p>}
            {m.estimate?.warnings?.length > 0 && <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-muted-foreground">{m.estimate.warnings.map((w: string) => <li key={w}>{w}</li>)}</ul>}
          </Section>
        ))}
      </div>
      {s && s.members.length === 0 && <EmptyState title="No tax records for this year" description={`Add income, deductions and tax withheld to see an estimate. Your recorded income suggests roughly ${fmt.money(s.suggestedAnnualGrossFromIncome)} gross a year.`} />}
      {s && <p className="mt-3 text-xs text-muted-foreground">Rules used: {s.rules.federal ? `federal ${s.rules.federal.year}${s.rules.federal.fellBackFromYear ? ` (closest available to ${s.rules.federal.fellBackFromYear})` : ""}` : "none"}{s.rules.provincial ? `, regional ${s.rules.provincial.year}` : ""}. Source: {s.rules.federal?.source ?? "n/a"}.</p>}
      <div className="mt-6"><Section flush title="Tax records" description="Only records you can see are listed.">
        <DataTable cols={cols} rows={records.data} loading={records.isLoading} caption="Tax records" onRow={(r) => r.canEdit && setEdit(r)} empty={<EmptyState title="Nothing recorded" description="Add a record to start." />} />
      </Section></div>
      <FormModal open={!!edit} onClose={() => setEdit(null)} title={edit === "new" ? "Add a tax record" : `Edit ${edit?.label ?? ""}`} fields={fields} visibility
        initial={edit && edit !== "new" ? { ...edit, date: edit.date ?? "", description: edit.description ?? "", notes: edit.notes ?? "" } : { kind: "EMPLOYMENT_INCOME", taxYear: year, amount: "", date: "", description: "", notes: "", visibility: "PERSONAL", sharedWithMemberIds: [] }}
        footerExtra={edit && edit !== "new" && edit.canEdit ? <Button variant="ghost" className="mr-auto text-danger" onClick={async () => { if (await confirm({ title: "Remove this record?", confirmLabel: "Remove" })) { await del.mutateAsync(edit); setEdit(null); } }}>Remove</Button> : undefined}
        onSubmit={(v) => { const body = { kind: v.kind, taxYear: Number(v.taxYear), amount: v.amount, date: v.date || null, description: v.description || null, notes: v.notes || null, visibility: v.visibility, sharedWithMemberIds: v.sharedWithMemberIds }; return edit === "new" ? create.mutateAsync(body) : upd.mutateAsync({ id: edit.id, ...body }); }} />
    </div>
  );
}
