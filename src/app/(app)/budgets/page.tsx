"use client";
import * as React from "react";
import { useSearchParams } from "next/navigation";
import { Copy, Pencil, Plus, Trash2, X } from "lucide-react";
import { Badge, Button, Checkbox, Field, Input, Select } from "@/components/ui/primitives";
import { Modal, useConfirm } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty";
import { Alert } from "@/components/ui/primitives";
import { useFin, useFinMutation, useFinQuery } from "@/components/finance/provider";
import { Add, CategorySelect, Figure, Money, NeedsHousehold, PageHeader, ProgressBar, Section, StatusBadge, humanize, useCategories } from "@/components/finance/ui";
import { ApiError } from "@/lib/client/api";

export default function BudgetsPage() {
  return <NeedsHousehold><Inner /></NeedsHousehold>;
}
function Inner() {
  const sp = useSearchParams();
  const { fmt, canWrite } = useFin();
  const confirm = useConfirm();
  const [selId, setSelId] = React.useState<string | null>(sp.get("id"));
  const [editing, setEditing] = React.useState<any | "new" | null>(null);
  const [compare, setCompare] = React.useState(false);
  const { data: list, isLoading } = useFinQuery<any[]>("/budgets");
  React.useEffect(() => { if (list && !selId) setSelId((list.find((b) => b.current && b.scope === "HOUSEHOLD") ?? list.find((b) => b.current) ?? list[0])?.id ?? null); }, [list, selId]);
  const { data: b } = useFinQuery<any>(`/budgets/${selId}`, {}, { enabled: !!selId });
  const dup = useFinMutation<any, any>("POST", (x) => `/budgets/${x.id}/duplicate`, { success: "Budget copied to the next period", onSuccess: (r) => setSelId(r.id) });
  const del = useFinMutation<any, any>("DELETE", (x) => `/budgets/${x.id}`, { success: "Budget deleted", onSuccess: () => setSelId(null) });
  return (
    <div>
      <PageHeader eyebrow="Budgets" title="Budgets" description="Set limits by category. Actual spending updates automatically from your transactions, counting each expense once." actions={<><Add label="New budget" onClick={() => setEditing("new")} />{(list?.length ?? 0) > 1 && <Button variant="outline" onClick={() => setCompare(true)}>Compare periods</Button>}</>} />
      {isLoading_(isLoading) && <div className="skeleton h-40 w-full" />}
      {list && list.length === 0 && <EmptyState title="No budgets yet" description="Create a monthly budget, add categories and limits, then record expenses. You can copy it forward each month." action={canWrite ? <Button onClick={() => setEditing("new")}>Create a budget</Button> : undefined} />}
      {list && list.length > 0 && (
        <>
          <div className="mb-5 flex flex-wrap gap-2" role="tablist" aria-label="Budgets">
            {list.slice(0, 18).map((x) => <button key={x.id} role="tab" aria-selected={selId === x.id} onClick={() => setSelId(x.id)} className={`rounded-md border px-3 py-1.5 text-sm ${selId === x.id ? "border-primary bg-primary/10 font-medium text-primary" : "border-border text-muted-foreground hover:bg-muted"}`}>{x.name}<span className="ml-1.5 text-xs opacity-70">{fmt.date(x.from)}{x.scope === "PERSONAL" ? " · personal" : ""}</span></button>)}
          </div>
          {b && (
            <div className="space-y-6">
              <section className="rounded-xl border border-border bg-card p-5" aria-label="Budget summary">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div><h2 className="display text-2xl">{b.name}</h2><p className="text-sm text-muted-foreground">{humanize(b.period)} · {fmt.date(b.from)} to {fmt.date(b.to)} · {b.scope === "PERSONAL" ? "Personal" : "Household"}</p><p className="mt-0.5 text-xs text-muted-foreground">{b.basis}</p></div>
                  <div className="flex flex-wrap gap-2">{canWrite && <><Button size="sm" variant="outline" onClick={() => setEditing(b)}><Pencil className="h-4 w-4" /> Edit</Button><Button size="sm" variant="outline" onClick={() => dup.mutate({ id: b.id })}><Copy className="h-4 w-4" /> Copy to next period</Button><Button size="sm" variant="ghost" className="text-danger" aria-label="Delete budget" onClick={async () => { if (await confirm({ title: `Delete ${b.name}?`, confirmLabel: "Delete", tone: "danger" })) del.mutate({ id: b.id }); }}><Trash2 className="h-4 w-4" /></Button></>}</div>
                </div>
                <div className="mt-5 grid gap-5 sm:grid-cols-4">
                  <Figure label="Budgeted" value={b.totals.budgeted} />
                  <Figure label="Spent" value={b.totals.actual} />
                  <Figure label="Remaining" value={<Money value={b.totals.remaining} delta size="lg" />} />
                  <Figure label="Forecast at this pace" value={b.totals.forecast} hint={b.inProgress ? "End of period" : "Period complete"} />
                </div>
                <ProgressBar className="mt-4" value={Number(b.totals.percentUsed ?? 0)} tone={Number(b.totals.percentUsed) > 100 ? "over" : Number(b.totals.percentUsed) >= 85 ? "warn" : "ok"} label="Budget used" />
                <p className="mt-1 text-xs text-muted-foreground">{b.totals.percentUsed ? `${fmt.pct(b.totals.percentUsed)} used` : "No amounts budgeted"}. Spending outside any budget category: <span className="money">{fmt.money(b.unbudgeted)}</span>.</p>
              </section>
              <Section title="Categories" description="Each category shows budgeted, actual and remaining, with the previous period for comparison." flush>
                <div className="overflow-x-auto"><table className="w-full text-sm"><caption className="sr-only">Budget by category</caption>
                  <thead><tr className="border-b border-border text-left text-[11px] uppercase tracking-[0.1em] text-muted-foreground"><th className="px-4 py-2.5 font-medium">Category</th><th className="px-4 py-2.5 text-right font-medium">Budgeted</th><th className="px-4 py-2.5 text-right font-medium">Actual</th><th className="px-4 py-2.5 text-right font-medium">Remaining</th><th className="hidden px-4 py-2.5 text-right font-medium md:table-cell">Previous</th><th className="hidden px-4 py-2.5 text-right font-medium md:table-cell">Forecast</th><th className="px-4 py-2.5 font-medium">Used</th></tr></thead>
                  <tbody>{b.lines.map((l: any) => (
                    <tr key={l.categoryId} className="border-b border-border/70 last:border-0">
                      <td className="px-4 py-3 font-medium">{l.category}{l.rollover && <span className="ml-1.5 text-xs font-normal text-muted-foreground">rollover {Number(l.carriedOver) ? `(${fmt.money(l.carriedOver, { sign: true })})` : ""}</span>}</td>
                      <td className="px-4 py-3 text-right money">{fmt.money(l.available)}</td><td className="px-4 py-3 text-right money">{fmt.money(l.actual)}</td>
                      <td className="px-4 py-3 text-right"><Money value={l.remaining} delta /></td>
                      <td className="hidden px-4 py-3 text-right money text-muted-foreground md:table-cell">{fmt.money(l.previousActual)}</td>
                      <td className={`hidden px-4 py-3 text-right money md:table-cell ${l.forecastOver ? "text-danger" : "text-muted-foreground"}`}>{fmt.money(l.forecast)}</td>
                      <td className="min-w-[9rem] px-4 py-3"><div className="flex items-center gap-2"><ProgressBar className="flex-1" value={Number(l.percentUsed ?? (Number(l.actual) > 0 ? 100 : 0))} tone={l.state === "over" || l.state === "unfunded" ? "over" : l.state === "approaching" ? "warn" : "ok"} label={`${l.category} used`} /><StatusBadge status={l.state} /></div></td>
                    </tr>))}
                  </tbody>
                </table></div>
              </Section>
            </div>
          )}
        </>
      )}
      <BudgetForm open={!!editing} existing={editing && editing !== "new" ? editing : null} onClose={() => setEditing(null)} onSaved={(id) => id && setSelId(id)} />
      <CompareModal open={compare} onClose={() => setCompare(false)} list={list ?? []} />
    </div>
  );
}
const isLoading_ = (v: boolean) => v;

function BudgetForm({ open, existing, onClose, onSaved }: { open: boolean; existing: any | null; onClose: () => void; onSaved: (id?: string) => void }) {
  const { profile } = useFin();
  const { categories } = useCategories();
  const [name, setName] = React.useState("");
  const [period, setPeriod] = React.useState("MONTHLY");
  const [scope, setScope] = React.useState("HOUSEHOLD");
  const [start, setStart] = React.useState("");
  const [end, setEnd] = React.useState("");
  const [lines, setLines] = React.useState<any[]>([]);
  const [err, setErr] = React.useState("");
  const create = useFinMutation<any, any>("POST", "/budgets", { success: "Budget saved" });
  const upd = useFinMutation<any, any>("PATCH", (x) => `/budgets/${x.id}`, { success: "Budget saved" });
  React.useEffect(() => {
    if (!open) return;
    setErr("");
    if (existing) { setName(existing.name); setPeriod(existing.period); setScope(existing.scope); setStart(existing.from); setEnd(existing.to); setLines(existing.lines.map((l: any) => ({ categoryId: l.categoryId, amount: l.budgeted, rollover: l.rollover, warnAtPct: l.warnAtPct }))); }
    else { setName("Household budget"); setPeriod(profile?.budgetPeriod ?? "MONTHLY"); setScope("HOUSEHOLD"); setStart(profile?.today ?? ""); setEnd(""); setLines([]); }
  }, [open, existing, profile]);
  const used = new Set(lines.map((l) => l.categoryId));
  const roots = categories.filter((c) => c.kind === "EXPENSE" && !c.archived);
  const save = async () => {
    setErr("");
    try {
      const body: any = { name, period, scope, startDate: start || undefined, endDate: period === "CUSTOM" ? end : undefined, lines: lines.filter((l) => l.categoryId).map((l) => ({ categoryId: l.categoryId, amount: l.amount || "0.00", rollover: !!l.rollover, warnAtPct: Number(l.warnAtPct) || 85 })) };
      const r = existing ? await upd.mutateAsync({ id: existing.id, ...body }) : await create.mutateAsync(body);
      onSaved(r.id); onClose();
    } catch (e) { setErr(e instanceof ApiError ? Object.values(e.fieldErrors)[0]?.[0] ?? e.message : (e as Error).message); }
  };
  return (
    <Modal open={open} onClose={onClose} size="lg" title={existing ? "Edit budget" : "New budget"} description="Set a limit for each category you want to track." footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} loading={create.isPending || upd.isPending}>Save budget</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        {err && <div className="sm:col-span-2"><Alert tone="danger">{err}</Alert></div>}
        <Field label="Name" required className="sm:col-span-2">{(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
        <Field label="Period">{(p) => <Select {...p} value={period} onChange={(e) => setPeriod(e.target.value)}><option value="MONTHLY">Monthly</option><option value="WEEKLY">Weekly</option><option value="ANNUAL">Annual</option><option value="CUSTOM">Custom dates</option></Select>}</Field>
        <Field label="Who it is for" hint={scope === "PERSONAL" ? "Counts only expenses you own. Visible only to you." : "Counts expenses shared with the household."}>{(p) => <Select {...p} value={scope} disabled={!!existing} onChange={(e) => setScope(e.target.value)}><option value="HOUSEHOLD">Household (shared)</option><option value="PERSONAL">Personal (only me)</option></Select>}</Field>
        <Field label={period === "CUSTOM" ? "Starts" : "A date in the period"}>{(p) => <Input {...p} type="date" value={start} onChange={(e) => setStart(e.target.value)} />}</Field>
        {period === "CUSTOM" && <Field label="Ends">{(p) => <Input {...p} type="date" value={end} onChange={(e) => setEnd(e.target.value)} />}</Field>}
      </div>
      <div className="mt-5">
        <p className="mb-2 text-sm font-medium">Category limits</p>
        <ul className="space-y-2">
          {lines.map((l, i) => (
            <li key={i} className="grid grid-cols-[1fr_7rem_auto] items-center gap-2 sm:grid-cols-[1fr_8rem_6rem_auto_auto]">
              <div className="min-w-0"><Select aria-label="Category" value={l.categoryId} onChange={(e) => setLines((s) => s.map((x, n) => (n === i ? { ...x, categoryId: e.target.value } : x)))}><option value="">Choose a category</option>{roots.filter((c) => c.id === l.categoryId || !used.has(c.id)).map((c) => <option key={c.id} value={c.id}>{c.parentId ? `${categories.find((p) => p.id === c.parentId)?.name} / ` : ""}{c.name}</option>)}</Select></div>
              <Input aria-label="Limit" inputMode="decimal" value={l.amount} onChange={(e) => setLines((s) => s.map((x, n) => (n === i ? { ...x, amount: e.target.value } : x)))} className="money text-right" placeholder="0.00" />
              <Input aria-label="Warn at percent" inputMode="numeric" value={l.warnAtPct} onChange={(e) => setLines((s) => s.map((x, n) => (n === i ? { ...x, warnAtPct: e.target.value } : x)))} className="hidden text-right sm:block" title="Warn at this percent used" placeholder="85" />
              <span className="hidden sm:block"><Checkbox label="Rollover" checked={!!l.rollover} onChange={(e) => setLines((s) => s.map((x, n) => (n === i ? { ...x, rollover: e.target.checked } : x)))} /></span>
              <Button variant="ghost" size="icon" aria-label="Remove category" onClick={() => setLines((s) => s.filter((_, n) => n !== i))}><X className="h-4 w-4" /></Button>
            </li>
          ))}
        </ul>
        <Button variant="outline" size="sm" className="mt-3" onClick={() => setLines((s) => [...s, { categoryId: "", amount: "", rollover: false, warnAtPct: 85 }])}><Plus className="h-4 w-4" /> Add category</Button>
        <p className="mt-2 text-xs text-muted-foreground">Rollover carries unspent (or overspent) money into the next period's budget. A parent category includes its subcategories unless a subcategory has its own limit.</p>
      </div>
    </Modal>
  );
}
function CompareModal({ open, onClose, list }: { open: boolean; onClose: () => void; list: any[] }) {
  const { fmt } = useFin();
  const [ids, setIds] = React.useState<string[]>([]);
  React.useEffect(() => { if (open) setIds(list.slice(0, 3).map((b) => b.id)); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const { data } = useFinQuery<any[]>("/budgets/compare", { ids: ids.join(",") }, { enabled: open && ids.length > 0 });
  return (
    <Modal open={open} onClose={onClose} title="Compare budget performance" size="lg">
      <div className="mb-4 flex flex-wrap gap-3">{list.slice(0, 12).map((b) => <Checkbox key={b.id} label={`${b.name} (${fmt.date(b.from)})`} checked={ids.includes(b.id)} onChange={(e) => setIds((s) => (e.target.checked ? [...s, b.id] : s.filter((x) => x !== b.id)))} />)}</div>
      <table className="w-full text-sm"><caption className="sr-only">Budget comparison</caption><thead><tr className="border-b border-border text-left text-xs text-muted-foreground"><th className="py-2">Budget</th><th className="py-2 text-right">Budgeted</th><th className="py-2 text-right">Actual</th><th className="py-2 text-right">Remaining</th><th className="py-2 text-right">Used</th></tr></thead>
        <tbody>{(data ?? []).map((r) => <tr key={r.id} className="border-b border-border/70"><td className="py-2">{r.name} <span className="text-xs text-muted-foreground">{fmt.date(r.from)}</span></td><td className="py-2 text-right money">{fmt.money(r.budgeted)}</td><td className="py-2 text-right money">{fmt.money(r.actual)}</td><td className="py-2 text-right"><Money value={r.remaining} delta /></td><td className="py-2 text-right money">{r.percentUsed ? fmt.pct(r.percentUsed) : "n/a"}</td></tr>)}</tbody></table>
    </Modal>
  );
}

