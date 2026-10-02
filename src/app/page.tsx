import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Landmark, LineChart, Scale, ShieldCheck, Smartphone, Users } from "lucide-react";

export default async function Home() {
  if ((await cookies()).get("av_session")) redirect("/dashboard");
  const features = [
    { icon: Users, title: "Everyone keeps their own books", text: "Each member has a login and records their own income and spending. The household view combines what is shared, and nothing private leaks into it." },
    { icon: Scale, title: "Fair contribution tracking", text: "Split costs equally, by income, by fixed amounts or your own rules. See who paid, who owes and settle up without double counting." },
    { icon: LineChart, title: "Budgets, debt and forecasts", text: "Budgets by category, payoff plans, savings goals, a day by day cash flow forecast and what-if scenarios that never touch your real records." },
    { icon: Landmark, title: "Built for Canadian households", text: "CAD, provinces, RRSP, TFSA, FHSA, RESP, CPP, EI, GST/HST and a mortgage planner. Every rule is data you can change, and every region can be configured." },
    { icon: ShieldCheck, title: "Private by design", text: "Personal records are visible only to their owner, not even to administrators. Choose Personal, Household or selected members for every record." },
    { icon: Smartphone, title: "Works on any screen", text: "Designed for phones and desktops. Export to CSV, Excel or PDF whenever you like." },
  ];
  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <span className="flex items-center gap-2 font-semibold"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground"><Landmark className="h-5 w-5" /></span>Family Finance Hub</span>
        <nav className="flex items-center gap-2"><Link href="/login" className="rounded-md px-3 py-2 text-sm font-medium hover:bg-muted">Sign in</Link><Link href="/register" className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Get started</Link></nav>
      </header>
      <main>
        <section className="hero-card">
          <div className="mx-auto max-w-6xl px-6 py-20 sm:py-28">
            <h1 className="display max-w-3xl text-5xl leading-tight sm:text-6xl">One household. Every member's money. Clear shared picture.</h1>
            <p className="mt-5 max-w-2xl text-lg text-white/75">Track income, spending, debt, savings and net worth together, while keeping what is personal personal.</p>
            <div className="mt-8 flex flex-wrap gap-3"><Link href="/register" className="rounded-md bg-white px-5 py-3 font-medium text-slate-900">Create your account</Link><Link href="/login" className="rounded-md border border-white/30 px-5 py-3 font-medium text-white">Sign in</Link></div>
          </div>
        </section>
        <section className="mx-auto grid max-w-6xl gap-4 px-6 py-14 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <div key={f.title} className="rounded-xl border border-border bg-card p-5"><f.icon className="h-6 w-6 text-primary" aria-hidden /><h2 className="mt-3 font-semibold">{f.title}</h2><p className="mt-1 text-sm text-muted-foreground">{f.text}</p></div>
          ))}
        </section>
      </main>
    </div>
  );
}
