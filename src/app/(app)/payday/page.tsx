"use client";
import * as React from "react";
import { Alert, Button, Input, Select } from "@/components/ui/primitives";
import { useConfirm } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty";
import { useFin, useFinMutation, useFinQuery } from "@/components/finance/provider";
import { Add, FormModal, NeedsHousehold, PageHeader, Section, useAccounts } from "@/components/finance/ui";

export default function PaydayPage() {
  return <NeedsHousehold><Inner /></NeedsHousehold>;
}
type Line = { label: string; mode: "AMOUNT" | "PERCENT"; value: string; toAccountId?: string | null; goalId?: string | null };

function Inner() {
  const { fmt, canWrite, profile } = useFin();
  const confirm = useConfirm();
  const { accounts } = useAccounts();
  const { data: goals } = useFinQuery<any>("/goals", { view: "my" });
  const { data: plans, isLoading } = useFinQuery<any[]>("/payday-plans");
  const [edit, setEdit] = React.useState<any | "new" | null>(null);
  const [run, setRun] = React.useState<any | null>(null);
  const [lines, setLines] = React.useState<Line[]>([]);
  const create = useFinMutation<any, any>("POST", "/payday-plans", { success: "Plan saved" });
  const upd = useFinMutation<any, any>("PATCH", (b) => `/payday-plans/${b.id}`, { success: "Plan saved" });
  const del = useFinMutation<any, any>("DELETE", (b) => `/payday-plans/${b.id}`, { success: "Plan removed" });
  const exec = useFinMutation<any, any>("POST", (b) => `/payday-plans/${b.id}/run`, { success: "Plan run: the transfers are in your ledger" });
  const goalOpts = ((goals?.items ?? []) as any[]).filter((g: any) => g.tracking === "CONTRIBUTIONS" && g.accountId);
  React.useEffect(() => { if (edit) setLines(edit === "new" ? [{ label: "Savings", mode: "PERCENT", value: "10", toAccountId: "" }] : edit.lines); }, [edit]);
  const setLine = (i: number, p: Partial<Line>) => setLines((ls) => ls.map((l, n) => (n === i ? { ...l, ...p } : l)));
  const target = (l: Line) => (l.goalId ? `goal:${l.goalId}` : l.toAccountId ? `acct:${l.toAccountId}` : "");
  const pick = (i: number, v: string) => setLine(i, v.startsWith("goal:") ? { goalId: v.slice(5), toAccountId: null } : { toAccountId: v.slice(5), goalId: null });
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Money" title="Pay day plan" description="Split each paycheck into transfers to your savings, goals and bills account with one click. Plans are private to you." actions={canWrite ? <Add label="New plan" onClick={() => setEdit("new")} /> : undefined} />
      {isLoading ? <div className="skeleton h-40 w-full" /> : !plans?.length ? <EmptyState title="No pay day plan yet" description="For example: 10% to savings, $200 to the vacation goal, $500 to the bills account." action={canWrite ? <Button onClick={() => setEdit("new")}>Create a plan</Button> : undefined} /> : (
        <div className="grid gap-4 lg:grid-cols-2">
          {plans.map((p) => (
            <Section key={p.id} title={p.name} description={p.lastRunOn ? `Last run ${fmt.date(p.lastRunOn)}` : "Not run yet"} action={canWrite ? <div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => setEdit(p)}>Edit</Button><Button size="sm" onClick={() => setRun(p)}>Run</Button></div> : undefined}>
              <ul className="divide-y divide-border text-sm">{(p.preview?.lines ?? p.lines).map((l: any, i: number) => <li key={i} className="flex justify-between gap-3 py-1.5"><span>{l.label}<span className="text-xs text-muted-foreground"> {p.lines[i].mode === "PERCENT" ? `${p.lines[i].value}%` : ""}</span></span>{l.amount && <span className="money">{fmt.money(l.amount)}</span>}</li>)}</ul>
              {p.preview && <p className="mt-2 text-xs text-muted-foreground">Based on {fmt.money(p.expectedPaycheck)} ({p.incomeName}). Left in the account: <span className="money">{fmt.money(p.preview.leftover)}</span></p>}
            </Section>
          ))}
        </div>
      )}
      <FormModal open={!!edit} onClose={() => setEdit(null)} size="lg" title={edit === "new" ? "New pay day plan" : `Edit ${edit?.name ?? ""}`} fields={[{ name: "name", label: "Plan name", required: true, half: true }, { name: "sourceAccountId", label: "Paycheck lands in", kind: "account", required: true, half: true }]} initial={edit && edit !== "new" ? { name: edit.name, sourceAccountId: edit.sourceAccountId } : { name: "Pay day", sourceAccountId: "" }}
        footerExtra={edit && edit !== "new" ? <Button variant="ghost" className="mr-auto text-danger" onClick={async () => { if (await confirm({ title: "Remove this plan?", description: "Transfers it already made stay in your ledger.", confirmLabel: "Remove", tone: "danger" })) { del.mutate({ id: edit.id }); setEdit(null); } }}>Remove</Button> : undefined}
        onSubmit={(v) => { const body = { name: v.name, sourceAccountId: v.sourceAccountId, lines: lines.map((l) => ({ label: l.label, mode: l.mode, value: l.value, toAccountId: l.toAccountId || null, goalId: l.goalId || null })) }; return edit === "new" ? create.mutateAsync(body) : upd.mutateAsync({ id: edit.id, ...body }); }}>
        {() => (
          <div className="space-y-2">
            <p className="text-sm font-medium">Where the money goes</p>
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-12 gap-2 rounded-md border border-border p-2">
                <Input aria-label="Label" className="col-span-12 sm:col-span-3" value={l.label} onChange={(e) => setLine(i, { label: e.target.value })} placeholder="Label" />
                <Select aria-label="Type" className="col-span-5 sm:col-span-2" value={l.mode} onChange={(e) => setLine(i, { mode: e.target.value as Line["mode"] })}><option value="PERCENT">%</option><option value="AMOUNT">{profile?.currency ?? "$"}</option></Select>
                <Input aria-label="Value" inputMode="decimal" className="col-span-7 sm:col-span-2 text-right" value={l.value} onChange={(e) => setLine(i, { value: e.target.value })} />
                <Select aria-label="To" className="col-span-10 sm:col-span-4" value={target(l)} onChange={(e) => pick(i, e.target.value)}><option value="">Choose where</option><optgroup label="Accounts">{accounts.filter((a) => a.status === "ACTIVE").map((a) => <option key={a.id} value={`acct:${a.id}`}>{a.name}</option>)}</optgroup>{goalOpts.length > 0 && <optgroup label="Goals">{goalOpts.map((g) => <option key={g.id} value={`goal:${g.id}`}>{g.name}</option>)}</optgroup>}</Select>
                <Button type="button" variant="ghost" size="sm" className="col-span-2 sm:col-span-1" aria-label="Remove line" onClick={() => setLines((ls) => ls.filter((_, n) => n !== i))}>x</Button>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" onClick={() => setLines((ls) => [...ls, { label: "", mode: "AMOUNT", value: "", toAccountId: "" }])}>Add a line</Button>
          </div>
        )}
      </FormModal>
      <RunModal plan={run} onClose={() => setRun(null)} onRun={(b) => exec.mutateAsync(b)} />
    </div>
  );
}

function RunModal({ plan, onClose, onRun }: { plan: any | null; onClose: () => void; onRun: (b: any) => Promise<any> }) {
  const { profile } = useFin();
  return (
    <FormModal open={!!plan} onClose={onClose} title={`Run ${plan?.name ?? ""}`} description="Creates one transfer for each line, dated the day you choose." submitLabel="Run plan"
      fields={[{ name: "date", label: "Pay day", kind: "date", required: true, half: true }, { name: "paycheck", label: "Paycheck amount", kind: "money", half: true, hint: plan?.expectedPaycheck ? "Leave as is to use the expected pay." : "Required for this plan." }, { name: "force", label: "", kind: "checkbox", hint: "Run again even if it already ran for this date", show: () => !!plan?.lastRunOn }]}
      initial={{ date: profile?.today ?? new Date().toISOString().slice(0, 10), paycheck: plan?.expectedPaycheck ?? "", force: false }}
      onSubmit={async (v) => { await onRun({ id: plan.id, date: v.date, paycheck: v.paycheck || undefined, force: !!v.force}); }} />
  );
}
