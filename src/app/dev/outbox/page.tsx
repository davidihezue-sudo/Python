import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { smtpEnabled } from "@/lib/env";

// DEVELOPMENT ONLY: shows emails that were captured because SMTP isn't configured, so verification/reset links are usable locally.
export const dynamic = "force-dynamic";
export const metadata = { title: "Dev outbox" };

export default async function Outbox() {
  if (process.env.NODE_ENV === "production" || smtpEnabled()) notFound();
  const rows = await db.emailOutbox.findMany({ orderBy: { createdAt: "desc" }, take: 30 });
  const link = (t: string) => /(https?:\/\/\S+)/.exec(t)?.[1] ?? null;
  return (
    <div className="mx-auto max-w-3xl space-y-3 p-6">
      <h1 className="text-2xl font-semibold">Dev email outbox</h1>
      <p className="text-sm text-muted-foreground">Visible only in development when SMTP is not configured.</p>
      {rows.map((r) => (
        <div key={r.id} className="rounded-lg border border-border bg-card p-3 text-sm">
          <p className="font-medium">{r.subject}</p>
          <p className="text-xs text-muted-foreground">to {r.toEmail} · {r.createdAt.toISOString()} · {r.status}</p>
          {link(r.text) && <a className="break-all text-primary underline" href={link(r.text) as string}>{link(r.text)}</a>}
        </div>
      ))}
    </div>
  );
}
