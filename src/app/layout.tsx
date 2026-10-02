import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import "./globals.css";
import { PwaRegister } from "@/components/shell/pwa-register";

export const dynamic = "force-dynamic"; // every response carries a per-request CSP nonce

export const metadata: Metadata = {
  title: { default: "AutoVault", template: "%s · AutoVault" },
  description: "Vehicle maintenance, repairs, expenses and ownership records in one place.",
  applicationName: "AutoVault",
  manifest: "/manifest.webmanifest",
  icons: { icon: [{ url: "/icons/favicon-32.png", sizes: "32x32" }, { url: "/icons/icon.svg", type: "image/svg+xml" }], apple: "/icons/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "AutoVault", statusBarStyle: "black-translucent" },
  formatDetection: { telephone: false },
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [{ media: "(prefers-color-scheme: light)", color: "#f6f7f9" }, { media: "(prefers-color-scheme: dark)", color: "#0b0f14" }],
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
