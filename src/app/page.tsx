import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Car, ClipboardCheck, Gauge, LineChart, ShieldCheck, Smartphone } from "lucide-react";

export default async function Home() {
  if ((await cookies()).get("av_session")) redirect("/dashboard");
  const features = [
    { icon: Gauge, title: "Smart maintenance planner", text: "Mileage, time, inspection and condition-based schedules that recalculate whenever your odometer or records change." },
    { icon: ClipboardCheck, title: "A complete service book", text: "Services, repairs, parts and receipts in one searchable timeline — exportable as a PDF for your mechanic or next buyer." },
    { icon: LineChart, title: "Know your true cost", text: "Cost per kilometre, budgets, fuel economy and spending trends — calculated honestly from the data you've recorded." },
    { icon: ShieldCheck, title: "Private by design", text: "Household sharing with per-vehicle permissions. Export or delete everything whenever you like." },
    { icon: Smartphone, title: "Works everywhere", text: "Install it on your phone. Previously loaded records stay readable offline and new entries sync when you reconnect." },
  ];
  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <span className="flex items-center gap-2 font-semibold"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground"><Car className="h-5 w-5" /></span>AutoVault</span>
        <nav className="flex items-center gap-2"><Link href="/login" className="rounded-md px-3 py-2 text-sm font-medium hover:bg-muted">Sign in</Link><Link href="/register" className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Get started</Link></nav>
      </header>
      <main>
        <section className="hero-card">
          <div className="mx-auto max-w-6xl px-6 py-20 sm:py-28">
            <h1 className="max-w-3xl text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">The complete lifecycle record for every vehicle you own.</h1>
            <p className="mt-5 max-w-2xl text-lg text-white/75">Plan maintenance, log repairs, track every dollar and keep every receipt — in one calm, fast, private place.</p>
            <div className="mt-8 flex flex-wrap gap-3"><Link href="/register" className="rounded-md bg-white px-5 py-3 font-medium text-slate-900">Create your free account</Link><Link href="/login" className="rounded-md border border-white/30 px-5 py-3 font-medium">Sign in</Link></div>
          </div>
        </section>
        <section className="mx-auto grid max-w-6xl gap-4 px-6 py-14 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <div key={f.title} className="rounded-xl border border-border bg-card p-5 shadow-card"><f.icon className="h-6 w-6 text-primary" aria-hidden /><h2 className="mt-3 font-semibold">{f.title}</h2><p className="mt-1 text-sm text-muted-foreground">{f.text}</p></div>
          ))}
        </section>
      </main>
    </div>
  );
}
