"use client";
import * as React from "react";

declare global {
  interface Window {
    __avInstallPrompt?: any;
  }
}

/** Registers the service worker (production, or when NEXT_PUBLIC_ENABLE_SW=1) and captures the install prompt where the browser offers one. */
export function PwaRegister() {
  React.useEffect(() => {
    if ("serviceWorker" in navigator && (process.env.NODE_ENV === "production" || process.env.NEXT_PUBLIC_ENABLE_SW === "1")) {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
    }
    const onPrompt = (e: Event) => {
      e.preventDefault();
      window.__avInstallPrompt = e;
      window.dispatchEvent(new CustomEvent("av:install-available"));
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);
  return null;
}
