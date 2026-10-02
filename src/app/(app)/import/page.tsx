"use client";
import * as React from "react";
import { Download, Upload } from "lucide-react";
import { Button, Field, Select } from "@/components/ui/primitives";
import { useConfirm } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { EmptyState } from "@/components/ui/empty";
import { api, ApiError } from "@/lib/client/api";
import { useFin, useFinMutation, useFinQuery } from "@/components/finance/provider";
import { AccountSelect, DataTable, NeedsHousehold, Notice, PageHeader, Section, StatusBadge, humanize, type Col } from "@/components/finance/ui";

const MAP_FIELDS: [string, string][] = [["date", "Date"], ["description", "Description"], ["amount", "Amount (one column)"], ["debit", "Debit (money out)"], ["credit", "Credit (money in)"], ["type", "Type"], ["category", "Category"]];
const EXPORTS: [string, string][] = [["transactions", "Transactions"], ["income", "Income"], ["accounts", "Accounts"], ["budgets", "Budgets"], ["debts", "Debts"], ["goals", "Goals"]];

export default function ImportPage() {
  return <NeedsHousehold><Inner /></NeedsHousehold>;
}
function Inner() {
  const { hid, fmt, canWrite } = useFin();
  const { toast } = useToast();
  const confirm = useConfirm();
  const [csv, setCsv] = React.useState("");
  const [fileName, setFileName] = React.useState("");
  const [preview, setPreview] = React.useState<any>(null);
  const [mapping, setMapping] = React.useState<any>(null);
  const [accountId, setAccountId] = React.useState("");
  const [analysis, setAnalysis] = React.useState<any>(null);
  const [rows, setRows] = React.useState<any[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState("");
  const [result, setResult] = React.useState<any>(null);
  const [exportView, setExportView] = React.useState("my");
  const batches = useFinQuery<any[]>("/import/batches");
  const undo = useFinMutation<any, any>("POST", (b) => `/import/batches/${b.id}/undo`, { success: "Import undone" });
  const cats = useFinQuery<any[]>("/categories");

  const run = async <T,>(fn: () => Promise<T>) => { setBusy(true); setErr(""); try { return await fn(); } catch (e) { setErr(e instanceof ApiError ? e.message : (e as Error).message); } finally { setBusy(false); } };
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 6_000_000) { setErr("That file is larger than 6 MB. Split it by date range."); return; }
    const text = await f.text();
    setCsv(text); setFileName(f.name); setAnalysis(null); setResult(null);
    const p = await run(() => api<any>(`/api/finance/${hid}/import/preview`, { method: "POST", body: { csv: text } }));
    if (p) { setPreview(p); setMapping(p.suggestedMapping); }
  };
  const analyze = async () => {
    const a = await run(() => api<any>(`/api/finance/${hid}/import/analyze`, { method: "POST", body: { csv, mapping, accountId } }));
    if (a) { setAnalysis(a); setRows(a.rows); }
  };
  const commit = async () => {
    const todo = rows.filter((r) => r.type !== "SKIP" && r.date && r.amount);
    if (!(await confirm({ title: `Import ${todo.length} transactions?`, description: "They are posted to the selected account. You can undo the whole import afterwards.", confirmLabel: "Import" }))) return;
    const r = await run(() => api<any>(`/api/finance/${hid}/import/commit`, { method: "POST", body: { accountId, fileName, mapping, rows: rows.map((x) => ({ line: x.line, date: x.date ?? "2000-01-01", description: x.description || "Imported", amount: x.amount ?? "0", type: !x.date || !x.amount ? "SKIP" : x.type, categoryId: x.categoryId, key: x.key, duplicate: x.duplicate })) } }));
    if (r) { setResult(r); setAnalysis(null); setPreview(null); setCsv(""); toast({ title: `${r.imported} imported`, description: `${r.duplicates} duplicates skipped.` }); void batches.refetch(); }
  };
  const setRow = (line: number, patch: any) => setRows((rs) => rs.map((r) => (r.line === line ? { ...r, ...patch } : r)));
  const bcols: Col<any>[] = [
    { key: "f", header: "File", primary: true, cell: (r) => r.fileName },
    { key: "d", header: "When", cell: (r) => fmt.date(r.createdAt) },
    { key: "n", header: "Imported", align: "right", cell: (r) => `${r.imported} of ${r.rowCount}` },
    { key: "s", header: "Status", cell: (r) => <StatusBadge status={r.status} /> },
    { key: "u", header: "", align: "right", cell: (r) => r.status !== "UNDONE" && canWrite ? <Button size="sm" variant="outline" onClick={async () => { if (await confirm({ title: "Undo this import?", description: "Every transaction it created is removed.", confirmLabel: "Undo import" })) undo.mutate(r); }}>Undo</Button> : null },
  ];
  return (
    <div>
      <PageHeader eyebrow="Data" title="Import and export" description="Bring in bank or card CSV files, review every row before anything is saved, and export your records at any time." />
      {err && <div className="mb-4"><Notice tone="danger">{err}</Notice></div>}
      {result && <div className="mb-4"><Notice tone="success" title="Import complete">{result.imported} imported, {result.duplicates} duplicates skipped, {result.skipped} skipped, {result.failed} failed.{result.problems?.length > 0 && ` Problems: ${result.problems.map((p: any) => `line ${p.line}: ${p.reason}`).join("; ")}`}</Notice></div>}
      {canWrite && (
        <Section title="1. Choose a CSV file" description="Works with any bank export. Nothing is saved until you confirm on step 3.">
          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed border-border p-6 text-sm hover:bg-muted/50"><Upload className="h-5 w-5" aria-hidden /><span>{fileName || "Select a .csv file"}</span><input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => void onFile(e.target.files?.[0])} /></label>
        </Section>
      )}
      {preview && mapping && (
        <div className="mt-5"><Section title="2. Match the columns and pick the account" description={`${preview.rowCount} rows found. We guessed the mapping; correct it if needed.`}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {MAP_FIELDS.map(([k, l]) => <Field key={k} label={l}>{(p) => <Select id={p.id} value={mapping[k] ?? ""} onChange={(e) => setMapping({ ...mapping, [k]: e.target.value === "" ? null : Number(e.target.value) })}><option value="">Not in file</option>{preview.headers.map((h: string, i: number) => <option key={i} value={i}>{h}</option>)}</Select>}</Field>)}
            <Field label="Date order">{(p) => <Select id={p.id} value={mapping.dateOrder} onChange={(e) => setMapping({ ...mapping, dateOrder: e.target.value })}><option value="YMD">Year, month, day</option><option value="DMY">Day, month, year</option><option value="MDY">Month, day, year</option></Select>}</Field>
            <Field label="Into account">{(p) => <AccountSelect id={p.id} value={accountId} onChange={setAccountId} filter={(a) => a.canEdit !== false} includeNone="Choose an account" />}</Field>
          </div>
          <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={!!mapping.invertSign} onChange={(e) => setMapping({ ...mapping, invertSign: e.target.checked })} />Amounts are shown with the opposite sign (expenses positive)</label>
          <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[480px] text-xs"><caption className="sr-only">File sample</caption><thead><tr>{preview.headers.map((h: string, i: number) => <th key={i} scope="col" className="px-2 py-1 text-left font-medium text-muted-foreground">{h}</th>)}</tr></thead><tbody>{preview.sample.slice(0, 5).map((r: string[], i: number) => <tr key={i}>{r.map((c, j) => <td key={j} className="px-2 py-1">{c}</td>)}</tr>)}</tbody></table></div>
          <div className="mt-4"><Button onClick={analyze} loading={busy} disabled={!accountId}>Review rows</Button></div>
        </Section></div>
      )}
      {analysis && (
        <div className="mt-5"><Section title="3. Review and import" description={`${analysis.summary.ready} of ${analysis.summary.total} rows ready. ${analysis.summary.duplicates} look like duplicates and are skipped. ${analysis.summary.possibleTransfers} may be transfers.`}>
          {analysis.notes?.map((n: string) => <p key={n} className="mb-2 text-xs text-muted-foreground">{n}</p>)}
          <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-sm"><caption className="sr-only">Rows to import</caption>
            <thead><tr className="border-b border-border text-left text-xs text-muted-foreground"><th scope="col" className="px-2 py-2">Date</th><th scope="col" className="px-2 py-2">Description</th><th scope="col" className="px-2 py-2 text-right">Amount</th><th scope="col" className="px-2 py-2">Treat as</th><th scope="col" className="px-2 py-2">Category</th><th scope="col" className="px-2 py-2">Notes</th></tr></thead>
            <tbody>{rows.slice(0, 300).map((r) => (
              <tr key={r.line} className={`border-b border-border/60 ${r.type === "SKIP" ? "opacity-60" : ""}`}>
                <td className="px-2 py-1.5 tabular">{r.date ? fmt.date(r.date) : "n/a"}</td><td className="px-2 py-1.5">{r.description}</td><td className="money px-2 py-1.5 text-right">{r.amount ? fmt.money(r.amount) : "n/a"}</td>
                <td className="px-2 py-1.5"><Select aria-label={`Line ${r.line} type`} value={r.type} onChange={(e) => setRow(r.line, { type: e.target.value })} className="h-8 w-28">{analysis.typeOptions.map((t: string) => <option key={t} value={t}>{humanize(t)}</option>)}</Select></td>
                <td className="px-2 py-1.5"><Select aria-label={`Line ${r.line} category`} value={r.categoryId ?? ""} onChange={(e) => setRow(r.line, { categoryId: e.target.value || null })} className="h-8 w-40"><option value="">Uncategorised</option>{(cats.data ?? []).filter((c: any) => c.kind === (r.type === "INCOME" ? "INCOME" : "EXPENSE")).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></td>
                <td className="px-2 py-1.5 text-xs text-muted-foreground">{r.duplicate ? "Possible duplicate" : r.possibleTransfer ? "May be a transfer" : r.errors.join(", ")}</td>
              </tr>))}</tbody></table>{rows.length > 300 && <p className="py-2 text-xs text-muted-foreground">Showing the first 300 rows. All rows are imported.</p>}</div>
          <div className="mt-4 flex gap-2"><Button onClick={commit} loading={busy}>Import {rows.filter((r) => r.type !== "SKIP").length} rows</Button><Button variant="outline" onClick={() => setAnalysis(null)}>Back</Button></div>
        </Section></div>
      )}
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Section flush title="Import history"><DataTable cols={bcols} rows={batches.data} loading={batches.isLoading} caption="Imports" empty={<EmptyState title="No imports yet" description="Imports you run appear here and can be undone." />} /></Section>
        <Section title="Export your data" description="CSV and Excel exports include only records you are allowed to see.">
          <Field label="Scope">{(p) => <Select id={p.id} value={exportView} onChange={(e) => setExportView(e.target.value)}><option value="my">My Finances</option><option value="household">Household Finances</option></Select>}</Field>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">{EXPORTS.map(([e, l]) => <div key={e} className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm"><span>{l}</span><span className="flex gap-2">{["csv", "xlsx"].map((f) => <a key={f} className="inline-flex items-center gap-1 text-accent underline-offset-2 hover:underline" href={`/api/finance/${hid}/export/${e}?view=${exportView}&format=${f}`}><Download className="h-3.5 w-3.5" aria-hidden />{f.toUpperCase()}</a>)}</span></div>)}</div>
          <p className="mt-3 text-xs text-muted-foreground">Want everything you own in one file? <a className="text-accent underline" href={`/api/finance/${hid}/export-all`}>Download my data (JSON)</a>.</p>
        </Section>
      </div>
    </div>
  );
}
