import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "AutoVault — Vehicle Maintenance & Ownership",
    short_name: "AutoVault",
    description: "Your vehicles' complete service book, maintenance planner and expense tracker.",
    id: "/",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#0b0f14",
    theme_color: "#0f172a",
    categories: ["productivity", "utilities", "finance"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Log maintenance", url: "/service-history/new", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Update mileage", url: "/vehicles?quick=mileage", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Reminders", url: "/reminders", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
