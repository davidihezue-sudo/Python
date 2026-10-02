"use client";
import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/client/api";
import { Alert, Button, Spinner } from "@/components/ui/primitives";

export default function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const { data, error, isLoading } = useQuery({ queryKey: ["invite", token], queryFn: () => api<{ householdName: string; invitedBy: string; email: string; role: string }>(`/api/invites/${token}`), retry: false });
  const [state, setState] = React.useState<"idle" | "working" | "needLogin" | "done" | "error">("idle");
  const [message, setMessage] = React.useState("");
  const accept = async () => {
    setState("working");
    try {
      await api(`/api/invites/${token}/accept`, { method: "POST" });
      setState("done");
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setState("needLogin");
      else {
        setState("error");
        setMessage((e as Error).message);
      }
    }
  };
  if (isLoading) return <Spinner className="mx-auto h-8 w-8" />;
  if (error || !data) return <Alert tone="danger" title="Invitation unavailable">{(error as Error)?.message ?? "This invitation is invalid or has expired."}</Alert>;
  return (
    <div>
      <h1 className="text-2xl font-semibold">You're invited</h1>
      <p className="mt-2 text-muted-foreground"><strong>{data.invitedBy}</strong> invited <strong>{data.email}</strong> to join the household <strong>{data.householdName}</strong> on AutoVault.</p>
      {state === "done" ? (
        <div className="mt-6"><Alert tone="success" title="You've joined the household" /><Link href="/dashboard" className="mt-4 inline-block"><Button>Open dashboard</Button></Link></div>
      ) : state === "needLogin" ? (
        <div className="mt-6 space-y-3">
          <Alert tone="info">Sign in (or create an account) with <strong>{data.email}</strong> to accept this invitation.</Alert>
          <div className="flex gap-2"><Link href={`/login?next=${encodeURIComponent(`/invite/${token}`)}`}><Button>Sign in</Button></Link><Link href="/register"><Button variant="outline">Create account</Button></Link></div>
        </div>
      ) : (
        <div className="mt-6 space-y-3">
          {state === "error" && <Alert tone="danger">{message}</Alert>}
          <Button size="lg" className="w-full" onClick={accept} loading={state === "working"}>Accept invitation</Button>
        </div>
      )}
    </div>
  );
}
