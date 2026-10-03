"use client";
import * as React from "react";
import { Alert, Badge, Button } from "@/components/ui/primitives";
import { useConfirm } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty";
import { useFin, useFinMutation, useFinQuery } from "@/components/finance/provider";
import { Add, DataTable, FormModal, NeedsHousehold, PageHeader, Section, type Col, type FieldDef } from "@/components/finance/ui";

export default function RulesPage() {
  return <NeedsHousehold><Inner /></NeedsHousehold>;
}
const split = (s: string) => String(s ?? "").split(",").map((x) => x.trim()).filter(Boolean);

function Inner() {
  const { isAdmin, canWrite, fmt } = useFin();
  const confirm = useConfirm();
  const [edit, setEdit] = React.useState<any | "new" | null>(null);
  const [applied, setApplied] = React.useState<string | null>(null);
  const { data, isLoading } = useFinQuery<any[]>("/rules");
  const { data: cats } = useFinQuery<any[]>("/categories");
  const catName = (id?: string) => cats?.find((c) => c.id === id)?.name ?? "";
  const create = useFinMutation<any, any>("POST", "/rules", { success: "Rule added" });
  const upd = useFinMutation<any, any>("PATCH", (b) => `/rules/${b.id}`, { success: "Saved" });
  const del = useFinMutation<any, any>("DELETE", (b) => `/rules/${b.id}`, { success: "Rule removed" });
  const run = useFinMutation<any, any>("POST", "/rules/apply", { success: "Done" });
  const fields: FieldDef[] = [
    { name: "name", label: "Rule name", required: true },
    { name: "textAny", label: "When the description contains any of", hint: "Separate with commas, for example: costco, loblaws, no frills", required: true },
    { name: "minAmount", label: "At least (optional)", kind: "money", half: true },
    { name: "maxAmount", label: "At most (optional)", kind: "money", half: true },
    { name: "categoryId", label: "Set the category to", kind: "category", includeNone: "Do not change", half: true },
    { name: "vehicleId", label: "Link to vehicle", kind: "vehicle", half: true },
    { name: "addTags", label: "Add tags", hint: "Separate with commas", half: true },
    { name: "merchant", label: "Set the merchant to", half: true },
    { name: "priority", label: "Order (lower runs first)", kind: "number", half: true },
    { name: "scope", label: "Applies to", kind: "select", options: [["MINE", "Only my entries"], ...(isAdmin ? [["HOUSEHOLD", "Everyone in the household"] as [string, string]] : [])], half: true },
  ];
  const body = (v: any) => ({
    name: v.name, scope: v.scope, priority: Number(v.priority || 100), active: true,
    conditions: { textAny: split(v.textAny), minAmount: v.minAmount || null, maxAmount: v.maxAmount || null },
    actions: { categoryId: v.categoryId || null, vehicleId: v.vehicleId || null, addTags: split(v.addTags), merchant: v.merchant || null },
  });
  const initial = (r: any) => r && r !== "new" ? { name: r.name, textAny: (r.conditions.textAny ?? []).join(", "), minAmount: r.conditions.minAmount ?? "", maxAmount: r.conditions.maxAmount ?? "", categoryId: r.actions.categoryId ?? "", vehicleId: r.actions.vehicleId ?? "", addTags: (r.actions.addTags ?? []).join(", "), merchant: r.actions.merchant ?? "", priority: r.priority, scope: r.scope } : { scope: "MINE", priority: 100, textAny: "", addTags: "" };
  const cols: Col<any>[] = [
    { key: "n", header: "Rule", primary: true, cell: (r) => <span className="flex flex-col"><span className="font-medium">{r.name}</span><span className="text-xs text-muted-foreground">If it contains: {(r.conditions.textAny ?? []).join(", ") || "any amount rule"}</span></span> },
    { key: "a", header: "Then", cell: (r) => <span className="text-sm">{[r.actions.categoryId && `category ${catName(r.actions.categoryId)}`, r.actions.addTags?.length && `tags ${r.actions.addTags.join(", ")}`, r.actions.merchant && `merchant ${r.actions.merchant}`, r.actions.vehicleId && "vehicle"].filter(Boolean).join(", ")}</span> },
    { key: "s", header: "Scope", hideOnMobile: true, cell: (r) => <Badge tone={r.scope === "HOUSEHOLD" ? "info" : "neutral"}>{r.scope === "HOUSEHOLD" ? "Household" : "Mine"}</Badge> },
    { key: "h", header: "Used", align: "right", hideOnMobile: true, cell: (r) => <span className="money text-muted-foreground">{r.hitCount}{r.lastHitAt ? ` · ${fmt.date(r.lastHitAt.slice(0, 10))}` : ""}</span> },
    { key: "x", header: "", align: "right", cell: (r) => r.canEdit ? <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); upd.mutate({ id: r.id, active: !r.active }); }}>{r.active ? "Turn off" : "Turn on"}</Button> : null },
  ];
  return (
    <div>
      <PageHeader eyebrow="Tools" title="Auto-categorise rules" description="Teach the app once and it files new entries and imports for you. A rule only fills in what is empty: it never overrides a category you chose." actions={canWrite ? <><Add label="Add rule" onClick={() => setEdit("new")} /><Button variant="outline" loading={run.isPending} onClick={async () => { if (await confirm({ title: "Apply rules to past transactions?", description: "Only uncategorised entries you are allowed to edit are filled in. Nothing already set is changed.", confirmLabel: "Apply" })) { const r = await run.mutateAsync({}); setApplied(`${r.updated} of ${r.scanned} transactions updated.`); } }}>Apply to past entries</Button></> : undefined} />
      {applied && <div className="mb-4"><Alert tone="success">{applied}</Alert></div>}
      <Section flush><DataTable cols={cols} rows={data ?? []} loading={isLoading} caption="Rules" onRow={(r) => r.canEdit && setEdit(r)} empty={<EmptyState title="No rules yet" description="For example: anything containing costco or loblaws goes to Groceries." action={canWrite ? <Button onClick={() => setEdit("new")}>Add a rule</Button> : undefined} />} /></Section>
      <FormModal open={!!edit} onClose={() => { setEdit(null); }} title={edit === "new" ? "Add a rule" : `Edit ${edit?.name ?? ""}`} fields={fields} initial={initial(edit)}
        footerExtra={edit && edit !== "new" ? <Button variant="ghost" className="mr-auto text-danger" onClick={async () => { if (await confirm({ title: "Remove this rule?", description: "Entries already categorised keep their category.", confirmLabel: "Remove", tone: "danger" })) { del.mutate({ id: edit.id }); setEdit(null); } }}>Remove</Button> : undefined}
        onSubmit={(v) => edit === "new" ? create.mutateAsync(body(v)) : upd.mutateAsync({ id: edit.id, ...(({ scope, active, ...rest }) => rest)(body(v)) })}>
        {({ values }) => <RulePreview words={split(values.textAny)} min={values.minAmount} max={values.maxAmount} />}
      </FormModal>
    </div>
  );
}

/** Shows how many of the last year's entries a rule would have caught, so a rule is never a leap of faith. */
function RulePreview({ words, min, max }: { words: string[]; min?: string; max?: string }) {
  const { hid } = useFin();
  const [r, setR] = React.useState<any>(null);
  const { fmt } = useFin();
  const key = JSON.stringify([words, min, max]);
  React.useEffect(() => {
    if (!words.length) { setR(null); return; }
    const t = setTimeout(async () => {
      const { finApi } = await import("@/components/finance/provider");
      try { setR(await finApi(hid as string, "/rules/preview", { method: "POST", body: { conditions: { textAny: words, minAmount: min || null, maxAmount: max || null } } })); } catch { setR(null); }
    }, 400);
    return () => clearTimeout(t);
  }, [key, hid]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!r) return null;
  return (
    <div className="rounded-md border border-border bg-muted/40 p-3 text-sm" aria-live="polite">
      <p className="font-medium">This would match {r.matched} of your last {r.scanned} entries.</p>
      {r.samples.length > 0 && <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">{r.samples.map((s: any) => <li key={s.id}>{fmt.date(s.date)} · {s.description} · <span className="money">{fmt.money(s.amount)}</span></li>)}</ul>}
    </div>
  );
}
