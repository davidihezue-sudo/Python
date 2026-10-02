"use client";
import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Send, Sparkles, Trash2, Wrench } from "lucide-react";
import { api } from "@/lib/client/api";
import { Alert, Badge, Button, Card, Input, PageHeader, Spinner } from "@/components/ui/primitives";
import { useSelectedVehicle } from "@/components/shell/providers";
import { cn } from "@/lib/client/utils";
import { Tabs } from "@/components/ui/tabs";
import { FinAssistant } from "@/components/finance/assistant";

const SUGGESTIONS = ["What maintenance did I perform last year?", "When were my brake pads last replaced?", "What was the cost of my last oil change?", "What services are coming up?", "Show me all repairs involving the cooling system", "How much have I spent on suspension repairs?", "Summarize my vehicle's maintenance history", "What maintenance records are missing?"];

function Md({ text }: { text: string }) {
  // minimal, safe rendering: **bold**, _italic_, and "• " bullets - never HTML
  return (
    <div className="space-y-1 whitespace-pre-wrap text-sm leading-relaxed">
      {text.split("\n").map((l, i) => (
        <p key={i} className={cn(l.startsWith("• ") && "pl-3 -indent-3")}>
          {l.split(/(\*\*[^*]+\*\*|_[^_]+_)/g).map((s, j) => (s.startsWith("**") ? <strong key={j}>{s.slice(2, -2)}</strong> : s.startsWith("_") && s.endsWith("_") && s.length > 2 ? <em key={j} className="text-muted-foreground">{s.slice(1, -1)}</em> : <React.Fragment key={j}>{s}</React.Fragment>))}
        </p>
      ))}
    </div>
  );
}

function VehicleAssistant() {
  const qc = useQueryClient();
  const { vehicleId } = useSelectedVehicle();
  const { data: status } = useQuery({ queryKey: ["ai-status"], queryFn: () => api<any>("/api/ai/status") });
  const { data: convs } = useQuery({ queryKey: ["ai-convs"], queryFn: () => api<any[]>("/api/ai/conversations") });
  const [cid, setCid] = React.useState<string | null>(null);
  const [msgs, setMsgs] = React.useState<{ role: "user" | "assistant"; content: string; provider?: string; tools?: any[] }[]>([]);
  const [text, setText] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const end = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => end.current?.scrollIntoView({ behavior: "smooth" }), [msgs, busy]);

  const send = async (q: string) => {
    if (!q.trim() || busy) return;
    setError("");
    setMsgs((m) => [...m, { role: "user", content: q }]);
    setText("");
    setBusy(true);
    try {
      const r = await api<any>("/api/ai/chat", { method: "POST", body: { message: q, conversationId: cid ?? undefined, vehicleId: vehicleId !== "all" ? vehicleId : undefined } });
      setCid(r.conversationId);
      setMsgs((m) => [...m, { role: "assistant", content: r.answer, provider: r.provider, tools: r.tools }]);
      void qc.invalidateQueries({ queryKey: ["ai-convs"] });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const load = async (id: string) => {
    const c = await api<any>(`/api/ai/conversations/${id}`);
    setCid(id);
    setMsgs(c.messages.map((m: any) => ({ role: m.role === "USER" ? "user" : "assistant", content: m.content, provider: m.provider, tools: m.tools })));
  };
  return (
    <>
      <PageHeader title="AI Assistant" description="Ask about your vehicles. Answers come only from your recorded data; anything not recorded is reported as such." actions={status && <Badge tone={status.provider === "anthropic" ? "primary" : "neutral"}>{status.provider === "anthropic" ? `AI model: ${status.model}` : "Rule-based assistant (no AI provider configured)"}</Badge>} />
      <div className="grid gap-4 lg:grid-cols-[1fr_16rem]">
        <Card className="flex min-h-[60vh] flex-col">
          <div className="flex-1 space-y-4 overflow-y-auto p-4" aria-live="polite">
            {msgs.length === 0 && (
              <div className="py-6 text-center"><Sparkles className="mx-auto h-8 w-8 text-primary" aria-hidden /><h2 className="mt-2 font-semibold">What would you like to know?</h2><p className="text-sm text-muted-foreground">{vehicleId !== "all" ? "Questions refer to the vehicle selected in the top bar." : "Questions cover all your vehicles."}</p>
                <div className="mx-auto mt-4 flex max-w-xl flex-wrap justify-center gap-2">{SUGGESTIONS.map((s) => <button key={s} onClick={() => send(s)} className="rounded-full border border-border px-3 py-1.5 text-sm hover:bg-muted">{s}</button>)}</div></div>
            )}
            {msgs.map((m, i) => (
              <div key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
                <div className={cn("max-w-[85%] rounded-2xl px-4 py-2.5", m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted")}>
                  {m.role === "user" ? <p className="text-sm">{m.content}</p> : <>
                    <Md text={m.content} />
                    <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-border/60 pt-2 text-[11px] text-muted-foreground"><Badge>Advisory</Badge><span>{m.provider === "anthropic" ? "AI-generated from your records" : "Rule-based, from your records"}</span>{m.tools && m.tools.length > 0 && <details><summary className="cursor-pointer">Sources ({m.tools.length})</summary><ul className="mt-1">{m.tools.map((t: any, k: number) => <li key={k} className="flex items-center gap-1"><Wrench className="h-3 w-3" />{t.name}({Object.entries(t.input ?? {}).map(([a, b]) => `${a}: ${b}`).join(", ")})</li>)}</ul></details>}</div>
                  </>}
                </div>
              </div>
            ))}
            {busy && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner className="h-4 w-4" /> Looking through your records…</div>}
            {error && <Alert tone="danger">{error}</Alert>}
            <div ref={end} />
          </div>
          <form className="flex gap-2 border-t border-border p-3" onSubmit={(e) => { e.preventDefault(); void send(text); }}>
            <Input aria-label="Ask a question" value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask about services, costs, repairs, what's due…" maxLength={2000} />
            <Button type="submit" disabled={!text.trim() || busy} aria-label="Send"><Send className="h-4 w-4" /></Button>
          </form>
        </Card>
        <aside aria-label="Conversations"><Card className="p-3"><div className="mb-2 flex items-center justify-between"><h2 className="text-sm font-semibold">Conversations</h2><Button size="sm" variant="ghost" onClick={() => { setCid(null); setMsgs([]); }}>New</Button></div>
          <ul className="space-y-1">{convs?.length ? convs.map((c) => <li key={c.id} className="flex items-center gap-1"><button onClick={() => load(c.id)} className={cn("min-w-0 flex-1 truncate rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted", cid === c.id && "bg-muted font-medium")}>{c.title}</button><Button size="icon" variant="ghost" aria-label="Delete conversation" onClick={async () => { await api(`/api/ai/conversations/${c.id}`, { method: "DELETE" }); if (cid === c.id) { setCid(null); setMsgs([]); } void qc.invalidateQueries({ queryKey: ["ai-convs"] }); }}><Trash2 className="h-3.5 w-3.5" /></Button></li>) : <li className="text-sm text-muted-foreground">No conversations yet.</li>}</ul>
        </Card></aside>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">Recommendations are advisory and general; they are not manufacturer requirements. Always check your owner's manual.</p>
    </>
  );
}

export default function AssistantPage() {
  const [tab, setTab] = React.useState("finance");
  return (
    <div>
      <div className="mb-5"><Tabs label="Assistant" value={tab} onChange={setTab} tabs={[{ key: "finance", label: "Finance assistant" }, { key: "vehicle", label: "Vehicle assistant" }]} /></div>
      {tab === "finance" ? <FinAssistant /> : <VehicleAssistant />}
    </div>
  );
}
