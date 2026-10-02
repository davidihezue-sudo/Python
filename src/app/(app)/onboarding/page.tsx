"use client";
import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Button, Field, Input, Select } from "@/components/ui/primitives";
import { api, ApiError } from "@/lib/client/api";
import { useFin } from "@/components/finance/provider";
import { Notice, Section } from "@/components/finance/ui";

const GOALS = ["Pay off debt", "Build an emergency fund", "Save for a home", "Save for retirement", "Save for education", "Track spending", "Plan a big purchase", "Understand net worth"];
const STRUCTURES = ["Single", "Couple", "Family with children", "Shared household", "Other"];
const REGIONS_CA = ["AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "ON", "PE", "QC", "SK", "YT"];
const STEPS = ["Household", "Region and money", "Goals", "Finish"];

export default function OnboardingPage() {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const { hid, profile } = useFin();
  const isNew = params.get("new") === "1";
  const [step, setStep] = React.useState(0);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState("");
  const [v, setV] = React.useState({ name: "", structure: "Couple", countryCode: "CA", region: "ON", city: "", currency: "CAD", dateFormat: "YYYY-MM-DD", budgetPeriod: "MONTHLY", fiscalYearStartMonth: 1, goals: [] as string[] });
  const set = (k: string, x: any) => setV((s) => ({ ...s, [k]: x }));
  const reuse = !isNew && !!hid && !!profile && !profile.onboarded;
  React.useEffect(() => { if (reuse && profile) setV((s) => ({ ...s, name: profile.name, countryCode: profile.countryCode, region: profile.region ?? "", currency: profile.currency })); }, [reuse, profile?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const body = () => ({ name: v.name.trim(), structure: v.structure, countryCode: v.countryCode, region: v.region || null, city: v.city || null, currency: v.currency.toUpperCase(), dateFormat: v.dateFormat, budgetPeriod: v.budgetPeriod, fiscalYearStartMonth: Number(v.fiscalYearStartMonth), goalsPreference: v.goals, numberLocale: v.countryCode === "CA" ? "en-CA" : "en-US", completeOnboarding: true });
  const finish = async (demo: boolean) => {
    setBusy(true); setErr("");
    try {
      if (demo) await api("/api/finance/demo", { method: "POST", body: {} });
      else if (reuse) await api(`/api/finance/${hid}/profile`, { method: "PATCH", body: body() });
      else await api("/api/finance/households", { method: "POST", body: body() });
      await qc.invalidateQueries({ queryKey: ["fin"] });
      await qc.invalidateQueries({ queryKey: ["me"] });
      router.replace("/dashboard");
    } catch (e) { setErr(e instanceof ApiError ? e.message : (e as Error).message); setBusy(false); }
  };
  const canNext = step === 0 ? v.name.trim().length > 0 : step === 1 ? /^[A-Za-z]{3}$/.test(v.currency) : true;
  return (
    <main className="mx-auto max-w-2xl px-4 py-10 sm:py-16">
      <p className="text-xs font-medium uppercase tracking-[0.14em] text-accent">Family Finance Hub</p>
      <h1 className="display mt-1 text-4xl">Set up your household</h1>
      <p className="mt-2 text-sm text-muted-foreground">Four short steps. Everything can be changed later. You decide what each member sees; nothing is shared unless you say so.</p>
      <ol className="my-6 flex gap-2" aria-label="Progress">{STEPS.map((s, i) => <li key={s} aria-current={i === step ? "step" : undefined} className={`flex-1 border-t-2 pt-2 text-xs ${i <= step ? "border-primary font-medium" : "border-border text-muted-foreground"}`}>{i + 1}. {s}</li>)}</ol>
      {err && <div className="mb-4"><Notice tone="danger">{err}</Notice></div>}
      <Section>
        {step === 0 && <div className="grid gap-4">
          <Field label="Household name" required>{(p) => <Input id={p.id} value={v.name} onChange={(e) => set("name", e.target.value)} placeholder="The Okafor household" maxLength={80} />}</Field>
          <Field label="Who is in your household?">{(p) => <Select id={p.id} value={v.structure} onChange={(e) => set("structure", e.target.value)}>{STRUCTURES.map((s) => <option key={s}>{s}</option>)}</Select>}</Field>
          <p className="text-sm text-muted-foreground">You can invite other members by email from the Household page. Each person gets their own login and their own private space.</p>
        </div>}
        {step === 1 && <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Country">{(p) => <Select id={p.id} value={v.countryCode} onChange={(e) => { set("countryCode", e.target.value); if (e.target.value === "CA") set("currency", "CAD"); }}><option value="CA">Canada</option><option value="US">United States</option><option value="GB">United Kingdom</option><option value="OTHER">Other</option></Select>}</Field>
          <Field label={v.countryCode === "CA" ? "Province or territory" : "Region"}>{(p) => v.countryCode === "CA" ? <Select id={p.id} value={v.region} onChange={(e) => set("region", e.target.value)}>{REGIONS_CA.map((r) => <option key={r}>{r}</option>)}</Select> : <Input id={p.id} value={v.region} onChange={(e) => set("region", e.target.value)} />}</Field>
          <Field label="City (optional)">{(p) => <Input id={p.id} value={v.city} onChange={(e) => set("city", e.target.value)} />}</Field>
          <Field label="Currency" hint="Three-letter code, for example CAD">{(p) => <Input id={p.id} value={v.currency} maxLength={3} onChange={(e) => set("currency", e.target.value.toUpperCase())} />}</Field>
          <Field label="Date format">{(p) => <Select id={p.id} value={v.dateFormat} onChange={(e) => set("dateFormat", e.target.value)}><option value="YYYY-MM-DD">2026-10-02</option><option value="DD/MM/YYYY">02/10/2026</option><option value="MM/DD/YYYY">10/02/2026</option><option value="D MMM YYYY">2 Oct 2026</option></Select>}</Field>
          <Field label="Budget period">{(p) => <Select id={p.id} value={v.budgetPeriod} onChange={(e) => set("budgetPeriod", e.target.value)}><option value="MONTHLY">Monthly</option><option value="WEEKLY">Weekly</option><option value="ANNUAL">Annual</option></Select>}</Field>
        </div>}
        {step === 2 && <fieldset><legend className="mb-3 text-sm font-medium">What matters most right now?</legend><div className="grid gap-2 sm:grid-cols-2">{GOALS.map((g) => <label key={g} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm"><input type="checkbox" checked={v.goals.includes(g)} onChange={(e) => set("goals", e.target.checked ? [...v.goals, g] : v.goals.filter((x) => x !== g))} />{g}</label>)}</div></fieldset>}
        {step === 3 && <div className="space-y-3 text-sm">
          <p><strong>{v.name}</strong>, {v.structure.toLowerCase()}, {v.region ? `${v.region}, ` : ""}{v.countryCode}. Currency {v.currency}.</p>
          <p className="text-muted-foreground">We will add a starter set of categories. You can add accounts, income and budgets next.</p>
          <p className="text-muted-foreground">Want to look around first? Load the clearly labelled demo household instead. It can be removed with one click.</p>
        </div>}
      </Section>
      <div className="mt-5 flex flex-wrap gap-2">
        {step > 0 && <Button variant="outline" onClick={() => setStep(step - 1)} disabled={busy}>Back</Button>}
        {step < 3 ? <Button onClick={() => setStep(step + 1)} disabled={!canNext}>Continue</Button> : <><Button onClick={() => finish(false)} loading={busy}>Create household</Button><Button variant="outline" onClick={() => finish(true)} disabled={busy}>Load demo household instead</Button></>}
        {isNew && <Button variant="ghost" className="ml-auto" onClick={() => router.push("/dashboard")}>Cancel</Button>}
      </div>
    </main>
  );
}
