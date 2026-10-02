"use client";
import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { api } from "@/lib/client/api";
import { Alert, Button, Spinner } from "@/components/ui/primitives";

export default function VerifyEmailPage() {
  const token = useSearchParams().get("token") ?? "";
  const [state, setState] = React.useState<"working" | "ok" | "error">("working");
  const [message, setMessage] = React.useState("");
  const ran = React.useRef(false);
  React.useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    if (!token) {
      setState("error");
      setMessage("This verification link is incomplete.");
      return;
    }
    api("/api/auth/verify-email", { method: "POST", body: { token } })
      .then(() => setState("ok"))
      .catch((e) => {
        setState("error");
        setMessage(e.message);
      });
  }, [token]);
  return (
    <div className="text-center">
      {state === "working" && (<><Spinner className="mx-auto h-8 w-8" /><p className="mt-3 text-muted-foreground">Verifying your email…</p></>)}
      {state === "ok" && (<><h1 className="text-2xl font-semibold">Email verified</h1><p className="mt-2 text-muted-foreground">Your address is confirmed. You can sign in now.</p><Link href="/login?verified=1" className="mt-6 inline-block"><Button>Continue to sign in</Button></Link></>)}
      {state === "error" && (<><Alert tone="danger" title="Couldn't verify your email">{message}</Alert><Link href="/login" className="mt-4 inline-block text-primary hover:underline">Back to sign in</Link></>)}
    </div>
  );
}
