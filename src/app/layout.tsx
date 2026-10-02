import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import "./globals.css";
import { PwaRegister } from "@/components/shell/pwa-register";

export const dynamic = "force-dynamic"; // every response carries a per-request CSP nonce

export const metadata: Metadata = {
  title: { default: "Family Finance Hub", template: "%s · Family Finance Hub" },
  description: "Household budgeting, ledger, debt, savings, net worth and forecasts for families, with private and shared records.",
  applicationName: "Family Finance Hub",
  manifest: "/manifest.webmanifest",
  icons: { icon: [{ url: "/icons/favicon-32.png", sizes: "32x32" }, { url: "/icons/icon.svg", type: "image/svg+xml" }], apple: "/icons/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "Family Finance Hub", statusBarStyle: "black-translucent" },
  formatDetection: { telephone: false },
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [{ media: "(prefers-color-scheme: light)", color: "#F6F4EE" }, { media: "(prefers-color-scheme: dark)", color: "#101512" }],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const theme = (await cookies()).get("av_theme")?.value;
  return (
    <html lang="en" data-theme={theme === "light" || theme === "dark" ? theme : undefined} suppressHydrationWarning>
      <body>
        {children}
        <PwaRegister />
      </body>
    </html>
  );
}
