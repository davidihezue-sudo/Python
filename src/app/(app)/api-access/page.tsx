"use client";
import * as React from "react";
import { Alert, Badge, Button } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/dialog";
import { useConfirm } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { EmptyState } from "@/components/ui/empty";
import { useFin, useFinMutation, useFinQuery } from "@/components/finance/provider";
import { Add, FormModal, NeedsHousehold, PageHeader, Section } from "@/components/finance/ui";

export default function ApiAccessPage() {
  return <NeedsHousehold><Inner /></NeedsHousehold>;
}
function Inner() {
  const { hid, fmt, canWrite } = useFin();
  const confirm = useConfirm();
  const { toast } = useToast();
  const [add, setAdd] = React.useState(false);
  const [shown, setShown] = React.useState<string | null>(null);
  const { data } = useFinQuery<any[]>("/api-tokens");
  const create = useFinMutation<any, any>("POST", "/api-tokens", { onSuccess: (r) => setShown(r.token) });
  const revoke = useFinMutation<any, any>("DELETE", (b) => `/api-tokens/${b.id}`, { success: "Token revoked" });
  const base = typeof window === "undefined" ? "" : window.location.origin;
  return (
    <div className="space-y-4 sm:space-y-6">
      <PageHeader eyebrow="Tools" title="API access" description="Read-only tokens for spreadsheets and scripts. A token can read exactly what you can read in this household, and can never change anything." actions={canWrite ? <Add label="New token" onClick={() => setAdd(true)} /> : undefined} />
      <Alert tone="info">Tokens only work for GET requests, for this household, and stop working when they expire or you revoke them. Anyone with a token can read your data, so treat it like a password.</Alert>
      <Section title="Example"><code className="block overflow-x-auto whitespace-pre rounded-md border border-border bg-muted p-3 text-xs">{`curl -H "Authorization: Bearer ffh_..." \\\n  ${base}/api/finance/${hid}/accounts`}</code></Section>
      <Section title="Your tokens" flush>
        {!data?.length ? <EmptyState title="No tokens" description="Create one when you need a spreadsheet or script to read your data." /> : (
          <ul className="divide-y divide-border">{data.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
              <div><p className="font-medium">{t.name} <span className="font-mono text-xs text-muted-foreground">{t.prefix}...</span></p><p className="text-xs text-muted-foreground">{t.active ? `Expires ${fmt.date(t.expiresAt.slice(0, 10))}` : t.revoked ? "Revoked" : "Expired"}{t.lastUsedAt ? ` · last used ${fmt.date(t.lastUsedAt.slice(0, 10))}` : " · never used"}</p></div>
              <div className="flex items-center gap-2">{t.active ? <Badge tone="success">Active</Badge> : <Badge>Inactive</Badge>}{t.active && <Button size="sm" variant="outline" onClick={async () => { if (await confirm({ title: `Revoke ${t.name}?`, description: "Anything using this token stops working immediately.", confirmLabel: "Revoke", tone: "danger" })) revoke.mutate({ id: t.id }); }}>Revoke</Button>}</div>
            </li>
          ))}</ul>
        )}
      </Section>
      <FormModal open={add} onClose={() => setAdd(false)} title="New read-only token" fields={[{ name: "name", label: "What is it for?", required: true, placeholder: "e.g. Budget spreadsheet" }, { name: "days", label: "Valid for (days)", kind: "number", hint: "1 to 365." }]} initial={{ name: "", days: 90 }} submitLabel="Create token" onSubmit={(v) => create.mutateAsync({ name: v.name, days: Number(v.days || 90) })} />
      <Modal open={!!shown} onClose={() => setShown(null)} title="Copy your token now" size="sm" footer={<><Button variant="outline" onClick={() => setShown(null)}>Done</Button><Button onClick={async () => { try { await navigator.clipboard.writeText(shown ?? ""); toast({ title: "Token copied" }); } catch { toast({ title: "Select the token and copy it", variant: "info" }); } }}>Copy</Button></>}>
        <p className="mb-2 text-sm">This is the only time it is shown.</p>
        <code className="block break-all rounded-md border border-border bg-muted p-3 text-xs">{shown}</code>
      </Modal>
    </div>
  );
}
