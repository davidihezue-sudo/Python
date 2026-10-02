import Link from "next/link";
import { Car } from "lucide-react";
import { AuthProviders } from "@/components/shell/auth-providers";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProviders>
      <div className="grid min-h-dvh lg:grid-cols-2">
        <div className="hero-card relative hidden flex-col justify-between p-10 lg:flex">
          <Link href="/" className="flex items-center gap-2 text-lg font-semibold">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground"><Car className="h-5 w-5" /></span>
            AutoVault
          </Link>
          <div>
            <h2 className="max-w-md text-3xl font-semibold leading-tight">Every service, repair and receipt — one trustworthy record for each vehicle you own.</h2>
            <ul className="mt-6 space-y-2 text-white/75">
              <li>• Mileage- and time-based maintenance planning</li>
              <li>• Repair tracking, parts history and warranty alerts</li>
              <li>• Cost per kilometre, budgets and exportable service history</li>
            </ul>
          </div>
          <p className="text-sm text-white/50">Your data stays private to your household.</p>
        </div>
        <main className="flex items-center justify-center px-4 py-10 sm:px-8">
          <div className="w-full max-w-md">{children}</div>
        </main>
      </div>
    </AuthProviders>
  );
}
