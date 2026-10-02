"use client";
import * as React from "react";
import Link from "next/link";
import { forgotSchema } from "@/lib/validation";
import { api } from "@/lib/client/api";
import { Alert, Button, Field, Input } from "@/components/ui/primitives";
import { applyApiErrors, useZodForm } from "@/components/forms";

export default function ForgotPasswordPage() {
  const form = useZodForm(forgotSchema, { email: "" });
  const [error, setError] = React.useState("");
  const [sent, setSent] = React.useState(false);
  const submit = form.handleSubmit(async (v) => {
    setError("");
    try {
      await api("/api/auth/forgot-password", { method: "POST", body: v });
      setSent(true);
    } catch (e) {
      setError(applyApiErrors(form, e));
    }
  });
  if (sent)
    return (
      <div>
        <h1 className="text-2xl font-semibold">Check your email</h1>
        <p className="mt-2 text-muted-foreground">If an account exists for that address, we've sent a link to reset your password. It expires in 1 hour.</p>
        <Link href="/login" className="mt-6 inline-block text-primary hover:underline">Back to sign in</Link>
      </div>
    );
  return (
    <div>
      <h1 className="text-2xl font-semibold">Forgot your password?</h1>
      <p className="mt-1 text-sm text-muted-foreground">Enter your email and we'll send you a reset link.</p>
      <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="Email" error={form.formState.errors.email?.message as string} required>{(p) => <Input type="email" autoComplete="email" autoFocus {...p} {...form.register("email")} />}</Field>
        <Button type="submit" className="w-full" size="lg" loading={form.formState.isSubmitting}>Send reset link</Button>
      </form>
      <p className="mt-6 text-center text-sm"><Link href="/login" className="text-primary hover:underline">Back to sign in</Link></p>
    </div>
  );
}
