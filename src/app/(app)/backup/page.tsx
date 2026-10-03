"use client";
import * as React from "react";
import { Download } from "lucide-react";
import { Alert, Button } from "@/components/ui/primitives";
import { useFin } from "@/components/finance/provider";
import { NeedsHousehold, PageHeader, Section } from "@/components/finance/ui";
import { api } from "@/lib/client/api";

export default function BackupPage() {
  return <NeedsHousehold><Inner /></NeedsHousehold>;
}
function Inner() {
  const { hid, isAdmin } = useFin();
  const [items, setItems] = React.useState<any[]>([]);
  const [next, setNext] = React.useState<string | null | undefined>(undefined);
  const [scope, setScope] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const load = async (before?: string) => {
    setBusy(true);
    try { const r = await api<any>(`/api/finance/${hid}/change-history?limit=50${before ? `&before=${encodeURIComponent(before)}` : ""}`); setItems((x) => (before ? [...x, ...r.items] : r.items)); setNext(r.next); setScope(r.scope); } finally { setBusy(false); }
  };
  React.useEffect(() => { if (hid) void load(); }, [hid]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Tools" title="Backup and history" description="Keep your own copy of your data, and see what has changed." />
      <Section title="Download my data" description="Everything you are allowed to see in this household, as one file you can keep or open in a spreadsheet tool.">
        <a href={`/api/finance/${hid}/export-all`} className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"><Download className="h-4 w-4" aria-hidden /> Download backup (JSON)</a>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-muted-foreground"><li>It contains only records you can see. Another member's private records are never included.</li><li>Attached files (receipts and documents) are not inside this file. Download them from the Receipts page.</li><li>This is a copy for your own safekeeping. It cannot be re-imported as a full restore.</li></ul>
      </Section>
      {isAdmin && <Alert tone="info">Administrators: a full backup of the whole household database is made on the server with <code>npm run backup</code> (or <code>pg_dump</code>) and restored with <code>pg_restore</code>. See DEPLOYMENT.md. The file above is not a substitute for it.</Alert>}
      <Section title="Change history" description={scope}>
        {items.length === 0 && !busy ? <p className="text-sm text-muted-foreground">Nothing recorded yet.</p> : (
          <ul className="divide-y divide-border text-sm">{items.map((i) => <li key={i.id} className="flex flex-wrap justify-between gap-2 py-1.5"><span><span className="font-medium">{i.what}</span> <span className="text-muted-foreground">{i.action}</span></span><span className="text-xs text-muted-foreground">{i.by} · {new Date(i.at).toLocaleString()}</span></li>)}</ul>
        )}
        {next && <div className="mt-3"><Button variant="outline" size="sm" loading={busy} onClick={() => load(next)}>Show older</Button></div>}
        <p className="mt-3 text-xs text-muted-foreground">The history of a single transaction is on that transaction. This list never shows the contents of anyone's records.</p>
      </Section>
    </div>
  );
}
