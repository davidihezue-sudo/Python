"use client";
import * as React from "react";
import { Badge, Button } from "@/components/ui/primitives";
import { EmptyState } from "@/components/ui/empty";
import { useFin, useFinMutation, useFinQuery } from "@/components/finance/provider";
import { CommentsPanel } from "@/components/finance/comments";
import { Add, FormModal, MemberChip, NeedsHousehold, PageHeader, Section } from "@/components/finance/ui";

export default function WishlistPage() {
  return <NeedsHousehold><Inner /></NeedsHousehold>;
}
const TONE: Record<string, any> = { PENDING: "warning", APPROVED: "success", DECLINED: "danger", PURCHASED: "primary", CANCELLED: "neutral" };
const WORDS: Record<string, string> = { PENDING: "Waiting", APPROVED: "Approved", DECLINED: "Declined", PURCHASED: "Bought", CANCELLED: "Cancelled" };

function Inner() {
  const { fmt } = useFin();
  const [add, setAdd] = React.useState(false);
  const [decide, setDecide] = React.useState<{ item: any; decision: "APPROVED" | "DECLINED" } | null>(null);
  const [open, setOpen] = React.useState<string | null>(null);
  const { data, isLoading } = useFinQuery<any>("/wishlist");
  const create = useFinMutation<any, any>("POST", "/wishlist", { success: "Wish added" });
  const dec = useFinMutation<any, any>("POST", (b) => `/wishlist/${b.id}/decision`, { success: "Decision saved" });
  const bought = useFinMutation<any, any>("POST", (b) => `/wishlist/${b.id}/purchased`, { success: "Marked as bought" });
  const cancel = useFinMutation<any, any>("POST", (b) => `/wishlist/${b.id}/cancel`, { success: "Wish cancelled" });
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Money" title="Wish list" description="Ask for something you would like. A parent or another adult in the household approves or declines it." actions={data?.canRequest ? <Add label="Add a wish" onClick={() => setAdd(true)} /> : undefined} />
      {data?.summary.pending > 0 && <p className="text-sm text-muted-foreground">{data.summary.pending} waiting for a decision, about <span className="money">{fmt.money(data.summary.pendingTotal)}</span> in total.</p>}
      {isLoading ? <div className="skeleton h-40 w-full" /> : !data?.items.length ? <EmptyState title="Nothing on the list" description="Wishes appear here with their status." action={data?.canRequest ? <Button onClick={() => setAdd(true)}>Add a wish</Button> : undefined} /> : (
        <div className="grid gap-4 md:grid-cols-2">
          {data.items.map((w: any) => (
            <Section key={w.id} title={w.name} description={<span className="inline-flex items-center gap-2"><MemberChip member={w.requestedBy} /> <span className="money">{fmt.money(w.estimatedCost)}</span></span>} action={<Badge tone={TONE[w.status]}>{WORDS[w.status]}</Badge>}>
              {w.note && <p className="text-sm">{w.note}</p>}
              {w.url && <a href={w.url} target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline">Link</a>}
              {w.decidedBy && <p className="mt-1 text-xs text-muted-foreground">{WORDS[w.status === "PURCHASED" ? "APPROVED" : w.status]} by {w.decidedBy}{w.decisionNote ? `: ${w.decisionNote}` : ""}</p>}
              <div className="mt-3 flex flex-wrap gap-2">
                {w.canDecide && <><Button size="sm" onClick={() => setDecide({ item: w, decision: "APPROVED" })}>Approve</Button><Button size="sm" variant="outline" onClick={() => setDecide({ item: w, decision: "DECLINED" })}>Decline</Button></>}
                {w.canMarkPurchased && <Button size="sm" variant="outline" onClick={() => bought.mutate({ id: w.id })}>Mark as bought</Button>}
                {w.canCancel && <Button size="sm" variant="ghost" onClick={() => cancel.mutate({ id: w.id })}>Cancel</Button>}
                <Button size="sm" variant="ghost" onClick={() => setOpen(open === w.id ? null : w.id)} aria-expanded={open === w.id}>Comments</Button>
              </div>
              {open === w.id && <div className="mt-3 border-t border-border pt-3"><CommentsPanel entity="wish" entityId={w.id} /></div>}
            </Section>
          ))}
        </div>
      )}
      <FormModal open={add} onClose={() => setAdd(false)} title="Add a wish" fields={[{ name: "name", label: "What would you like?", required: true }, { name: "estimatedCost", label: "About how much?", kind: "money", required: true, half: true }, { name: "url", label: "Link (optional)", half: true }, { name: "note", label: "Why (optional)", kind: "textarea" }]} initial={{ name: "", estimatedCost: "", url: "", note: "" }} onSubmit={(v) => create.mutateAsync({ name: v.name, estimatedCost: v.estimatedCost, url: v.url || null, note: v.note || null })} />
      <FormModal open={!!decide} onClose={() => setDecide(null)} title={decide?.decision === "APPROVED" ? `Approve ${decide?.item.name}` : `Decline ${decide?.item.name ?? ""}`} fields={[{ name: "note", label: "A note for them (optional)", kind: "textarea" }]} initial={{ note: "" }} submitLabel={decide?.decision === "APPROVED" ? "Approve" : "Decline"} onSubmit={(v) => dec.mutateAsync({ id: decide!.item.id, decision: decide!.decision, note: v.note || null })} />
    </div>
  );
}
