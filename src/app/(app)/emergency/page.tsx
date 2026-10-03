"use client";
import * as React from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Alert, Button, Checkbox, Input, Textarea } from "@/components/ui/primitives";
import { useFin, useFinMutation, useFinQuery } from "@/components/finance/provider";
import { NeedsHousehold, PageHeader, Section } from "@/components/finance/ui";

export default function EmergencyPage() {
  return <NeedsHousehold><Switch /></NeedsHousehold>;
}
function Switch() {
  const owner = useSearchParams().get("owner");
  return owner ? <Shared owner={owner} /> : <Mine />;
}

const LABELS: Record<string, string> = { accounts: "Accounts", insurance: "Insurance", debts: "Debts", income: "Income and work", assets: "Property and other assets", bills: "Regular bills", subscriptions: "Subscriptions" };
function Summary({ s }: { s: any }) {
  const { fmt } = useFin();
  const line = (k: string, r: any) => k === "accounts" ? `${r.name}${r.institution ? `, ${r.institution}` : ""} (${String(r.type).toLowerCase().replace(/_/g, " ")})${r.balance !== null ? `: ${fmt.money(r.balance)}` : ""}` : k === "insurance" ? `${r.provider}: ${r.name}${r.policyNumberLast4 ? `, policy ending ${r.policyNumberLast4}` : ""}${r.beneficiary ? `, beneficiary ${r.beneficiary}` : ""}` : k === "debts" ? `${r.lender} (${String(r.type).toLowerCase().replace(/_/g, " ")})` : k === "income" ? `${r.name}${r.employer ? `, ${r.employer}` : ""}` : k === "assets" ? `${r.name} (${String(r.kind).toLowerCase().replace(/_/g, " ")})` : r.provider ? `${r.name}, ${r.provider}` : r.name;
  return (
    <div className="space-y-4">
      {Object.keys(LABELS).filter((k) => s[k]?.length).map((k) => <div key={k}><h3 className="mb-1 text-sm font-semibold">{LABELS[k]}</h3><ul className="list-disc space-y-0.5 pl-5 text-sm">{s[k].map((r: any, i: number) => <li key={i}>{line(k, r)}</li>)}</ul></div>)}
      <p className="text-xs text-muted-foreground">{s.note}</p>
    </div>
  );
}

function Mine() {
  const { canWrite } = useFin();
  const { data, isLoading } = useFinQuery<any>("/legacy");
  const { data: shared } = useFinQuery<any[]>("/legacy/shared");
  const save = useFinMutation<any, any>("PUT", "/legacy", { success: "Saved" });
  const [sections, setSections] = React.useState<{ title: string; body: string }[] | null>(null);
  const [trusted, setTrusted] = React.useState<string[] | null>(null);
  const [balances, setBalances] = React.useState<boolean | null>(null);
  const sec = sections ?? data?.sections ?? [], tr = trusted ?? data?.trustedMemberIds ?? [], bal = balances ?? data?.includeBalances ?? false;
  if (isLoading || !data) return <div className="skeleton h-64 w-full" />;
  return (
    <div className="space-y-4 sm:space-y-6">
      <PageHeader eyebrow="Tools" title="If something happens to me" description="A page for the people you trust: who to call, where things are, and a list of the records you own. Do not type passwords here." actions={<Button variant="outline" onClick={() => window.print()}>Print</Button>} />
      <Alert tone="info">{data.privacy}</Alert>
      {(shared?.length ?? 0) > 0 && <Section title="Shared with you"><ul className="space-y-1 text-sm">{shared!.map((s) => <li key={s.ownerMemberId}><Link className="text-primary hover:underline" href={`/emergency?owner=${s.ownerMemberId}`}>{s.owner}'s page</Link></li>)}</ul></Section>}
      <Section title="Your notes">
        <div className="space-y-4">
          {sec.map((s: any, i: number) => (
            <div key={i} className="space-y-1">
              <Input aria-label="Section title" value={s.title} onChange={(e) => setSections(sec.map((x: any, n: number) => (n === i ? { ...x, title: e.target.value } : x)))} className="font-medium" />
              <Textarea aria-label={`${s.title} notes`} value={s.body} rows={3} onChange={(e) => setSections(sec.map((x: any, n: number) => (n === i ? { ...x, body: e.target.value } : x)))} />
              <button type="button" className="text-xs text-danger hover:underline" onClick={() => setSections(sec.filter((_: any, n: number) => n !== i))}>Remove this section</button>
            </div>
          ))}
          {sec.length < 12 && <Button type="button" variant="outline" size="sm" onClick={() => setSections([...sec, { title: "New section", body: "" }])}>Add a section</Button>}
        </div>
      </Section>
      <Section title="Who can read it" description="Only the people you tick. You are told whenever one of them opens it. Children and accountants cannot be chosen.">
        <div className="space-y-2">{data.candidates.length === 0 ? <p className="text-sm text-muted-foreground">There is nobody else in this household who can be chosen yet.</p> : data.candidates.map((c: any) => <Checkbox key={c.id} label={c.name} checked={tr.includes(c.id)} onChange={(e) => setTrusted(e.target.checked ? [...tr, c.id] : tr.filter((x: string) => x !== c.id))} />)}</div>
        <div className="mt-3"><Checkbox label="Include account balances in the list below" checked={bal} onChange={(e) => setBalances(e.target.checked)} /></div>
      </Section>
      {canWrite && <div><Button loading={save.isPending} onClick={() => save.mutate({ sections: sec, trustedMemberIds: tr, includeBalances: bal })}>Save</Button></div>}
      <Section title="What the page shows from your records" description="Records you own are listed here automatically. Joint records are not, because the household already sees them."><Summary s={data.summary} /></Section>
    </div>
  );
}

function Shared({ owner }: { owner: string }) {
  const { fmt } = useFin();
  const { data, error, isLoading } = useFinQuery<any>(`/legacy/shared/${owner}`, {}, { retry: false });
  if (isLoading) return <div className="skeleton h-64 w-full" />;
  if (error || !data) return <div className="space-y-4"><PageHeader eyebrow="Tools" title="Not available" description="This page does not exist or has not been shared with you." /><Link className="text-primary hover:underline" href="/emergency">Back</Link></div>;
  return (
    <div className="space-y-4 sm:space-y-6">
      <PageHeader eyebrow="Tools" title={`If something happens to ${data.owner}`} description={`Last updated ${fmt.date(data.updatedAt.slice(0, 10))}. ${data.owner} was told that you opened this page.`} actions={<Button variant="outline" onClick={() => window.print()}>Print</Button>} />
      {data.sections.filter((s: any) => s.body.trim()).map((s: any, i: number) => <Section key={i} title={s.title}><p className="whitespace-pre-wrap text-sm">{s.body}</p></Section>)}
      <Section title="Records"><Summary s={data.summary} /></Section>
    </div>
  );
}
