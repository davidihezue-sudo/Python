import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Family Finance Hub: household budgeting and net worth",
    short_name: "Family Finance Hub",
    description: "Budgets, ledger, debt, savings, net worth and forecasts for the whole household, with private and shared records.",
    id: "/",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#F6F4EE",
    theme_color: "#185040",
    categories: ["productivity", "utilities", "finance"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Add transaction", url: "/transactions?new=1", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Budgets", url: "/budgets", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Forecast", url: "/forecast", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
