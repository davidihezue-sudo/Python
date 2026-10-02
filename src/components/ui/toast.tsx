"use client";
import * as React from "react";
import { CheckCircle2, AlertTriangle, Info, X } from "lucide-react";
import { cn } from "@/lib/client/utils";

type Variant = "success" | "error" | "info";
interface ToastItem {
  id: number;
  title: string;
  description?: string;
  variant: Variant;
}
const Ctx = React.createContext<{ toast: (t: { title: string; description?: string; variant?: Variant }) => void }>({ toast: () => undefined });
export const useToast = () => React.useContext(Ctx);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = React.useState<ToastItem[]>([]);
  const idRef = React.useRef(0);
  const toast = React.useCallback((t: { title: string; description?: string; variant?: Variant }) => {
    const id = ++idRef.current;
    setItems((x) => [...x, { id, title: t.title, description: t.description, variant: t.variant ?? "success" }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), t.variant === "error" ? 8000 : 4500);
  }, []);
  return (
    <Ctx.Provider value={{ toast }}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-20 z-[100] flex flex-col items-center gap-2 px-4 sm:bottom-6 sm:items-end sm:px-6" role="region" aria-label="Notifications" aria-live="polite">
        {items.map((t) => {
          const Icon = t.variant === "success" ? CheckCircle2 : t.variant === "error" ? AlertTriangle : Info;
          return (
            <div key={t.id} className={cn("pointer-events-auto flex w-full max-w-sm animate-fade-in items-start gap-3 rounded-lg border bg-card p-3 shadow-pop", t.variant === "error" ? "border-danger/50" : "border-border")}>
              <Icon className={cn("mt-0.5 h-5 w-5 shrink-0", t.variant === "success" ? "text-success" : t.variant === "error" ? "text-danger" : "text-info")} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{t.title}</p>
                {t.description && <p className="mt-0.5 text-sm text-muted-foreground">{t.description}</p>}
              </div>
              <button aria-label="Dismiss" className="text-muted-foreground hover:text-foreground" onClick={() => setItems((x) => x.filter((i) => i.id !== t.id))}>
                <X className="h-4 w-4" />
              </button>
            </div>
          );
        })}
      </div>
    </Ctx.Provider>
  );
}
