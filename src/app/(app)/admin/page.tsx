"use client";
import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, qs } from "@/lib/client/api";
import { Alert, Badge, Button, Card, CardBody, CardHeader, Input, PageHeader, Skeleton } from "@/components/ui/primitives";
import { Switch } from "@/components/ui/primitives";
import { useMe } from "@/components/shell/providers";
import { useToast } from "@/components/ui/toast";

export default function AdminPage() {
  const me = useMe();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = React.useState("");
  const enabled = me.platformRole === "PLATFORM_ADMIN";
  const stats = useQuery({ queryKey: ["admin-stats"], queryFn: () => api<any>("/api/admin/stats"), enabled });
  const users = useQuery({ queryKey: ["admin-users", search], queryFn: () => api<any>(`/api/admin/users${qs({ search })}`), enabled });
  const flags = useQuery({ queryKey: ["admin-flags"], queryFn: () => api<any[]>("/api/admin/flags"), enabled });
  if (!enabled) return <Alert tone="danger" title="Platform administrators only">You don't have access to this page.</Alert>;
  const s = stats.data;
  return (
    <>
      <PageHeader title="Platform administration" description="Aggregate platform health and user support. Vehicle records, costs and documents are never shown here." />
      {!s ? <Skeleton className="h-40" /> : (
        <div className="space-y-4">
          <section className="grid grid-cols-2 gap-3 md:grid-cols-4">{[["Users", s.users.total, `${s.users.verified} verified · ${s.users.activeLast30Days} active (30d)`], ["Households", s.households, ""], ["Vehicles", s.vehicles, `${s.openIssues} open issues`], ["Service records", s.records, `${s.expenses} expenses`], ["Documents", s.documents.count, `${(s.documents.bytes / 1048576).toFixed(1)} MB`], ["Notifications", s.notifications, ""], ["Emails", Object.entries(s.email).map(([k, v]) => `${v} ${k.toLowerCase()}`).join(", ") || "none", ""]].map(([k, v, h]) => <Card key={k as string} className="p-4"><p className="text-xs uppercase tracking-wide text-muted-foreground">{k}</p><p className="mt-1 text-2xl font-semibold tabular">{v}</p><p className="text-xs text-muted-foreground">{h}</p></Card>)}</section>
          <Card><CardHeader title="Configuration" /><CardBody className="flex flex-wrap gap-2">{Object.entries(s.config).map(([k, v]) => <Badge key={k} tone={v === true || (typeof v === "string" && !["disabled", "none", "false"].includes(v)) ? "success" : "neutral"}>{k}: {String(v)}</Badge>)}</CardBody></Card>
          <Card><CardHeader title="Feature flags" /><CardBody className="space-y-3">{flags.data?.map((f) => <Switch key={f.key} label={f.key} description={f.description ?? undefined} checked={f.enabled} onChange={async (v) => { await api("/api/admin/flags", { method: "PATCH", body: { key: f.key, enabled: v } }); toast({ title: `${f.key} ${v ? "enabled" : "disabled"}` }); void qc.invalidateQueries({ queryKey: ["admin-flags"] }); }} />)}</CardBody></Card>
          <Card><CardHeader title="Recent background jobs" /><CardBody>{s.jobs.length === 0 ? <p className="text-sm text-muted-foreground">No job runs recorded yet. Start the worker (npm run worker) or call /api/cron/run.</p> : <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1">Job</th><th>Status</th><th>Started</th><th>Result</th></tr></thead><tbody className="divide-y divide-border">{s.jobs.map((j: any) => <tr key={j.id}><td className="py-1.5 font-mono text-xs">{j.name}</td><td><Badge tone={j.status === "SUCCEEDED" ? "success" : j.status === "FAILED" ? "danger" : "warning"}>{j.status}</Badge></td><td className="text-muted-foreground">{new Date(j.startedAt).toLocaleString()}</td><td className="max-w-xs truncate text-xs text-muted-foreground">{j.error ?? JSON.stringify(j.stats)}</td></tr>)}</tbody></table></div>}</CardBody></Card>
          <Card><CardHeader title="Users" action={<Input aria-label="Search users" type="search" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} className="h-9 w-48" />} /><CardBody><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1">User</th><th>Role</th><th>Status</th><th>Last login</th><th /></tr></thead><tbody className="divide-y divide-border">{users.data?.items.map((u: any) => <tr key={u.id}><td className="py-1.5"><p className="font-medium">{u.name}</p><p className="text-xs text-muted-foreground">{u.email}</p></td><td>{u.platformRole === "PLATFORM_ADMIN" ? <Badge tone="primary">Admin</Badge> : "User"}</td><td>{u.disabled ? <Badge tone="danger">Disabled</Badge> : u.verified ? <Badge tone="success">Active</Badge> : <Badge tone="warning">Unverified</Badge>}</td><td className="text-muted-foreground">{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleDateString() : "never"}</td><td className="text-right">{u.id !== me.id && <Button size="sm" variant="outline" onClick={async () => { await api(`/api/admin/users/${u.id}`, { method: "PATCH", body: { disabled: !u.disabled } }); toast({ title: u.disabled ? "User enabled" : "User disabled" }); void qc.invalidateQueries({ queryKey: ["admin-users"] }); }}>{u.disabled ? "Enable" : "Disable"}</Button>}</td></tr>)}</tbody></table></div></CardBody></Card>
        </div>
      )}
    </>
  );
}
