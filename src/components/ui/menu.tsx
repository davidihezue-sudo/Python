"use client";
import * as React from "react";
import { cn } from "@/lib/client/utils";

/** Small accessible dropdown (menu button pattern): arrow-key navigation, Esc, outside click. */
export function Dropdown({ trigger, children, align = "right", label }: { trigger: (p: { onClick: () => void; "aria-expanded": boolean; "aria-haspopup": "menu" }) => React.ReactNode; children: React.ReactNode | ((close: () => void) => React.ReactNode); align?: "left" | "right" | "responsive"; label?: string }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        const items = [...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
        if (!items.length) return;
        e.preventDefault();
        const i = items.indexOf(document.activeElement as HTMLElement);
        items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const close = () => setOpen(false);
  return (
    <div className="relative" ref={ref}>
      {trigger({ onClick: () => setOpen((o) => !o), "aria-expanded": open, "aria-haspopup": "menu" })}
      {open && (
        <div role="menu" aria-label={label} className={cn("absolute z-50 mt-2 min-w-[14rem] animate-fade-in rounded-lg border border-border bg-card p-1 shadow-pop", align === "right" ? "right-0" : align === "responsive" ? "left-0 sm:left-auto sm:right-0" : "left-0")}>
          {typeof children === "function" ? children(close) : children}
        </div>
      )}
    </div>
  );
}

export function MenuItem({ icon, children, onClick, href, danger, ...rest }: { icon?: React.ReactNode; children: React.ReactNode; onClick?: () => void; href?: string; danger?: boolean } & Record<string, any>) {
  const cls = cn("flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm hover:bg-muted focus:bg-muted focus:outline-none", danger && "text-danger");
  if (href)
    return (
      <a role="menuitem" href={href} className={cls} onClick={onClick} {...rest}>
        {icon}
        {children}
      </a>
    );
  return (
    <button role="menuitem" type="button" className={cls} onClick={onClick} {...rest}>
      {icon}
      {children}
    </button>
  );
}
