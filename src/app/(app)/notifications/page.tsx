"use client";
import * as React from "react";
import Link from "next/link";
import { Bell, Check } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/client/api";
import { Badge, Button } from "@/components/ui/primitives";
import { EmptyState } from "@/components/ui/empty";
import { useFin, useFinMutation, useFinQuery } from "@/components/finance/provider";
import { NeedsHousehold, PageHeader, Section, Money } from "@/components/finance/ui";

export default function NotificationsPage() {
  const qc = useQueryClient();
  const [unread, setUnread] = React.useState(false);
  const { data, isLoading } = useQuery({ queryKey: ["notifications", unread], queryFn: () => api<any>(`/api/notifications?${unread ? "unread=true&" : ""}pageSize=50`) });
  const patch = useMutation({ mutationFn: (b: any) => api("/api/notifications", { method: "PATCH", body: b }), onSuccess: () => { void qc.invalidateQueries({ queryKey: ["notifications"] }); void qc.invalidateQueries({ queryKey: ["notif-count"] }); } });
  return (
    <div>
      <PageHeader eyebrow="Alerts" title="Notifications" description="Bills due, budget limits, low balances, renewals and unusual spending. Choose which alerts you get in Household settings."
        actions={<><Button variant="outline" size="sm" onClick={() => setUnread(!unread)} aria-pressed={unread}>{unread ? "Show all" : "Unread only"}</Button><Button variant="outline" size="sm" onClick={() => patch.mutate({ all: true, action: "read" })}><Check className="h-4 w-4" aria-hidden />Mark all read</Button></>} />
      <Section flush>
        {isLoading ? <div className="skeleton m-5 h-24" aria-hidden /> : (data?.items.length ?? 0) === 0 ? <EmptyState icon={<Bell className="h-5 w-5" />} title="You are all caught up" description="New alerts appear here." /> : (
          <ul className="divide-y divide-border/60">{data.items.map((n: any) => (
            <li key={n.id} className={`flex items-start gap-3 px-5 py-3 ${n.read ? "" : "bg-accent/5"}`}>
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.read ? "bg-transparent" : "bg-accent"}`} aria-label={n.read ? "Read" : "Unread"} />
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 font-medium">{n.title}{n.severity && n.severity !== "INFO" && <Badge tone={n.severity === "CRITICAL" ? "danger" : "warning"}>{n.severity.toLowerCase()}</Badge>}</p>
                {n.body && <p className="text-sm text-muted-foreground">{n.body}</p>}
                <p className="mt-0.5 text-xs text-muted-foreground">{new Date(n.createdAt).toLocaleString()}{n.actionUrl && <> · <Link className="text-accent hover:underline" href={n.actionUrl} onClick={() => patch.mutate({ ids: [n.id], action: "read" })}>Open</Link></>}</p>
              </div>
              <div className="flex shrink-0 gap-1">{!n.read && <Button size="sm" variant="ghost" onClick={() => patch.mutate({ ids: [n.id], action: "read" })}>Read</Button>}<Button size="sm" variant="ghost" onClick={() => patch.mutate({ ids: [n.id], action: "dismiss" })}>Dismiss</Button></div>
            </li>))}</ul>
        )}
      </Section>
    </div>
  );
}
