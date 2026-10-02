"use client";
import * as React from "react";
import { cn } from "@/lib/client/utils";

export interface TabDef {
  key: string;
  label: string;
  count?: number;
  icon?: React.ReactNode;
}
/** WAI-ARIA tabs with roving arrow-key focus. Scrolls horizontally on small screens. */
export function Tabs({ tabs, value, onChange, label = "Sections" }: { tabs: TabDef[]; value: string; onChange: (k: string) => void; label?: string }) {
  const refs = React.useRef<Record<string, HTMLButtonElement | null>>({});
  const onKey = (e: React.KeyboardEvent, i: number) => {
    let n = i;
    if (e.key === "ArrowRight") n = (i + 1) % tabs.length;
    else if (e.key === "ArrowLeft") n = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") n = 0;
    else if (e.key === "End") n = tabs.length - 1;
    else return;
    e.preventDefault();
    onChange(tabs[n].key);
    refs.current[tabs[n].key]?.focus();
  };
  return (
    <div role="tablist" aria-label={label} className="-mx-1 flex gap-1 overflow-x-auto border-b border-border px-1 pb-px [scrollbar-width:none]">
      {tabs.map((t, i) => (
        <button
          key={t.key}
          ref={(el) => {
            refs.current[t.key] = el;
          }}
          role="tab"
          id={`tab-${t.key}`}
          aria-selected={value === t.key}
          aria-controls={`panel-${t.key}`}
          tabIndex={value === t.key ? 0 : -1}
          onClick={() => onChange(t.key)}
          onKeyDown={(e) => onKey(e, i)}
          className={cn("relative flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-t-md px-3 py-2.5 text-sm font-medium transition-colors", value === t.key ? "text-primary after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:rounded-full after:bg-primary" : "text-muted-foreground hover:text-foreground")}
        >
          {t.icon}
          {t.label}
          {t.count !== undefined && t.count > 0 && <span className="rounded-full bg-muted px-1.5 text-xs tabular">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}
export function TabPanel({ id, active, children }: { id: string; active: boolean; children: React.ReactNode }) {
  if (!active) return null;
  return (
    <div role="tabpanel" id={`panel-${id}`} aria-labelledby={`tab-${id}`} tabIndex={0} className="pt-4 outline-none">
      {children}
    </div>
  );
}
