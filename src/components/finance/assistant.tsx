"use client";
import * as React from "react";
import { Send } from "lucide-react";
import { Badge, Button, Input, Spinner } from "@/components/ui/primitives";
import { api, ApiError } from "@/lib/client/api";
import { useFin } from "@/components/finance/provider";
import { NeedsHousehold, Notice, PageHeader, Section, ViewSwitch } from "@/components/finance/ui";

const EXAMPLES = ["How much did we spend on groceries last month?", "What are my top 5 expense categories this year?", "How much did I spend in September?", "What bills are due in the next 7 days?", "What did our cars cost this year?", "What maintenance is due on our vehicles?", "Can we afford a 600 dollar monthly payment?", "What is our net worth?", "How much have I paid toward shared costs?"];
interface Msg { role: "user" | "assistant"; text: string; answer?: any }

export function FinAssistant() {
  return <NeedsHousehold><Inner /></NeedsHousehold>;
}
function Inner() {
  const { hid, view } = useFin();
  const [msgs, setMsgs] = React.useState<Msg[]>([]);
  const [text, setText] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const end = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => end.current?.scrollIntoView({ block: "nearest" }), [msgs, busy]);
  const send = async (q: string) => {
    if (!q.trim() || busy) return;
    setMsgs((m) => [...m, { role: "user", text: q }]); setText(""); setBusy(true);
    try {
      const a = await api<any>(`/api/finance/${hid}/assistant`, { method: "POST", body: { question: q, view } });
      setMsgs((m) => [...m, { role: "assistant", text: a.answer, answer: a }]);
    } catch (e) { setMsgs((m) => [...m, { role: "assistant", text: e instanceof ApiError ? e.message : "Something went wrong." }]); } finally { setBusy(false); }
  };
  return (
    <div>
      <PageHeader eyebrow="Assistant" title="Ask about your money" description="Answers are calculated from your recorded data with no external service. Estimates are labelled as estimates." actions={<ViewSwitch />} />
      <Notice tone="info">Uses only records you are allowed to see. Other members' private records are never read.</Notice>
      <div className="mt-4"><Section flush>
        <div className="max-h-[55vh] min-h-[280px] space-y-4 overflow-y-auto p-4" aria-live="polite">
          {msgs.length === 0 && <div><p className="mb-3 text-sm text-muted-foreground">Try one of these:</p><div className="flex flex-wrap gap-2">{EXAMPLES.map((e) => <button key={e} onClick={() => void send(e)} className="rounded-full border border-border px-3 py-1.5 text-left text-sm hover:bg-muted">{e}</button>)}</div></div>}
          {msgs.map((m, i) => (
            <div key={i} className={`flex ${m.role === "user" ? "justify-end" : ""}`}>
              <div className={`max-w-[88%] rounded-2xl px-4 py-2.5 text-sm ${m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                <p className="whitespace-pre-wrap">{m.text}</p>
                {m.answer && (<div className="mt-2 space-y-1 border-t border-border/60 pt-2 text-xs text-muted-foreground">
                  {m.answer.figures?.length > 0 && <ul>{m.answer.figures.map((f: any) => <li key={f.label} className="flex justify-between gap-4"><span>{f.label}</span><span className="tabular">{f.value} <Badge>{f.kind}</Badge></span></li>)}</ul>}
                  <p>{m.answer.explanation}</p>{m.answer.note && <p>{m.answer.note}</p>}
                </div>)}
              </div>
            </div>
          ))}
          {busy && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner className="h-4 w-4" /> Working it out</div>}
          <div ref={end} />
        </div>
        <form className="flex gap-2 border-t border-border p-3" onSubmit={(e) => { e.preventDefault(); void send(text); }}>
          <Input aria-label="Ask a question" value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask about spending, bills, debt, savings or net worth" maxLength={500} />
          <Button type="submit" disabled={!text.trim() || busy} aria-label="Send"><Send className="h-4 w-4" /></Button>
        </form>
      </Section></div>
    </div>
  );
}
