"use client";
import * as React from "react";
import Link from "next/link";
import { Alert, Badge, Button } from "@/components/ui/primitives";
import { Modal, useConfirm } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { EmptyState } from "@/components/ui/empty";
import { useFin, useFinMutation, useFinQuery } from "@/components/finance/provider";
import { Add, DataTable, FormModal, MemberChip, Money, NeedsHousehold, Notice, PageHeader, Section, ViewNote, VisibilityBadge, humanize, useMembers, type Col, type FieldDef } from "@/components/finance/ui";
import { useTxDialog } from "@/components/finance/transaction-form";

const TYPES: [string, string][] = [["CHEQUING", "Chequing"], ["SAVINGS", "Savings"], ["HIGH_INTEREST_SAVINGS", "High-interest savings"], ["INVESTMENT", "Investment account"], ["CASH", "Cash"], ["OTHER_ASSET", "Other asset account"]];
const INV_KINDS: [string, string][] = [["TFSA", "TFSA"], ["RRSP", "RRSP"], ["FHSA", "FHSA"], ["RESP", "RESP"], ["NON_REGISTERED", "Non-registered"], ["PENSION", "Pension"], ["EMPLOYER_PLAN", "Employer plan"], ["OTHER", "Other"]];
const GROUPS: [string, (a: any) => boolean][] = [["Cash and savings", (a) => !a.isLiability && a.type !== "INVESTMENT" && a.type !== "OTHER_ASSET"], ["Investments", (a) => a.type === "INVESTMENT"], ["Other assets", (a) => a.type === "OTHER_ASSET"], ["Credit and loans", (a) => a.isLiability]];

export default function AccountsPage() {
  return <NeedsHousehold><Inner /></NeedsHousehold>;
}
function Inner() {
  const { fmt, view, canWrite } = useFin();
  const { members } = useMembers();
  const [edit, setEdit] = React.useState<any | "new" | null>(null);
  const [sel, setSel] = React.useState<any | null>(null);
  const { data, isLoading } = useFinQuery<any>("/accounts", { view: "all" });
  const create = useFinMutation<any, any>("POST", "/accounts", { success: "Account added" });
  const tx = useTxDialog();
  const fields: FieldDef[] = [
    { name: "name", label: "Account name", required: true },
    { name: "type", label: "Account type", kind: "select", options: TYPES, half: true },
    { name: "institution", label: "Institution", half: true },
    { name: "joint", label: "", kind: "checkbox", hint: "Joint household account (shared by everyone, always visible to the household)" },
    { name: "ownerMemberId", label: "Owner", kind: "member", show: (v) => !v.joint && members.length > 1, includeNone: "Me (default)", half: true, hint: "Only change this when setting up an account for someone else." },
    { name: "investmentKind", label: "Registered account type", kind: "select", options: INV_KINDS, show: (v) => v.type === "INVESTMENT", half: true },
    { name: "openingBalance", label: "Current balance", kind: "money", half: true, hint: "The balance today. The ledger builds from here." },
    { name: "openingDate", label: "Balance date", kind: "date", half: true },
    { name: "accountMask", label: "Last 4 digits (optional)", half: true, hint: "Only the last digits are stored." },
    { name: "currency", label: "Currency", half: true, hint: "Leave blank for the household currency." },
    { name: "notes", label: "Notes", kind: "textarea" },
  ];
  const cols = (liab: boolean): Col<any>[] => [
    { key: "n", header: "Account", primary: true, cell: (r) => <span className="flex min-w-0 flex-col"><span className="truncate font-medium">{r.name}{r.status === "CLOSED" ? " (closed)" : ""}</span><span className="truncate text-xs text-muted-foreground">{[r.institution, r.accountMask, humanize(r.type)].filter(Boolean).join(" · ")}</span></span> },
    { key: "o", header: "Owner", cell: (r) => <MemberChip member={r.owner} fallback="Joint" /> },
    { key: "v", header: "Sharing", hideOnMobile: true, cell: (r) => <VisibilityBadge visibility={r.visibility} /> },
    { key: "s", header: liab ? "Credit left" : "Available", hideOnMobile: true, align: "right", cell: (r) => (r.availableBalance ? <Money value={r.availableBalance} /> : <span className="text-muted-foreground">n/a</span>) },
    { key: "b", header: liab ? "Owed" : "Balance", align: "right", cell: (r) => <span className="flex flex-col items-end"><Money value={liab ? String(Math.abs(Number(r.currentBalance))) : r.currentBalance} currency={r.currency} />{r.valuationBased && <span className="text-[11px] text-muted-foreground">valued {fmt.date(r.valuedOn)}</span>}</span> },
  ];
  return (
    <div>
      <PageHeader eyebrow="Accounts" title="Accounts and balances" description="Balances are calculated from each account's opening balance and its transactions, so they always reconcile." actions={<><Add label="Add account" onClick={() => setEdit("new")} /><Button variant="outline" onClick={() => tx.open({ kind: "TRANSFER" })}>Transfer</Button></>} />
      <ViewNote />
      {data && data.hiddenAccountCount > 0 && <div className="mb-4"><Notice>{data.hiddenAccountCount} account{data.hiddenAccountCount === 1 ? " is" : "s are"} private to other members and not shown or included in your totals. Each member decides what they share.</Notice></div>}
      {data && (
        <section className="mb-4 grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-border bg-border sm:mb-6" aria-label="Consolidated balances">
          {[["Assets", data.totals.assets], ["Liabilities", data.totals.liabilities], ["Net", data.totals.netWorth]].map(([k, v]) => <div key={k} className="min-w-0 bg-card p-3 sm:p-4"><p className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground sm:text-[11px]">{k}</p><p className="mt-0.5 truncate text-base money sm:mt-1 sm:text-2xl">{fmt.money(v)}</p></div>)}
        </section>
      )}
      {data?.totals.unconverted?.length > 0 && <div className="mb-4"><Alert tone="warning">No exchange rate is set for: {data.totals.unconverted.join(", ")}. They are left out of the totals until you add one in Household settings.</Alert></div>}
      <div className="space-y-4 sm:space-y-6">
        {isLoading ? <div className="skeleton h-48 w-full" /> : GROUPS.map(([title, test]) => {
          const rows = data.items.filter(test);
          if (!rows.length) return null;
          return <Section key={title} title={title} flush><DataTable cols={cols(title === "Credit and loans")} rows={rows} caption={title} onRow={setSel} /></Section>;
        })}
        {data && data.items.length === 0 && <EmptyState title="No accounts yet" description="Add the accounts you use, such as chequing, savings and credit cards. Do not worry about connecting a bank: manual entry and CSV import work fully." action={canWrite ? <Button onClick={() => setEdit("new")}>Add your first account</Button> : undefined} />}
      </div>
      <p className="mt-4 text-xs text-muted-foreground">Add credit cards, loans and mortgages on the <Link href="/debts" className="text-primary underline">Debt</Link> page so their rates and payments are tracked too.</p>
      <FormModal open={edit === "new"} onClose={() => setEdit(null)} title="Add an account" fields={fields} visibility="joint-aware" initial={{ type: "CHEQUING", openingBalance: "0.00", openingDate: new Date().toISOString().slice(0, 10), joint: false }} onSubmit={(v) => create.mutateAsync({ name: v.name, type: v.type, institution: v.institution || null, joint: !!v.joint, ownerMemberId: v.ownerMemberId || undefined, openingBalance: v.openingBalance || "0.00", openingDate: v.openingDate, accountMask: v.accountMask || null, currency: v.currency ? String(v.currency).toUpperCase() : undefined, notes: v.notes || null, investmentKind: v.type === "INVESTMENT" ? v.investmentKind || "NON_REGISTERED" : undefined, visibility: v.joint ? undefined : v.visibility, sharedWithMemberIds: v.visibility === "SELECTED" ? v.sharedWithMemberIds : undefined })} />
      {sel && <AccountModal account={sel} onClose={() => setSel(null)} />}
    </div>
  );
}

function AccountModal({ account: a, onClose }: { account: any; onClose: () => void }) {
  const { fmt, canWrite } = useFin();
  const confirm = useConfirm();
  const { toast } = useToast();
  const [mode, setMode] = React.useState<null | "edit" | "balance" | "reconcile">(null);
  const upd = useFinMutation<any, any>("PATCH", `/accounts/${a.id}`, { success: "Saved" });
  const del = useFinMutation<any, any>("DELETE", `/accounts/${a.id}`, { success: "Account deleted", onSuccess: onClose });
  const bal = useFinMutation<any, any>("POST", `/accounts/${a.id}/balance`, { success: "Balance updated" });
  const rec = useFinMutation<any, any>("POST", `/accounts/${a.id}/reconcile`);
  const [recResult, setRecResult] = React.useState<any>(null);
  const { data: verify } = useFinQuery<any>(`/accounts/${a.id}/verify`);
  const tx = useTxDialog();
  return (
    <>
      <Modal open={!mode} onClose={onClose} title={a.name} description={[a.institution, humanize(a.type)].filter(Boolean).join(" · ")} size="md" footer={a.canEdit ? <>
        <Button variant="ghost" className="mr-auto text-danger" onClick={async () => { if (await confirm({ title: "Delete this account?", description: "Only accounts with no transactions can be deleted. Otherwise close it to keep history intact.", confirmLabel: "Delete", tone: "danger" })) del.mutate({}); }}>Delete</Button>
        <Button variant="outline" onClick={() => upd.mutate({ status: a.status === "ACTIVE" ? "CLOSED" : "ACTIVE" }, { onSuccess: onClose })}>{a.status === "ACTIVE" ? "Close account" : "Reopen"}</Button>
        <Button variant="outline" onClick={() => setMode("edit")}>Edit</Button>
      </> : undefined}>
        <div className="space-y-4">
          <div className="flex items-end justify-between"><div><p className="text-xs uppercase tracking-wide text-muted-foreground">{a.isLiability ? "Amount owed" : "Balance"}</p><Money value={a.isLiability ? String(Math.abs(Number(a.currentBalance))) : a.currentBalance} currency={a.currency} size="xl" /></div><div className="flex flex-col items-end gap-1"><VisibilityBadge visibility={a.visibility} count={a.sharedWithMemberIds?.length} /><MemberChip member={a.owner} fallback="Joint account" /></div></div>
          {verify && <p className={`text-xs ${verify.matches ? "text-muted-foreground" : "text-danger"}`}>{verify.matches ? "Ledger check passed: the balance equals the opening balance plus every transaction." : `Ledger check failed: engine ${verify.engine}, database ${verify.database}.`}</p>}
          {a.reconciledThrough && <p className="text-xs text-muted-foreground">Reconciled through {fmt.date(a.reconciledThrough)} against a statement balance of {fmt.money(a.statementBalance)}.</p>}
          <div className="flex flex-wrap gap-2">
            <Link href={`/transactions?accountId=${a.id}`} className="inline-flex h-9 items-center rounded-md border border-input px-3 text-sm font-medium hover:bg-muted" onClick={onClose}>View activity</Link>
            {a.canEdit && <><Button size="sm" variant="outline" onClick={() => setMode("balance")}>Update balance</Button><Button size="sm" variant="outline" onClick={() => setMode("reconcile")}>Reconcile</Button><Button size="sm" onClick={() => { onClose(); tx.open({ accountId: a.id }); }}>Add transaction</Button></>}
          </div>
          <p className="text-xs text-muted-foreground">Updating a balance records a visible adjustment for the difference. It never rewrites history, and adjustments are not counted as income or spending.</p>
        </div>
      </Modal>
      <FormModal open={mode === "edit"} onClose={() => setMode(null)} title="Edit account" visibility={a.joint ? false : true} fields={[{ name: "name", label: "Name", required: true }, { name: "institution", label: "Institution" }, { name: "accountMask", label: "Last 4 digits", half: true }, { name: "notes", label: "Notes", kind: "textarea" }]} initial={{ name: a.name, institution: a.institution ?? "", accountMask: a.accountMaskDigits ?? "", notes: a.notes ?? "", visibility: a.visibility, sharedWithMemberIds: a.sharedWithMemberIds ?? [] }} onSubmit={(v) => upd.mutateAsync({ name: v.name, institution: v.institution || null, accountMask: v.accountMask || null, notes: v.notes || null, ...(a.joint || !a.mine ? {} : { visibility: v.visibility, sharedWithMemberIds: v.visibility === "SELECTED" ? v.sharedWithMemberIds : undefined }) }).then(onClose)} />
      <FormModal open={mode === "balance"} onClose={() => setMode(null)} title="Update balance" description="Enter what the account holds today. The difference is recorded as an adjustment." fields={[{ name: "balance", label: a.isLiability ? "Balance (negative means you owe)" : "Balance", kind: "money", required: true }, { name: "date", label: "As of", kind: "date" }, { name: "note", label: "Note", kind: "textarea" }]} initial={{ balance: a.currentBalance, date: new Date().toISOString().slice(0, 10) }} onSubmit={(v) => bal.mutateAsync({ balance: v.balance, date: v.date, note: v.note || null }).then(onClose)} />
      <FormModal open={mode === "reconcile"} onClose={() => { setMode(null); setRecResult(null); }} title="Reconcile with a statement" description="Compare the ledger with your statement. If they agree, the transactions up to that date are marked reconciled." fields={[{ name: "statementDate", label: "Statement date", kind: "date", required: true, half: true }, { name: "statementBalance", label: "Statement balance", kind: "money", required: true, half: true }, { name: "createAdjustment", label: "", kind: "checkbox", hint: "If there is a difference, record an adjustment for it" }]} initial={{ statementDate: new Date().toISOString().slice(0, 10), statementBalance: a.currentBalance, createAdjustment: false }} submitLabel="Reconcile" onSubmit={async (v) => { const r = await rec.mutateAsync(v); if (!r.reconciled) { setRecResult(r); throw new Error(`The ledger shows ${fmt.money(r.ledgerBalance)} but the statement shows ${fmt.money(r.statementBalance)}, a difference of ${fmt.money(r.difference)}. Check for missing transactions, or tick the adjustment box.`); } toast({ title: "Reconciled", description: `${r.markedReconciled} transactions marked reconciled.` }); }} />
    </>
  );
}
