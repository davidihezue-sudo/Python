"use client";
import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { loginSchema } from "@/lib/validation";
import { api, ApiError } from "@/lib/client/api";
import { Alert, Button, Field, Input } from "@/components/ui/primitives";
import { applyApiErrors, useZodForm } from "@/components/forms";

const GOOGLE_ERRORS: Record<string, string> = { google_unavailable: "Google sign-in isn't configured.", google_state: "The Google sign-in session expired. Please try again.", google_exchange: "Google sign-in failed. Please try again.", google_profile: "Couldn't read your Google profile.", google_error: "Google sign-in failed. Please try again." };

function safeNext(n: string | null) {
  return n && n.startsWith("/") && !n.startsWith("//") && !n.startsWith("/\\") ? n : "/dashboard";
}

export default function LoginPage() {
  const params = useSearchParams();
  const form = useZodForm(loginSchema, { email: "", password: "" });
  const [error, setError] = React.useState(params.get("error") ? GOOGLE_ERRORS[params.get("error") as string] ?? "Sign-in failed." : "");
  const [unverified, setUnverified] = React.useState(false);
  const [resent, setResent] = React.useState(false);
  const { data: providers } = useQuery({ queryKey: ["providers"], queryFn: () => api<{ google: boolean }>("/api/auth/providers") });
  const notice = params.get("verified") ? "Email verified - you can sign in now." : params.get("reset") ? "Password updated - sign in with your new password." : params.get("deleted") ? "Your account has been deleted." : "";

  const submit = form.handleSubmit(async (v) => {
    setError("");
    setUnverified(false);
    try {
      await api("/api/auth/login", { method: "POST", body: v });
      try { navigator.serviceWorker?.controller?.postMessage({ type: "CLEAR" }); } catch { /* ignore */ }
      window.location.assign(safeNext(params.get("next")));
    } catch (e) {
      if (e instanceof ApiError && e.details?.reason === "EMAIL_NOT_VERIFIED") setUnverified(true);
      setError(e instanceof ApiError ? e.message : "Couldn't sign in. Check your connection and try again.");
      applyApiErrors(form, new Error());
    }
  });
  return (
    <div>
      <h1 className="text-2xl font-semibold">Welcome back</h1>
      <p className="mt-1 text-sm text-muted-foreground">Sign in to your Family Finance Hub account.</p>
      <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
        {notice && <Alert tone="success">{notice}</Alert>}
        {error && (
          <Alert tone="danger">
            {error}
            {unverified && (
              <div className="mt-2">
                <button type="button" className="font-medium text-primary hover:underline" disabled={resent} onClick={async () => { await api("/api/auth/resend-verification", { method: "POST", body: { email: form.getValues("email") } }).catch(() => undefined); setResent(true); }}>
                  {resent ? "Verification email sent" : "Resend verification email"}
                </button>
              </div>
            )}
          </Alert>
        )}
        <Field label="Email" error={form.formState.errors.email?.message as string} required>{(p) => <Input type="email" autoComplete="email" autoFocus {...p} {...form.register("email")} />}</Field>
        <Field label="Password" error={form.formState.errors.password?.message as string} required>{(p) => <Input type="password" autoComplete="current-password" {...p} {...form.register("password")} />}</Field>
        <div className="flex justify-end text-sm"><Link href="/forgot-password" className="text-primary hover:underline">Forgot password?</Link></div>
        <Button type="submit" className="w-full" size="lg" loading={form.formState.isSubmitting}>Sign in</Button>
      </form>
      {providers?.google && (
        <>
          <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground"><span className="h-px flex-1 bg-border" />or<span className="h-px flex-1 bg-border" /></div>
          <a href="/api/auth/google" className="flex h-11 w-full items-center justify-center gap-2 rounded-md border border-input bg-card text-sm font-medium hover:bg-muted">Continue with Google</a>
        </>
      )}
      <p className="mt-6 text-center text-sm text-muted-foreground">New to Family Finance Hub? <Link href="/register" className="font-medium text-primary hover:underline">Create an account</Link></p>
    </div>
  );
}
