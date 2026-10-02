"use client";
import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { registerSchema } from "@/lib/validation";
import { api } from "@/lib/client/api";
import { Alert, Button, Checkbox, Field, Input } from "@/components/ui/primitives";
import { applyApiErrors, useZodForm } from "@/components/forms";

export default function RegisterPage() {
  const form = useZodForm(registerSchema, { name: "", email: "", password: "", acceptTerms: false });
  const [error, setError] = React.useState("");
  const [done, setDone] = React.useState<{ requiresVerification: boolean; email: string } | null>(null);
  const { data: providers } = useQuery({ queryKey: ["providers"], queryFn: () => api<{ google: boolean }>("/api/auth/providers") });
  const submit = form.handleSubmit(async (v) => {
    setError("");
    try {
      let timezone: string | undefined;
      try { timezone = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { /* ignore */ }
      const res = await api<{ requiresVerification: boolean }>("/api/auth/register", { method: "POST", body: { ...v, timezone } });
      setDone({ requiresVerification: res.requiresVerification, email: v.email });
    } catch (e) {
      setError(applyApiErrors(form, e));
    }
  });
  if (done)
    return (
      <div>
        <h1 className="text-2xl font-semibold">{done.requiresVerification ? "Check your email" : "Account created"}</h1>
        <p className="mt-2 text-muted-foreground">
          {done.requiresVerification ? <>If <strong>{done.email}</strong> is new to AutoVault, we've sent a verification link. It expires in 24 hours.</> : "You can now sign in."}
        </p>
        <Link href="/login" className="mt-6 inline-block"><Button>Go to sign in</Button></Link>
      </div>
    );
  return (
    <div>
      <h1 className="text-2xl font-semibold">Create your account</h1>
      <p className="mt-1 text-sm text-muted-foreground">Start tracking your vehicles' maintenance in minutes.</p>
      <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="Full name" error={form.formState.errors.name?.message as string} required>{(p) => <Input autoComplete="name" autoFocus {...p} {...form.register("name")} />}</Field>
        <Field label="Email" error={form.formState.errors.email?.message as string} required>{(p) => <Input type="email" autoComplete="email" {...p} {...form.register("email")} />}</Field>
        <Field label="Password" error={form.formState.errors.password?.message as string} hint="At least 10 characters, with letters and a number or symbol." required>{(p) => <Input type="password" autoComplete="new-password" {...p} {...form.register("password")} />}</Field>
        <div>
          <Checkbox label={<>I agree to the privacy policy. My vehicle and financial records are stored privately and I can export or delete them at any time.</>} {...form.register("acceptTerms")} />
          {form.formState.errors.acceptTerms && <p role="alert" className="mt-1 text-xs text-danger">{form.formState.errors.acceptTerms.message as string}</p>}
        </div>
        <Button type="submit" className="w-full" size="lg" loading={form.formState.isSubmitting}>Create account</Button>
      </form>
      {providers?.google && (
        <>
          <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground"><span className="h-px flex-1 bg-border" />or<span className="h-px flex-1 bg-border" /></div>
          <a href="/api/auth/google" className="flex h-11 w-full items-center justify-center gap-2 rounded-md border border-input bg-card text-sm font-medium hover:bg-muted">Continue with Google</a>
        </>
      )}
      <p className="mt-6 text-center text-sm text-muted-foreground">Already have an account? <Link href="/login" className="font-medium text-primary hover:underline">Sign in</Link></p>
    </div>
  );
}
