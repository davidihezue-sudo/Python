"use client";
import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button, Select } from "@/components/ui/primitives";
import { useConfirm } from "@/components/ui/dialog";
import { useFin, useFinMutation, useFinQuery } from "@/components/finance/provider";
import { Add, FormModal, NeedsHousehold, PageHeader, Section, ViewNote, humanize, type FieldDef } from "@/components/finance/ui";
import { addDays, addMonths } from "@/lib/dates";

const KIND_LABEL: Record<string, string> = { INCOME: "Income", BILL: "Bill", SUBSCRIPTION: "Subscription", INSURANCE: "Insurance premium", INSURANCE_RENEWAL: "Insurance renewal", MORTGAGE: "Mortgage", LOAN: "Loan payment", CREDIT_CARD: "Credit card payment", GOAL: "Savings contribution", RECURRING: "Recurring", CUSTOM: "Event", MAINTENANCE: "Maintenance", VEHICLE_RENEWAL: "Vehicle renewal" };

export default function CalendarPage() {
  return <NeedsHousehold><Inner /></NeedsHousehold>;
}
function Inner() {
  const { fmt, canWrite, profile } = useFin();
  const confirm = useConfirm();
  const today = profile?.today ?? new Date().toISOString().slice(0, 10);
  const [mode, setMode] = React.useState<"month" | "week" | "agenda">("month");
  const [anchor, setAnchor] = React.useState(today);
  const [edit, setEdit] = React.useState<any | "new" | null>(null);
  const first = `${anchor.slice(0, 7)}-01`;
  const dow = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay();
  const range = mode === "month" ? { from: addDays(first, -dow(first)), to: addDays(addMonths(first, 1), -1 + (6 - dow(addDays(addMonths(first, 1), -1)))) } : mode === "week" ? { from: addDays(anchor, -dow(anchor)), to: addDays(anchor, 6 - dow(anchor)) } : { from: today, to: addDays(today, 45) };
  const { data } = useFinQuery<any[]>("/calendar", { ...range, view: "all" });
  const events = useFinQuery<any[]>("/calendar/events");
  const create = useFinMutation<any, any>("POST", "/calendar/events", { success: "Event added" });
  const upd = useFinMutation<any, any>("PATCH", (b) => `/calendar/events/${b.id}`, { success: "Saved" });
  const del = useFinMutation<any, any>("DELETE", (b) => `/calendar/events/${b.id}`, { success: "Removed" });
  const byDate = new Map<string, any[]>();
  for (const o of data ?? []) byDate.set(o.date, [...(byDate.get(o.date) ?? []), o]);
  const days: string[] = []; for (let d = range.from; d <= range.to; d = addDays(d, 1)) days.push(d);
  const step = (n: number) => setAnchor(mode === "month" ? addMonths(first, n) : addDays(anchor, 7 * n));
  const fields: FieldDef[] = [{ name: "title", label: "Title", required: true }, { name: "date", label: "Date", kind: "date", required: true, half: true }, { name: "endDate", label: "End date (optional)", kind: "date", half: true }, { name: "notes", label: "Notes", kind: "textarea" }];
  const Item = ({ o }: { o: any }) => {
    const ev = o.kind === "CUSTOM" ? events.data?.find((e) => e.id === o.sourceId) : null;
    const inner = <><span className="truncate">{o.title}</span>{o.amount && <span className="money ml-auto shrink-0">{o.direction === "in" ? "+" : "-"}{fmt.money(o.amount)}</span>}</>;
    const cls = `flex w-full items-center gap-1 rounded border-l-2 px-1.5 py-0.5 text-left text-[11px] ${o.direction === "in" ? "border-success bg-success/10" : o.direction === "out" ? "border-danger bg-danger/10" : "border-accent bg-accent/10"} ${o.completed ? "line-through opacity-60" : ""}`;
    return ev && ev.canEdit ? <button className={cls} onClick={() => setEdit(ev)} title={`${KIND_LABEL[o.kind] ?? o.kind}: ${o.title}`}>{inner}</button> : <div className={cls} title={`${KIND_LABEL[o.kind] ?? o.kind}: ${o.title}`}>{inner}</div>;
  };
  const label = mode === "month" ? new Intl.DateTimeFormat(fmt.locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${first}T00:00:00Z`)) : mode === "week" ? `Week of ${fmt.date(range.from)}` : "Next 45 days";
  return (
    <div>
      <PageHeader eyebrow="Calendar" title="Money calendar" description="Pay days, bills, subscriptions, premiums, loan payments and your own reminders in one place."
        actions={canWrite ? <Add label="Add event" onClick={() => setEdit("new")} /> : undefined} />
      <ViewNote />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {mode !== "agenda" && <><Button variant="outline" size="icon" aria-label="Previous" onClick={() => step(-1)}><ChevronLeft className="h-4 w-4" /></Button><Button variant="outline" size="icon" aria-label="Next" onClick={() => step(1)}><ChevronRight className="h-4 w-4" /></Button><Button variant="outline" size="sm" onClick={() => setAnchor(today)}>Today</Button></>}
        <span className="display text-xl">{label}</span>
        <Select aria-label="Calendar view" value={mode} onChange={(e) => setMode(e.target.value as any)} className="ml-auto w-32"><option value="month">Month</option><option value="week">Week</option><option value="agenda">Agenda</option></Select>
      </div>
      {mode === "agenda" ? (
        <Section flush>
          {[...byDate.keys()].sort().map((d) => (
            <div key={d} className="border-b border-border/60 px-5 py-3 last:border-0">
              <p className="mb-1 text-xs font-medium text-muted-foreground">{fmt.date(d)}{d === today ? " (today)" : ""}</p>
              <div className="space-y-1">{byDate.get(d)!.map((o) => <Item key={o.key} o={o} />)}</div>
            </div>
          ))}
          {byDate.size === 0 && <p className="px-5 py-6 text-sm text-muted-foreground">Nothing scheduled in the next 45 days.</p>}
        </Section>
      ) : (
        <>
          <div className="hidden grid-cols-7 gap-px overflow-hidden rounded-xl border border-border bg-border md:grid" role="grid" aria-label={label}>
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => <div key={d} className="bg-muted px-2 py-1.5 text-xs font-medium text-muted-foreground" role="columnheader">{d}</div>)}
            {days.map((d) => (
              <div key={d} role="gridcell" className={`min-h-[96px] space-y-1 bg-card p-1.5 ${mode === "month" && d.slice(0, 7) !== anchor.slice(0, 7) ? "opacity-50" : ""}`}>
                <p className={`text-xs ${d === today ? "inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground" : "text-muted-foreground"}`}>{Number(d.slice(8))}</p>
                {(byDate.get(d) ?? []).slice(0, mode === "week" ? 20 : 4).map((o) => <Item key={o.key} o={o} />)}
                {mode === "month" && (byDate.get(d)?.length ?? 0) > 4 && <p className="text-[11px] text-muted-foreground">+{byDate.get(d)!.length - 4} more</p>}
              </div>
            ))}
          </div>
          <div className="space-y-2 md:hidden">
            {days.filter((d) => byDate.has(d) && (mode === "week" || d.slice(0, 7) === anchor.slice(0, 7))).map((d) => (
              <Section key={d} title={fmt.date(d) + (d === today ? " (today)" : "")}><div className="space-y-1">{byDate.get(d)!.map((o) => <Item key={o.key} o={o} />)}</div></Section>
            ))}
          </div>
        </>
      )}
      <FormModal open={!!edit} onClose={() => setEdit(null)} title={edit === "new" ? "Add an event" : "Edit event"} fields={fields} visibility
        initial={edit && edit !== "new" ? { ...edit, endDate: edit.endDate ?? "", notes: edit.notes ?? "" } : { title: "", date: today, endDate: "", notes: "", visibility: "HOUSEHOLD", sharedWithMemberIds: [] }}
        footerExtra={edit && edit !== "new" ? <Button variant="ghost" className="mr-auto text-danger" onClick={async () => { if (await confirm({ title: "Remove this event?", confirmLabel: "Remove" })) { await del.mutateAsync(edit); setEdit(null); } }}>Remove</Button> : undefined}
        onSubmit={(v) => { const body = { title: v.title, date: v.date, endDate: v.endDate || null, notes: v.notes || null, visibility: v.visibility, sharedWithMemberIds: v.sharedWithMemberIds }; return edit === "new" ? create.mutateAsync(body) : upd.mutateAsync({ id: edit.id, ...body }); }} />
    </div>
  );
}
