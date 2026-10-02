import * as React from "react";
import { cn } from "@/lib/client/utils";
import { Card } from "./primitives";

export function EmptyState({ icon, title, description, action, className }: { icon?: React.ReactNode; title: string; description?: string; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center rounded-xl border border-dashed border-border px-6 py-10 text-center", className)}>
      {icon && <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">{icon}</div>}
      <h3 className="text-base font-semibold">{title}</h3>
      {description && <p className="mt-1 max-w-md text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-4 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

export function Stat({ label, value, hint, icon, tone, href }: { label: string; value: React.ReactNode; hint?: React.ReactNode; icon?: React.ReactNode; tone?: "danger" | "warning" | "success"; href?: string }) {
  const body = (
    <Card className={cn("p-4", href && "transition-colors hover:border-primary/40")}>
      <div className="flex items-center justify-between text-muted-foreground">
        <p className="text-xs font-medium uppercase tracking-wide">{label}</p>
        {icon}
      </div>
      <p className={cn("mt-2 text-2xl font-semibold tabular", tone === "danger" && "text-danger", tone === "warning" && "text-warning", tone === "success" && "text-success")}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </Card>
  );
  return href ? (
    <a href={href} className="block rounded-xl">
      {body}
    </a>
  ) : (
    body
  );
}
