"use client";
import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Controller } from "react-hook-form";
import { Fuel, PiggyBank, Plus, Receipt, Trash2, Pencil } from "lucide-react";
import { api, qs } from "@/lib/client/api";
import { budgetSchema, expenseUpdateSchema } from "@/lib/validation";
import { titleCase } from "@/lib/client/utils";
import { Alert, Badge, Button, Card, CardBody, CardHeader, Checkbox, Field, Input, ProgressBar, Select, Skeleton } from "@/components/ui/primitives";
import { EmptyState } from "@/components/ui/empty";
import { Modal, useConfirm } from "@/components/ui/dialog";
import { ChartCard, Lines, StackedBars } from "@/components/ui/charts";
import { useToast } from "@/components/ui/toast";
import { MoneyInput, applyApiErrors, useZodForm } from "@/components/forms";
import { useQuickAdd } from "@/components/forms/quick-dialogs";
import { EXPENSE_CATEGORIES, VehicleSelect, label } from "@/components/forms/common";
import { useFormat, useVehicles } from "@/components/shell/providers";

export function ExpensesPanel({ vehicleId, canWrite = true }: { vehicleId?: string; canWrite?: boolean }) {
  const f = useFormat();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { toast } = useToast();
  const { open } = useQuickAdd();
  const [filters, setFilters] = React.useState<Record<string, any>>({ sort: "date_desc" });
  const [page, setPage] = React.useState(1);
  const [editing, setEditing] = React.useState<any>(null);
  const set = (k: string, v: any) => { setFilters((s) => ({ ...s, [k]: v })); setPage(1); };
  const params = { vehicleId, page, pageSize: 25, ...filters };
  const { data, isLoading, isError, error } = useQuery({ queryKey: ["expenses", params], queryFn: () => api<any>(`/api/expenses${qs(params)}`) });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input type="search" aria-label="Search expenses" placeholder="Search vendor, description…" className="h-9 w-56" value={filters.q ?? ""} onChange={(e) => set("q", e.target.value)} />
        <Select aria-label="Category" className="h-9 w-auto" value={filters.category ?? ""} onChange={(e) => set("category", e.target.value)}><option value="">All categories</option>{EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{label(c)}</option>)}</Select>
        <input aria-label="From date" type="date" className="h-9 rounded-md border border-input bg-card px-2 text-sm" value={filters.from ?? ""} onChange={(e) => set("from", e.target.value)} />
        <input aria-label="To date" type="date" className="h-9 rounded-md border border-input bg-card px-2 text-sm" value={filters.to ?? ""} onChange={(e) => set("to", e.target.value)} />
        <Select aria-label="Sort" className="h-9 w-auto" value={filters.sort} onChange={(e) => set("sort", e.target.value)}><option value="date_desc">Newest</option><option value="date_asc">Oldest</option><option value="amount_desc">Largest</option><option value="amount_asc">Smallest</option></Select>
        {canWrite && <Button size="sm" className="ml-auto" onClick={() => open("expense", { vehicleId })}><Plus className="h-4 w-4" /> Add expense</Button>}
      </div>
      {isLoading ? <Skeleton className="h-48" /> : isError ? <Alert tone="warning" title="Expenses unavailable">{(error as Error).message}</Alert> : !data?.items.length ? (
        <EmptyState icon={<Receipt className="h-6 w-6" />} title="No expenses recorded" description="Services, repairs and fuel create expenses automatically. Add insurance, registration, parking and anything else manually." action={canWrite ? <Button onClick={() => open("expense", { vehicleId })}>Add an expense</Button> : undefined} />
      ) : (
        <>
          <p className="text-sm text-muted-foreground">{data.total} expense{data.total === 1 ? "" : "s"} · total <strong className="text-foreground tabular">{f.money(data.totals.amount)}</strong> (incl. {f.money(data.totals.tax)} tax)</p>
          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full text-sm"><caption className="sr-only">Expenses</caption>
              <thead><tr className="border-b border-border text-left text-xs text-muted-foreground"><th className="px-3 py-2">Date</th><th className="px-3">Category</th><th className="px-3">Vendor / description</th>{(!vehicleId || vehicleId === "all") && <th className="px-3">Vehicle</th>}<th className="px-3 text-right">Amount</th><th className="w-20" /></tr></thead>
              <tbody className="divide-y divide-border">{data.items.map((e: any) => (
                <tr key={e.id}>
                  <td className="px-3 py-2 tabular">{f.date(e.date)}</td>
                  <td className="px-3"><Badge>{label(e.category)}</Badge></td>
                  <td className="px-3"><span className="font-medium">{e.vendor ?? "n/a"}</span> <span className="text-muted-foreground">{e.description}</span>{e.linked && <Badge tone="info" className="ml-1">from {e.fuelEntryId ? "fuel" : "service"}</Badge>}</td>
                  {(!vehicleId || vehicleId === "all") && <td className="px-3 text-muted-foreground">{e.vehicleName}</td>}
                  <td className="px-3 text-right font-medium tabular">{f.money(e.amount, e.currency)}</td>
                  <td className="px-3 text-right">{canWrite && !e.linked && <><Button size="icon" variant="ghost" aria-label="Edit expense" onClick={() => setEditing(e)}><Pencil className="h-4 w-4" /></Button><Button size="icon" variant="ghost" aria-label="Delete expense" onClick={async () => { if (await confirm({ title: "Delete this expense?", confirmLabel: "Delete" })) { await api(`/api/expenses/${e.id}`, { method: "DELETE" }); toast({ title: "Expense deleted" }); void qc.invalidateQueries(); } }}><Trash2 className="h-4 w-4" /></Button></>}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <div className="flex items-center justify-end gap-2 text-sm text-muted-foreground"><Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button><span className="tabular">Page {page} of {Math.max(1, Math.ceil(data.total / data.pageSize))}</span><Button size="sm" variant="outline" disabled={page >= Math.ceil(data.total / data.pageSize)} onClick={() => setPage(page + 1)}>Next</Button></div>
        </>
      )}
      {editing && <EditExpense e={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function EditExpense({ e, onClose }: { e: any; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const form = useZodForm(expenseUpdateSchema, { date: e.date, amount: e.amount, tax: e.tax, category: e.category, vendor: e.vendor ?? "", description: e.description ?? "", paymentMethod: e.paymentMethod ?? "", notes: e.notes ?? "" });
  const [err, setErr] = React.useState("");
  const submit = form.handleSubmit(async (v) => { try { await api(`/api/expenses/${e.id}`, { method: "PATCH", body: v }); toast({ title: "Expense updated" }); void qc.invalidateQueries(); onClose(); } catch (x) { setErr(applyApiErrors(form, x)); } });
  return (
    <Modal open onClose={onClose} title="Edit expense" footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" form="edit-expense">Save</Button></>}>
      <form id="edit-expense" onSubmit={submit} className="space-y-3" noValidate>
        {err && <Alert tone="danger">{err}</Alert>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date">{(p) => <Input type="date" {...p} {...form.register("date")} />}</Field>
          <Field label="Category">{(p) => <Select {...p} {...form.register("category")}>{EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{label(c)}</option>)}</Select>}</Field>
          <Field label="Amount (incl. tax)" error={form.formState.errors.amount?.message as string}>{(p) => <Controller control={form.control} name="amount" render={({ field }) => <MoneyInput {...p} value={field.value} onChange={field.onChange} />} />}</Field>
          <Field label="Tax">{(p) => <Controller control={form.control} name="tax" render={({ field }) => <MoneyInput {...p} value={field.value} onChange={field.onChange} />} />}</Field>
        </div>
        <Field label="Vendor">{(p) => <Input {...p} {...form.register("vendor")} />}</Field>
        <Field label="Description">{(p) => <Input {...p} {...form.register("description")} />}</Field>
      </form>
    </Modal>
  );
}

// ───────────────────────── Fuel
export function FuelPanel({ vehicleId, canWrite = true }: { vehicleId?: string; canWrite?: boolean }) {
  const f = useFormat();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { toast } = useToast();
  const { open } = useQuickAdd();
  const { data: vehicles } = useVehicles();
  const [pick, setPick] = React.useState("");
  const vid = vehicleId && vehicleId !== "all" ? vehicleId : pick || vehicles?.[0]?.id;
  const stats = useQuery({ queryKey: ["fuel-stats", vid], queryFn: () => api<any>(`/api/fuel/stats?vehicleId=${vid}`), enabled: !!vid });
  const list = useQuery({ queryKey: ["fuel", vid], queryFn: () => api<any>(`/api/fuel?vehicleId=${vid}&pageSize=50`), enabled: !!vid });
  const s = stats.data;
  const showMoney = s && s.totalCost !== null;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {(!vehicleId || vehicleId === "all") && <Select aria-label="Vehicle" className="h-9 w-auto" value={vid ?? ""} onChange={(e) => setPick(e.target.value)}>{vehicles?.map((v) => <option key={v.id} value={v.id}>{v.nickname}</option>)}</Select>}
        {canWrite && <Button size="sm" className="ml-auto" onClick={() => open("fuel", { vehicleId: vid })}><Plus className="h-4 w-4" /> Add fuel</Button>}
      </div>
      {!vid ? null : stats.isLoading ? <Skeleton className="h-40" /> : s && (
        <>
          <section className="grid grid-cols-2 gap-3 md:grid-cols-4" aria-label="Fuel statistics">
            {[["Average consumption", s.avgEconomy !== null ? `${f.number(s.avgEconomy, 1)} ${s.economyUnit}` : "n/a", s.note], ["Best / worst", s.bestEconomy !== null ? `${f.number(s.bestEconomy, 1)} / ${f.number(s.worstEconomy, 1)}` : "n/a", s.economyUnit], ["Avg distance between fills", s.avgDistanceBetweenFills ? f.distance(s.avgDistanceBetweenFills) : "n/a", `${s.fillCount} fill-ups`], ["Fuel cost per distance", showMoney && s.avgCostPerKm !== null ? f.perDistance(s.avgCostPerKm) : "n/a", showMoney ? `Total ${f.money(s.totalCost, s.currency)}` : "Costs hidden"]].map(([k, v, h]) => <Card key={k} className="p-3"><p className="text-xs text-muted-foreground">{k}</p><p className="mt-1 text-lg font-semibold tabular">{v}</p><p className="text-[11px] text-muted-foreground">{h}</p></Card>)}
          </section>
          <div className="grid gap-4 lg:grid-cols-3">
            <ChartCard title="Consumption trend" unit={s.economyUnit} data={s.segments.map((x: any) => ({ date: x.date, v: Math.round(x.economy * 10) / 10 }))} columns={[{ key: "date", label: "Date" }, { key: "v", label: s.economyUnit }]} empty="Needs two or more full-tank fill-ups"><Lines data={s.segments.map((x: any) => ({ date: x.date, v: Math.round(x.economy * 10) / 10 }))} xKey="date" series={[{ key: "v", label: s.economyUnit }]} /></ChartCard>
            <ChartCard title="Monthly fuel expense" unit={s.currency} data={showMoney ? s.monthly : []} columns={[{ key: "month", label: "Month" }, { key: "total", label: "Cost" }]}><StackedBars data={s.monthly} xKey="month" series={[{ key: "total", label: "Fuel cost" }]} fmt={(v) => f.money(v, s.currency)} /></ChartCard>
            <ChartCard title="Fuel price trend" unit={`${s.currency} per litre`} data={s.priceTrend.map((p: any) => ({ date: p.date, price: Math.round(p.pricePerL * 1000) / 1000 }))} columns={[{ key: "date", label: "Date" }, { key: "price", label: "Price/L" }]}><Lines data={s.priceTrend.map((p: any) => ({ date: p.date, price: Math.round(p.pricePerL * 1000) / 1000 }))} xKey="date" series={[{ key: "price", label: "Price per litre" }]} fmt={(v) => v.toFixed(2)} /></ChartCard>
          </div>
        </>
      )}
      <Card>
        <CardHeader title="Fill-ups" />
        <CardBody>
          {list.isLoading ? <Skeleton className="h-24" /> : !list.data?.items.length ? <EmptyState icon={<Fuel className="h-6 w-6" />} title="No fuel entries" description="Log each fill-up with the odometer to see economy, cost per distance and price trends." action={canWrite ? <Button onClick={() => open("fuel", { vehicleId: vid })}>Add your first fill-up</Button> : undefined} /> : (
            <div className="overflow-x-auto"><table className="w-full text-sm"><caption className="sr-only">Fuel entries</caption><thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1.5 pr-3">Date</th><th className="pr-3">Odometer</th><th className="pr-3">Quantity</th><th className="pr-3">Cost</th><th className="pr-3">Station</th><th className="pr-3">Fill</th><th /></tr></thead><tbody className="divide-y divide-border">{list.data.items.map((e: any) => (
              <tr key={e.id}><td className="py-1.5 pr-3 tabular">{f.date(e.date)}</td><td className="pr-3 tabular">{f.distance(e.odometerKm)}</td><td className="pr-3 tabular">{f.number(e.displayQuantity, 1)} {e.displayUnit}</td><td className="pr-3 tabular">{e.totalCost != null ? f.money(e.totalCost, e.currency) : "n/a"}</td><td className="pr-3 text-muted-foreground">{e.station}</td><td className="pr-3"><Badge tone={e.fullTank ? "success" : "warning"}>{e.fullTank ? "Full" : "Partial"}</Badge>{e.missedPrevious && <Badge className="ml-1">gap</Badge>}</td><td className="text-right">{canWrite && <Button size="icon" variant="ghost" aria-label="Delete fill-up" onClick={async () => { if (await confirm({ title: "Delete this fill-up?", confirmLabel: "Delete" })) { await api(`/api/fuel/${e.id}`, { method: "DELETE" }); toast({ title: "Deleted" }); void qc.invalidateQueries(); } }}><Trash2 className="h-4 w-4" /></Button>}</td></tr>
            ))}</tbody></table></div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

// ───────────────────────── Budgets
export function BudgetsPanel({ vehicleId, canWrite = true }: { vehicleId?: string; canWrite?: boolean }) {
  const f = useFormat();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [adding, setAdding] = React.useState(false);
  const { data, isLoading } = useQuery({ queryKey: ["budgets"], queryFn: () => api<any[]>("/api/expenses/budgets") });
  const list = (data ?? []).filter((b) => !vehicleId || vehicleId === "all" || b.vehicleId === vehicleId || !b.vehicleId);
  return (
    <div className="space-y-4">
      {canWrite && <div className="flex justify-end"><Button size="sm" onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> Create budget</Button></div>}
      {isLoading ? <Skeleton className="h-32" /> : !list.length ? <EmptyState icon={<PiggyBank className="h-6 w-6" />} title="No budgets yet" description="Set a monthly or annual maintenance budget and get notified as spending approaches it." action={canWrite ? <Button onClick={() => setAdding(true)}>Create a budget</Button> : undefined} /> : (
        <ul className="grid gap-3 md:grid-cols-2">{list.map((b) => (
          <li key={b.id}><Card><CardBody className="space-y-2">
            <div className="flex items-start justify-between gap-2"><div><p className="font-medium">{b.scopeLabel}</p><p className="text-xs text-muted-foreground">{b.period === "ANNUAL" ? `Annual ${b.year}` : `${new Date(b.year, (b.month ?? 1) - 1).toLocaleString("en-CA", { month: "long" })} ${b.year}`} · {b.categories.map(label).join(", ")}</p></div><div className="flex items-center gap-1"><Badge tone={b.state === "exceeded" ? "danger" : b.state === "approaching" ? "warning" : "success"}>{b.state === "exceeded" ? "Over budget" : b.state === "approaching" ? "Approaching" : "On track"}</Badge>{canWrite && <Button size="icon" variant="ghost" aria-label="Delete budget" onClick={async () => { if (await confirm({ title: "Delete this budget?", confirmLabel: "Delete" })) { await api(`/api/expenses/budgets/${b.id}`, { method: "DELETE" }); void qc.invalidateQueries(); } }}><Trash2 className="h-4 w-4" /></Button>}</div></div>
            <ProgressBar value={b.utilizationPct} tone={b.state === "exceeded" ? "danger" : b.state === "approaching" ? "warning" : "primary"} label={`${b.utilizationPct}% of budget used`} />
            <dl className="grid grid-cols-4 gap-2 text-xs"><div><dt className="text-muted-foreground">Budget</dt><dd className="font-medium tabular">{f.money(b.budget, b.currency)}</dd></div><div><dt className="text-muted-foreground">Actual</dt><dd className="font-medium tabular">{f.money(b.actual, b.currency)}</dd></div><div><dt className="text-muted-foreground">Remaining</dt><dd className="font-medium tabular">{f.money(b.remaining, b.currency)}</dd></div><div><dt className="text-muted-foreground">Used</dt><dd className="font-medium tabular">{b.utilizationPct}%</dd></div></dl>
            <p className="text-xs text-muted-foreground">{b.projected !== null ? `Projected: ${f.money(b.projected, b.currency)} (${b.projectedPct}%). ` : ""}{b.projectionNote}</p>
          </CardBody></Card></li>
        ))}</ul>
      )}
      {adding && <BudgetDialog vehicleId={vehicleId} onClose={() => setAdding(false)} />}
    </div>
  );
}
function BudgetDialog({ vehicleId, onClose }: { vehicleId?: string; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const now = new Date();
  const form = useZodForm(budgetSchema, { vehicleId: vehicleId && vehicleId !== "all" ? vehicleId : "", period: "ANNUAL", year: now.getFullYear(), month: now.getMonth() + 1, categories: ["MAINTENANCE", "REPAIRS", "TIRES"], alertAtPercent: [80, 100] });
  const [err, setErr] = React.useState("");
  const period = form.watch("period");
  const cats: string[] = form.watch("categories") ?? [];
  const submit = form.handleSubmit(async (v) => { try { await api("/api/expenses/budgets", { method: "POST", body: { ...v, vehicleId: v.vehicleId || null } }); toast({ title: "Budget created" }); void qc.invalidateQueries(); onClose(); } catch (e) { setErr(applyApiErrors(form, e)); } });
  return (
    <Modal open onClose={onClose} title="Create budget" footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" form="budget-form">Create</Button></>}>
      <form id="budget-form" onSubmit={submit} className="space-y-3" noValidate>
        {err && <Alert tone="danger">{err}</Alert>}
        <Field label="Applies to">{(p) => <Controller control={form.control} name="vehicleId" render={({ field }) => <VehicleSelect {...p} writableOnly={false} includeNone value={field.value} onChange={field.onChange} />} />}</Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Period">{(p) => <Select {...p} {...form.register("period")}><option value="ANNUAL">Annual</option><option value="MONTHLY">Monthly</option></Select>}</Field>
          <Field label="Year">{(p) => <Input type="number" {...p} {...form.register("year")} />}</Field>
          {period === "MONTHLY" && <Field label="Month" error={form.formState.errors.month?.message as string}>{(p) => <Input type="number" min={1} max={12} {...p} {...form.register("month")} />}</Field>}
        </div>
        <Field label="Budget amount" error={form.formState.errors.amount?.message as string} required>{(p) => <Controller control={form.control} name="amount" render={({ field }) => <MoneyInput {...p} value={field.value} onChange={field.onChange} />} />}</Field>
        <div><p className="mb-1 text-sm font-medium">Counts these expense categories</p><div className="grid grid-cols-2 gap-1.5">{EXPENSE_CATEGORIES.map((c) => <Checkbox key={c} label={label(c)} checked={cats.includes(c)} onChange={(e) => form.setValue("categories", e.target.checked ? [...cats, c] : cats.filter((x) => x !== c))} />)}</div></div>
        <p className="text-xs text-muted-foreground">You'll be notified at 80% and 100% of the budget.</p>
      </form>
    </Modal>
  );
}
export { titleCase };
