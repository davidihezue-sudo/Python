"use client";
// Add / edit a transaction. The owner and the person who entered it default to the signed-in user; payer and allocation are explicit.
import * as React from "react";
import { z } from "zod";
import { Alert, Button, Checkbox, Field, Input, Select, Textarea } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/dialog";
import { ApiError } from "@/lib/client/api";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/client/api";
import { finApi, useFin, useFinMutation, useFinQuery } from "./provider";
import { AccountSelect, CategorySelect, FREQ_OPTIONS, MemberSelect, VehicleSelect, VisibilityField, useAccounts, useMembers, useVehicleOptions } from "./ui";

export type TxKind = "EXPENSE" | "INCOME" | "REFUND" | "REIMBURSEMENT" | "TRANSFER";
interface Preset { kind?: TxKind; accountId?: string; categoryId?: string; description?: string; amount?: string; id?: string; initial?: any }

const KIND_LABEL: Record<TxKind, string> = { EXPENSE: "Expense", INCOME: "Income", REFUND: "Refund", REIMBURSEMENT: "Reimbursement", TRANSFER: "Transfer between accounts" };
const KIND_HELP: Record<TxKind, string> = {
  EXPENSE: "Money spent. Recorded once, however it is shared.",
  INCOME: "Money received, such as pay. Use the net (after tax) amount.",
  REFUND: "Money returned by a merchant. It reduces the category it belongs to.",
  REIMBURSEMENT: "Money paid back to you for something you paid for. It reduces that expense category.",
  TRANSFER: "Moves money between your accounts. Credit card payments and savings deposits are transfers, so they are not counted as spending or income.",
};

interface Ctx { open: (p?: Preset) => void }
const TxCtx = React.createContext<Ctx>({ open: () => undefined });
export const useTxDialog = () => React.useContext(TxCtx);

export function TxDialogProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<{ preset: Preset; n: number } | null>(null);
  const open = React.useCallback((preset: Preset = {}) => setState((s) => ({ preset, n: (s?.n ?? 0) + 1 })), []);
  return (
    <TxCtx.Provider value={{ open }}>
      {children}
      {state && <TransactionDialog key={state.n} preset={state.preset} onClose={() => setState(null)} />}
    </TxCtx.Provider>
  );
}

const today = () => new Date().toISOString().slice(0, 10);

export function TransactionDialog({ preset, onClose }: { preset: Preset; onClose: () => void }) {
  const { profile, fmt, hid } = useFin();
  const { members } = useMembers();
  const { toast } = useToast();
  const vehicles = useVehicleOptions();
  const { accounts } = useAccounts();
  const editing = !!preset.id;
  const init = preset.initial;
  const [kind, setKind] = React.useState<TxKind>(init?.type ?? preset.kind ?? "EXPENSE");
  const [v, setV] = React.useState<Record<string, any>>(() => ({
    accountId: init?.accountId ?? preset.accountId ?? "", toAccountId: "", amount: init ? String(Math.abs(Number(init.amount))) : preset.amount ?? "", toAmount: "", date: init?.date ?? profile?.today ?? today(), description: init?.description ?? preset.description ?? "", categoryId: init?.categoryId ?? preset.categoryId ?? "", merchant: init?.merchant ?? "", vehicleId: init?.vehicleId ?? "", notes: init?.notes ?? "", tags: (init?.tags ?? []).join(", "),
    status: init?.status ?? "POSTED", assignTo: "", payer: init ? (init.paidByHousehold ? "HOUSEHOLD" : init.payer?.id ?? "") : "", allocMode: init?.allocationMode ?? "", allocMember: init?.allocations?.[0]?.memberId ?? "", splitKind: init?.allocationMode === "SPLIT" ? (init.allocations.every((a: any) => a.percent && Number(a.percent) !== 100 && false) ? "percent" : "amount") : "equal",
    repeat: "", repeatEnd: "", autoPost: true,
    splits: init?.allocationMode === "SPLIT" ? init.allocations.map((a: any) => ({ memberId: a.memberId, percent: a.percent ?? "", amount: a.amount })) : [], visibility: init?.visibility ?? undefined, sharedWithMemberIds: init?.sharedWithMemberIds ?? [],
  }));
  const [errors, setErrors] = React.useState<Record<string, string[]>>({});
  const [general, setGeneral] = React.useState("");
  const [dup, setDup] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [showMore, setShowMore] = React.useState(false);
  const [receipt, setReceipt] = React.useState<File | null>(null);
  const [scanning, setScanning] = React.useState(false);
  const [scanNote, setScanNote] = React.useState("");
  const set = (k: string, x: any) => setV((s) => ({ ...s, [k]: x }));
  const create = useFinMutation<any, any>("POST", (b) => (b.__transfer ? "/transfers" : "/transactions"), { success: "Saved" });
  const patch = useFinMutation<any, any>("PATCH", (b) => `/transactions/${preset.id}`, { success: "Saved" });
  const acct = accounts.find((a) => a.id === v.accountId);
  const toAcct = accounts.find((a) => a.id === v.toAccountId);
  const joint = !!acct?.joint;
  React.useEffect(() => { if (!editing && !v.accountId && accounts.length) { const mine = accounts.find((a) => a.mine && a.isLiquid && a.status === "ACTIVE") ?? accounts.find((a) => a.status === "ACTIVE"); if (mine) set("accountId", mine.id); } }, [accounts]); // eslint-disable-line react-hooks/exhaustive-deps
  const allocatable = kind === "EXPENSE" || kind === "REFUND" || kind === "REIMBURSEMENT";
  const defaultMode = joint ? "HOUSEHOLD" : "OWNER";
  const mode = v.allocMode || defaultMode;

  const buildAllocation = () => {
    if (!allocatable) return undefined;
    if (mode === "SPLIT") {
      const rows = (v.splits.length ? v.splits : members.map((m) => ({ memberId: m.id, percent: "", amount: "" })));
      if (v.splitKind === "equal") return { mode: "SPLIT", splits: rows.map((r: any) => ({ memberId: r.memberId })) };
      if (v.splitKind === "percent") return { mode: "SPLIT", splits: rows.map((r: any) => ({ memberId: r.memberId, percent: Number(r.percent || 0) })) };
      return { mode: "SPLIT", splits: rows.map((r: any) => ({ memberId: r.memberId, amount: r.amount || "0.00" })) };
    }
    if (mode === "MEMBER") return { mode: "MEMBER", memberId: v.allocMember };
    return { mode };
  };
  /** Photo or PDF of a receipt: fills in what it can read, never saves anything. The person checks the values and saves as usual. */
  const scan = async (f: File | undefined) => {
    if (!f) return;
    setReceipt(f); setScanning(true); setScanNote("");
    try {
      const form = new FormData(); form.set("file", f);
      const r = await api<any>(`/api/finance/${hid}/receipts/scan`, { method: "POST", body: form });
      if (!r.candidates) { setScanNote(r.reason ?? "The receipt could not be read. Enter the details yourself. The photo will still be attached."); return; }
      const c = r.candidates;
      setV((x) => ({ ...x, amount: x.amount || c.total || "", date: c.date && !editing ? c.date : x.date, description: x.description || c.merchant || "", merchant: x.merchant || c.merchant || "" }));
      setScanNote(`Read from the receipt${c.total ? "" : " (no total found)"}. Please check every value.`);
    } catch (e) { setScanNote((e as Error).message); } finally { setScanning(false); }
  };
  const submit = async (e: React.FormEvent, force = false) => {
    e.preventDefault();
    setBusy(true); setErrors({}); setGeneral(""); setDup(false);
    try {
      let createdId: string | undefined;
      if (kind === "TRANSFER") {
        await create.mutateAsync({ __transfer: true, fromAccountId: v.accountId, toAccountId: v.toAccountId, amount: v.amount, ...(acct && toAcct && acct.currency !== toAcct.currency ? { toAmount: v.toAmount } : {}), date: v.date, description: v.description || "Transfer", notes: v.notes || undefined });
      } else {
        const body: any = { type: kind, accountId: v.accountId, amount: v.amount, date: v.date, description: v.description, categoryId: v.categoryId || null, vehicleId: v.vehicleId || null, merchant: v.merchant || undefined, notes: v.notes || undefined, tags: String(v.tags ?? "").split(",").map((t: string) => t.trim()).filter(Boolean), status: v.status, allocation: buildAllocation(), visibility: v.visibility, sharedWithMemberIds: v.visibility === "SELECTED" ? v.sharedWithMemberIds : undefined, force: force || undefined };
        if (v.assignTo) body.assignToMemberId = v.assignTo;
        if (v.payer) body.payer = v.payer;
        if (editing) await patch.mutateAsync({ ...body, type: undefined, force: undefined });
        else if (v.repeat && (kind === "INCOME" || kind === "EXPENSE")) {
          // The rule starts from this entry (marked as already posted), so the first one is not duplicated and later ones follow the schedule.
          const rule = await finApi<{ id: string }>(hid as string, "/recurring", { method: "POST", body: { type: kind, description: v.description, amount: v.amount, accountId: v.accountId, categoryId: v.categoryId || null, merchantName: v.merchant || null, frequency: v.repeat, startDate: v.date, endDate: v.repeatEnd || null, autoPost: !!v.autoPost, lastPostedOn: v.date, visibility: v.visibility, sharedWithMemberIds: v.visibility === "SELECTED" ? v.sharedWithMemberIds : undefined } });
          try { createdId = (await create.mutateAsync({ ...body, recurringRuleId: rule.id }))?.id; } catch (e) { await finApi(hid as string, `/recurring/${rule.id}`, { method: "DELETE" }).catch(() => undefined); throw e; }
        } else {
          const r = await create.mutateAsync(body);
          createdId = r?.id;
          const n = r?.nudge;
          if (n) toast({ title: n.over ? `Over budget: ${n.category}` : `${n.percentUsed}% of ${n.category} budget used`, description: n.over ? `${n.budget} is over by ${fmt.money(String(Math.abs(Number(n.remaining))))}.` : `${fmt.money(n.remaining)} left in ${n.budget}.`, variant: "error" });
        }
      }
      if (receipt && createdId) {
        try { const form = new FormData(); form.set("file", receipt); form.set("entity", "transaction"); form.set("entityId", createdId); await api(`/api/finance/${hid}/documents`, { method: "POST", body: form }); toast({ title: "Receipt attached" }); }
        catch { toast({ title: "Saved, but the receipt could not be attached", description: "You can attach it from the Receipts page.", variant: "error" }); }
      }
      onClose();
    } catch (x) {
      if (x instanceof ApiError) {
        if (x.code === "DUPLICATE_RECORD") setDup(true);
        setErrors(x.fieldErrors);
        setGeneral(x.code === "DUPLICATE_RECORD" ? x.message : Object.keys(x.fieldErrors).length ? "Please check the highlighted fields." : x.message);
      } else setGeneral((x as Error).message);
    } finally { setBusy(false); }
  };
  const err = (k: string) => errors[k];
  const rows = v.splits.length ? v.splits : members.map((m) => ({ memberId: m.id, percent: "", amount: "" }));
  const setRow = (i: number, k: string, x: any) => set("splits", rows.map((r: any, n: number) => (n === i ? { ...r, [k]: x } : r)));

  return (
    <Modal open onClose={onClose} title={editing ? "Edit transaction" : "Add a transaction"} description={KIND_HELP[kind]} size="lg" footer={<><Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>{dup && <Button variant="secondary" onClick={(e) => submit(e as never, true)} loading={busy}>Save anyway</Button>}<Button type="submit" form="tx-form" loading={busy}>{editing ? "Save changes" : "Save"}</Button></>}>
      <form id="tx-form" onSubmit={(e) => submit(e)} className="grid gap-4 sm:grid-cols-2" noValidate>
        {general && <div className="sm:col-span-2"><Alert tone={dup ? "warning" : "danger"}>{general}</Alert></div>}
        {!editing && (
          <div className="sm:col-span-2" role="tablist" aria-label="Transaction type">
            <div className="flex flex-wrap gap-1.5">
              {(["EXPENSE", "INCOME", "TRANSFER", "REFUND", "REIMBURSEMENT"] as TxKind[]).map((k) => (
                <button key={k} type="button" role="tab" aria-selected={kind === k} onClick={() => setKind(k)} className={`rounded-md border px-3 py-1.5 text-sm font-medium ${kind === k ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted"}`}>{KIND_LABEL[k].split(" ")[0]}</button>
              ))}
            </div>
          </div>
        )}
        {!editing && kind === "EXPENSE" && (
          <div className="sm:col-span-2 rounded-md border border-dashed border-border p-3">
            <label className="flex cursor-pointer flex-wrap items-center gap-3 text-sm font-medium text-primary">
              <input type="file" accept="image/*,application/pdf" capture="environment" className="sr-only" onChange={(e) => void scan(e.target.files?.[0])} />
              <span className="inline-flex h-9 items-center rounded-md border border-input bg-card px-3 hover:bg-muted">{scanning ? "Reading receipt..." : receipt ? "Choose another receipt" : "Scan a receipt"}</span>
              {receipt && <span className="text-xs font-normal text-muted-foreground">{receipt.name}</span>}
            </label>
            {scanNote && <p className="mt-2 text-xs text-muted-foreground" role="status">{scanNote}</p>}
            {!receipt && <p className="mt-1 text-xs text-muted-foreground">Take a photo or pick a file. It is attached to this transaction when you save and is as private as the transaction.</p>}
          </div>
        )}
        <Field label="Amount" required error={err("amount")}>{(p) => <Input {...p} inputMode="decimal" autoFocus autoComplete="off" value={v.amount} onChange={(e) => set("amount", e.target.value)} placeholder="0.00" className="money text-right text-lg" />}</Field>
        <Field label="Date" required error={err("date")}>{(p) => <Input {...p} type="date" value={v.date} onChange={(e) => set("date", e.target.value)} />}</Field>
        {!editing && (kind === "INCOME" || kind === "EXPENSE") && (
          <>
            <Field label="Repeats" hint="For rent, salary, subscriptions and other regular payments.">{(p) => <Select {...p} value={v.repeat} onChange={(e) => set("repeat", e.target.value)}><option value="">Does not repeat</option>{FREQ_OPTIONS.filter(([k]) => k !== "ONE_TIME" && k !== "IRREGULAR").map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>}</Field>
            {v.repeat && <Field label="Stops on (optional)">{(p) => <Input {...p} type="date" value={v.repeatEnd} onChange={(e) => set("repeatEnd", e.target.value)} />}</Field>}
            {v.repeat && <div className="sm:col-span-2"><Checkbox checked={!!v.autoPost} onChange={(e) => set("autoPost", e.target.checked)} label="Record the future ones automatically on their dates" /><p className="mt-1 text-xs text-muted-foreground">Future entries use the same account, category and amount. If you turn this off they show up as due and you post them with one click under Expenses, Recurring.</p></div>}
          </>
        )}
        {kind === "TRANSFER" ? (
          <>
            <Field label="From account" required error={err("fromAccountId")}>{(p) => <AccountSelect id={p.id} value={v.accountId} onChange={(x) => set("accountId", x)} />}</Field>
            <Field label="To account" required error={err("toAccountId")}>{(p) => <AccountSelect id={p.id} value={v.toAccountId} onChange={(x) => set("toAccountId", x)} filter={(a) => a.id !== v.accountId} />}</Field>
            {acct && toAcct && acct.currency !== toAcct.currency && <Field label={`Amount received (${toAcct.currency})`} required error={err("toAmount")}>{(p) => <Input {...p} inputMode="decimal" value={v.toAmount} onChange={(e) => set("toAmount", e.target.value)} className="money text-right" />}</Field>}
            <Field label="Description" error={err("description")} className="sm:col-span-2">{(p) => <Input {...p} value={v.description} onChange={(e) => set("description", e.target.value)} placeholder="e.g. Credit card payment, savings deposit" />}</Field>
          </>
        ) : (
          <>
            <Field label="Description" required error={err("description")} className="sm:col-span-2">{(p) => <Input {...p} value={v.description} onChange={(e) => set("description", e.target.value)} placeholder={kind === "INCOME" ? "e.g. Salary" : "e.g. Supermarket"} />}</Field>
            <Field label={kind === "INCOME" ? "Deposited into" : "Paid from"} required error={err("accountId")}>{(p) => <AccountSelect id={p.id} value={v.accountId} onChange={(x) => set("accountId", x)} />}</Field>
            <Field label="Category" error={err("categoryId")}>{(p) => <CategorySelect id={p.id} value={v.categoryId} onChange={(x) => set("categoryId", x)} kind={kind === "INCOME" ? "INCOME" : "EXPENSE"} />}</Field>
            {(kind === "EXPENSE" || kind === "REFUND") && (vehicles.data?.length ?? 0) > 0 && <Field label="Vehicle" hint="Optional. Counts toward that vehicle's running costs.">{(p) => <VehicleSelect id={p.id} value={v.vehicleId} onChange={(x) => set("vehicleId", x)} />}</Field>}
          </>
        )}
        {allocatable && (
          <fieldset className="sm:col-span-2 rounded-lg border border-border p-3">
            <legend className="px-1 text-sm font-medium">Who paid, and who it is for</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Paid by" hint="The person who actually paid. Joint accounts are paid by the household.">{(p) => (
                <Select {...p} value={v.payer} onChange={(e) => set("payer", e.target.value)}>
                  <option value="">{joint ? "The household (joint account)" : "Me (default)"}</option>
                  {joint ? null : <option value="HOUSEHOLD">The household</option>}
                  {members.filter((m) => !m.isMe).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  {joint && members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </Select>
              )}</Field>
              <Field label="Allocated to" hint="Who this cost belongs to. It is still counted once in household totals.">{(p) => (
                <Select {...p} value={mode} onChange={(e) => set("allocMode", e.target.value)}>
                  <option value="OWNER">Me</option>
                  <option value="HOUSEHOLD">The whole household (shared)</option>
                  <option value="MEMBER">Another member</option>
                  <option value="SPLIT">Split between members</option>
                </Select>
              )}</Field>
              {mode === "MEMBER" && <Field label="Member" error={err("allocation")}>{(p) => <MemberSelect id={p.id} value={v.allocMember} onChange={(x) => set("allocMember", x)} includeNone="Choose a member" />}</Field>}
              {mode === "SPLIT" && (
                <div className="sm:col-span-2 space-y-2">
                  <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Split method">
                    {[["equal", "Equally"], ["percent", "By percentage"], ["amount", "By amount"]].map(([k, l]) => <label key={k} className="flex items-center gap-1.5 text-sm"><input type="radio" className="accent-[rgb(var(--primary))]" checked={v.splitKind === k} onChange={() => set("splitKind", k)} />{l}</label>)}
                  </div>
                  {v.splitKind !== "equal" && rows.map((r: any, i: number) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className="w-32 truncate text-sm">{r.memberId ? members.find((m) => m.id === r.memberId)?.name : "Household"}</span>
                      <Input aria-label={`${v.splitKind === "percent" ? "Percent" : "Amount"} for ${r.memberId ? members.find((m) => m.id === r.memberId)?.name : "household"}`} inputMode="decimal" value={v.splitKind === "percent" ? r.percent : r.amount} onChange={(e) => setRow(i, v.splitKind === "percent" ? "percent" : "amount", e.target.value)} className="money w-28 text-right" placeholder={v.splitKind === "percent" ? "%" : "0.00"} />
                      <span className="text-xs text-muted-foreground">{v.splitKind === "percent" ? "%" : fmt.currency}</span>
                    </div>
                  ))}
                  {v.splitKind === "percent" && <p className="text-xs text-muted-foreground">Percentages must add up to 100. Now: {rows.reduce((a: number, r: any) => a + Number(r.percent || 0), 0)}%.</p>}
                  {v.splitKind === "amount" && <p className="text-xs text-muted-foreground">Amounts must add up to {fmt.money(v.amount || 0)}. Now: {fmt.money(rows.reduce((a: number, r: any) => a + Number(r.amount || 0), 0))}.</p>}
                  {errors.allocation && <p role="alert" className="text-xs text-danger">{errors.allocation[0]}</p>}
                </div>
              )}
            </div>
          </fieldset>
        )}
        <div className="sm:col-span-2"><button type="button" className="text-sm font-medium text-primary hover:underline" aria-expanded={showMore} onClick={() => setShowMore((s) => !s)}>{showMore ? "Hide" : "Show"} more options (merchant, notes, sharing, record for someone else)</button></div>
        {showMore && (
          <>
            {kind !== "TRANSFER" && <Field label="Merchant" error={err("merchant")}>{(p) => <Input {...p} value={v.merchant} onChange={(e) => set("merchant", e.target.value)} />}</Field>}
            {kind !== "TRANSFER" && !editing && <Field label="Status" hint="Expected items do not change balances or reports until posted.">{(p) => <Select {...p} value={v.status} onChange={(e) => set("status", e.target.value)}><option value="POSTED">Posted (it happened)</option><option value="PLANNED">Expected (planned)</option></Select>}</Field>}
            {members.length > 1 && !editing && <Field label="Record this for another member" hint="Default is you. Only use this when entering on someone's behalf.">{(p) => <MemberSelect id={p.id} value={v.assignTo} onChange={(x) => set("assignTo", x)} includeNone="Me (default)" />}</Field>}
            {kind !== "TRANSFER" && <Field label="Tags" hint="Separate with commas, for example: vacation, tax-deductible">{(p) => <Input {...p} value={v.tags} onChange={(e) => set("tags", e.target.value)} />}</Field>}
            <Field label="Notes" className="sm:col-span-2">{(p) => <Textarea {...p} value={v.notes} onChange={(e) => set("notes", e.target.value)} />}</Field>
            {kind !== "TRANSFER" && <div className="sm:col-span-2"><VisibilityField value={v.visibility ?? "HOUSEHOLD"} shared={v.sharedWithMemberIds} onChange={(x) => setV((s) => ({ ...s, ...x }))} lockedHousehold={false} /></div>}
          </>
        )}
        {!showMore && <p className="sm:col-span-2 text-xs text-muted-foreground">{v.visibility === "PERSONAL" ? "Only you will see this." : "Shared with the household by default. Open more options to keep it private."}</p>}
      </form>
    </Modal>
  );
}
export { Checkbox };
