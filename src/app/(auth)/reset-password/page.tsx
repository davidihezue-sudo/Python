"use client";
import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { z } from "zod";
import { passwordSchema } from "@/lib/auth/password";
import { api } from "@/lib/client/api";
import { Alert, Button, Field, Input } from "@/components/ui/primitives";
import { applyApiErrors, useZodForm } from "@/components/forms";

const schema = z.object({ password: passwordSchema, confirm: z.string() }).refine((v) => v.password === v.confirm, { message: "Passwords don't match", path: ["confirm"] });

export default function ResetPasswordPage() {
  const token = useSearchParams().get("token") ?? "";
  const form = useZodForm(schema, { password: "", confirm: "" });
  const [error, setError] = React.useState("");
  const submit = form.handleSubmit(async (v) => {
    setError("");
    try {
      await api("/api/auth/reset-password", { method: "POST", body: { token, password: v.password } });
      window.location.assign("/login?reset=1");
    } catch (e) {
      setError(applyApiErrors(form, e));
    }
  });
  if (!token) return <Alert tone="danger" title="Missing reset token">Open the link from your email, or <Link className="text-primary underline" href="/forgot-password">request a new one</Link>.</Alert>;
  return (
    <div>
      <h1 className="text-2xl font-semibold">Choose a new password</h1>
      <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="New password" error={form.formState.errors.password?.message as string} hint="At least 10 characters, with letters and a number or symbol." required>{(p) => <Input type="password" autoComplete="new-password" autoFocus {...p} {...form.register("password")} />}</Field>
        <Field label="Confirm password" error={form.formState.errors.confirm?.message as string} required>{(p) => <Input type="password" autoComplete="new-password" {...p} {...form.register("confirm")} />}</Field>
        <Button type="submit" className="w-full" size="lg" loading={form.formState.isSubmitting}>Update password</Button>
      </form>
    </div>
  );
}
