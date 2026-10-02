"use client";
import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/client/utils";
import { Button } from "./primitives";

/** Accessible modal built on the native <dialog> element: focus trap, Esc to close and inert background come from the platform. Renders as a bottom sheet on phones. */
export function Modal({ open, onClose, title, description, children, footer, size = "md", dismissible = true }: { open: boolean; onClose: () => void; title: string; description?: string; children: React.ReactNode; footer?: React.ReactNode; size?: "sm" | "md" | "lg" | "xl"; dismissible?: boolean }) {
  const ref = React.useRef<HTMLDialogElement>(null);
  const titleId = React.useId();
  React.useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  const width = { sm: "sm:max-w-md", md: "sm:max-w-xl", lg: "sm:max-w-3xl", xl: "sm:max-w-5xl" }[size];
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        if (dismissible) onClose();
      }}
      onClick={(e) => {
        if (dismissible && e.target === ref.current) onClose();
      }}
      className={cn("m-0 mt-auto max-h-[92dvh] w-full max-w-none rounded-t-2xl border border-border bg-card p-0 text-card-foreground shadow-pop open:flex open:flex-col sm:m-auto sm:rounded-2xl", width)}
    >
      {open && (
        <>
          <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
            <div>
              <h2 id={titleId} className="text-lg font-semibold">
                {title}
              </h2>
              {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
            </div>
            {dismissible && (
              <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close dialog" className="-mr-2 -mt-1">
                <X className="h-5 w-5" />
              </Button>
            )}
          </div>
          <div className="overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-5 py-3 safe-bottom">{footer}</div>}
        </>
      )}
    </dialog>
  );
}

interface ConfirmOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  tone?: "danger" | "primary";
}
const ConfirmContext = React.createContext<(o: ConfirmOptions) => Promise<boolean>>(async () => false);
export const useConfirm = () => React.useContext(ConfirmContext);

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null);
  const confirm = React.useCallback((o: ConfirmOptions) => new Promise<boolean>((resolve) => setState({ ...o, resolve })), []);
  const close = (v: boolean) => {
    state?.resolve(v);
    setState(null);
  };
  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Modal
        open={!!state}
        onClose={() => close(false)}
        title={state?.title ?? ""}
        description={state?.description}
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => close(false)}>
              Cancel
            </Button>
            <Button variant={state?.tone === "primary" ? "primary" : "danger"} onClick={() => close(true)}>
              {state?.confirmLabel ?? "Delete"}
            </Button>
          </>
        }
      >
        <span className="sr-only">Please confirm this action.</span>
      </Modal>
    </ConfirmContext.Provider>
  );
}
