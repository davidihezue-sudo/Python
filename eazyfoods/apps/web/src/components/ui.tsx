'use client';
import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { label as fmtLabel } from '@/lib/format';

export const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(' ');

/* ---------- icons (inline SVG, decorative unless labelled) ---------- */
const P: Record<string, string> = {
  search: 'M11 4a7 7 0 105 11.9l4.3 4.3 1.4-1.4-4.3-4.3A7 7 0 0011 4zm0 2a5 5 0 110 10 5 5 0 010-10z',
  cart: 'M3 4h2l2.4 10.2a2 2 0 002 1.8h7.8a2 2 0 002-1.6L21 8H6.2M9 21a1 1 0 100-2 1 1 0 000 2zm9 0a1 1 0 100-2 1 1 0 000 2z',
  heart: 'M12 20.5s-8-4.7-8-10.3A4.7 4.7 0 0112 7.4a4.7 4.7 0 018 2.8c0 5.6-8 10.3-8 10.3z',
  user: 'M12 12a4.5 4.5 0 100-9 4.5 4.5 0 000 9zm-8 9a8 8 0 0116 0',
  pin: 'M12 21s7-6.2 7-11.5A7 7 0 005 9.5C5 14.800 12 21 12 21zm0-8.5a3 3 0 100-6 3 3 0 000 6z',
  home: 'M4 11l8-7 8 7v9h-5v-6H9v6H4z',
  bag: 'M5 8h14l-1 12H6L5 8zm4 0V6a3 3 0 016 0v2',
  bell: 'M6 17h12l-1.5-2V10a4.500 4.500 0 00-9 0v5L6 17zm4 2a2 2 0 004 0',
  star: 'M12 3l2.7 5.6 6.100.9-4.400 4.300 1 6.100L12 17l-5.400 2.900 1-6.100L3.200 9.500l6.100-.9z',
  check: 'M5 12.500l4.500 4.500L19 7.500',
  x: 'M6 6l12 12M18 6L6 18',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  menu: 'M4 7h16M4 12h16M4 17h16',
  chev: 'M9 6l6 6-6 6',
  down: 'M6 9l6 6 6-6',
  truck: 'M3 6h11v10H3zM14 9h4l3 3v4h-7M7 19a2 2 0 100-4 2 2 0 000 4zm10 0a2 2 0 100-4 2 2 0 000 4z',
  alert: 'M12 4l9 16H3L12 4zm0 6v4m0 3v.01',
  info: 'M12 21a9 9 0 100-18 9 9 0 000 18zm0-10v5m0-8v.01',
  clock: 'M12 21a9 9 0 100-18 9 9 0 000 18zm0-14v5l3 2',
  print: 'M7 9V4h10v5M7 17H5a2 2 0 01-2-2v-4a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2h-2M7 14h10v6H7z',
  scan: 'M4 8V5a1 1 0 011-1h3M16 4h3a1 1 0 011 1v3M20 16v3a1 1 0 01-1 1h-3M8 20H5a1 1 0 01-1-1v-3M4 12h16',
};
export function Icon({ name, size = 20, label }: { name: keyof typeof P | string; size?: number; label?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} focusable="false">
      <path d={P[name] ?? P.info} />
    </svg>
  );
}

/* ---------- toasts ---------- */
type Toast = { id: number; msg: string; kind: 'ok' | 'bad' | 'info' };
const ToastCtx = createContext<{ toast: (msg: string, kind?: Toast['kind']) => void }>({ toast: () => {} });
export const useToast = () => useContext(ToastCtx).toast;
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const toast = useCallback((msg: string, kind: Toast['kind'] = 'ok') => {
    const id = Date.now() + Math.random();
    setItems((s) => [...s.slice(-3), { id, msg, kind }]);
    setTimeout(() => setItems((s) => s.filter((t) => t.id !== id)), kind === 'bad' ? 7000 : 4000);
  }, []);
  const v = useMemo(() => ({ toast }), [toast]);
  return (
    <ToastCtx.Provider value={v}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (<div key={t.id} className={cx('toast', t.kind)}><Icon name={t.kind === 'bad' ? 'alert' : 'check'} size={18} /><span>{t.msg}</span></div>))}
      </div>
    </ToastCtx.Provider>
  );
}

/* ---------- basic atoms ---------- */
const TONE: Record<string, string> = {
  active: 'ok', approved: 'ok', paid: 'ok', captured: 'ok', delivered: 'ok', completed: 'ok', resolved: 'ok', released: 'ok', published: 'ok', verified: 'ok', open: 'info', processed: 'ok', accepted: 'ok', ready: 'ok', confirmed: 'info', succeeded: 'ok',
  pending: 'warn', submitted: 'warn', preparing: 'warn', pending_payment: 'warn', in_review: 'warn', held: 'warn', draft: '', scheduled: 'info', waiting: 'warn', under_review: 'warn', pending_review: 'warn', new: 'warn', in_progress: 'info',
  rejected: 'bad', cancelled: 'bad', failed: 'bad', suspended: 'bad', declined: 'bad', expired: 'bad', reversed: 'bad', refunded: 'warn', banned: 'bad', high: 'bad', critical: 'bad', medium: 'warn', low: 'info', closed: '',
};
export function Badge({ children, tone, status }: { children?: ReactNode; tone?: 'ok' | 'warn' | 'bad' | 'info' | ''; status?: string }) {
  const t = tone ?? (status ? TONE[status] ?? '' : '');
  return <span className={cx('badge', t)}>{children ?? (status ? fmtLabel(status) : null)}</span>;
}
export function Stars({ value, count }: { value: number | null | undefined; count?: number }) {
  const v = Math.round(Number(value ?? 0));
  if (!value) return <span className="muted small">No ratings yet</span>;
  return (
    <span className="small" title={`${Number(value).toFixed(1)} out of 5`}>
      <span className="stars" aria-hidden="true">{[1, 2, 3, 4, 5].map((i) => <svg key={i} width="15" height="15" viewBox="0 0 24 24" fill="currentColor" className={i > v ? 'off' : ''}><path d={P.star} /></svg>)}</span>
      <span className="sr-only">{Number(value).toFixed(1)} out of 5 stars</span> <b>{Number(value).toFixed(1)}</b>{count != null && <span className="muted"> ({count})</span>}
    </span>
  );
}
export function Spinner({ label = 'Loading' }: { label?: string }) { return <span className="spinner" role="status" aria-label={label} />; }
export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return <div className="empty"><h3>{title}</h3>{children && <p>{children}</p>}{action}</div>;
}
export function ErrorNote({ error, retry }: { error: any; retry?: () => void }) {
  if (!error) return null;
  return <div className="alert bad" role="alert"><Icon name="alert" /><div className="grow">{error?.message ?? String(error)}{retry && <> <button className="btn sm secondary" onClick={retry}>Try again</button></>}</div></div>;
}
export function Stat({ label, value, delta, hint }: { label: string; value: ReactNode; delta?: ReactNode; hint?: string }) {
  return <div className="card stat"><div className="l">{label}</div><div className="v">{value}</div>{delta && <div className="d">{delta}</div>}{hint && <div className="hint">{hint}</div>}</div>;
}

/* ---------- form controls ---------- */
export function Field({ label, hint, error, children, full, optional, hideLabel }: { hideLabel?: boolean; label: string; hint?: string; error?: string | null; children: (p: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }) => ReactNode; full?: boolean; optional?: boolean }) {
  const id = useId();
  const d = error ? `${id}-e` : hint ? `${id}-h` : undefined;
  return (
    <div className={cx('field', full && 'full')}>
      <label htmlFor={id} className={hideLabel ? 'sr-only' : undefined}>{label}{optional && <span className="muted"> (optional)</span>}</label>
      {children({ id, 'aria-describedby': d, 'aria-invalid': error ? true : undefined })}
      {error ? <div id={`${id}-e`} className="error-text">{error}</div> : hint ? <div id={`${id}-h`} className="hint">{hint}</div> : null}
    </div>
  );
}
type InputProps = { label: string; value: any; onChange: (v: string) => void; type?: string; hint?: string; error?: string | null; full?: boolean; optional?: boolean; required?: boolean; placeholder?: string; autoComplete?: string; min?: number | string; max?: number | string; step?: number | string; inputMode?: any; maxLength?: number; disabled?: boolean };
export function Input({ label, value, onChange, type = 'text', hint, error, full, optional, ...rest }: InputProps) {
  return <Field label={label} hint={hint} error={error} full={full} optional={optional}>{(p) => <input className="input" type={type} value={value ?? ''} onChange={(e) => onChange(e.target.value)} {...p} {...rest} />}</Field>;
}
export function Textarea({ label, value, onChange, hint, error, full, optional, rows = 4, ...rest }: { label: string; value: any; onChange: (v: string) => void; hint?: string; error?: string | null; full?: boolean; optional?: boolean; rows?: number; placeholder?: string; maxLength?: number; required?: boolean }) {
  return <Field label={label} hint={hint} error={error} full={full} optional={optional}>{(p) => <textarea className="textarea" rows={rows} value={value ?? ''} onChange={(e) => onChange(e.target.value)} {...p} {...rest} />}</Field>;
}
export function Select({ label, value, onChange, options, hint, error, full, optional, placeholder, disabled, hideLabel }: { hideLabel?: boolean; label: string; value: any; onChange: (v: string) => void; options: (string | { value: string; label: string })[]; hint?: string; error?: string | null; full?: boolean; optional?: boolean; placeholder?: string; disabled?: boolean }) {
  return (
    <Field label={label} hint={hint} error={error} full={full} optional={optional} hideLabel={hideLabel}>
      {(p) => (
        <select className="select" value={value ?? ''} onChange={(e) => onChange(e.target.value)} disabled={disabled} {...p}>
          {placeholder !== undefined && <option value="">{placeholder}</option>}
          {options.map((o) => { const v = typeof o === 'string' ? o : o.value; return <option key={v} value={v}>{typeof o === 'string' ? fmtLabel(o) : o.label}</option>; })}
        </select>
      )}
    </Field>
  );
}
export function Check({ label, checked, onChange, hint, disabled }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; hint?: string; disabled?: boolean }) {
  return <label className="check"><input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} /><span>{label}{hint && <span className="hint" style={{ display: 'block' }}>{hint}</span>}</span></label>;
}
export function Btn({ children, busy, variant, size, block, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean; variant?: 'primary' | 'leaf' | 'secondary' | 'ghost' | 'danger' | 'danger-outline'; size?: 'sm' | 'lg'; block?: boolean }) {
  return <button type="button" {...p} disabled={p.disabled || busy} aria-busy={busy || undefined} className={cx('btn', variant, size, block && 'block', p.className)}>{busy && <Spinner />}{children}</button>;
}

/* ---------- modal ---------- */
export function Modal({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const tid = useId();
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current;
    const first = el?.querySelector<HTMLElement>('input,select,textarea,button:not(.icon-btn),[href]') ?? el;
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
      if (e.key === 'Tab' && el) {
        const f = [...el.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])')];
        if (!f.length) return;
        const a = f[0], b = f[f.length - 1];
        if (e.shiftKey && document.activeElement === a) { e.preventDefault(); b.focus(); } else if (!e.shiftKey && document.activeElement === b) { e.preventDefault(); a.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; prev?.focus?.(); };
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby={tid} ref={ref} tabIndex={-1} style={wide ? { width: 'min(900px,100%)' } : undefined}>
        <div className="modal-head"><h2 id={tid} style={{ margin: 0, fontSize: '1.25rem' }}>{title}</h2><button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="x" /></button></div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}
export function Confirm({ title, children, confirmLabel = 'Confirm', danger, onConfirm, onClose }: { title: string; children: ReactNode; confirmLabel?: string; danger?: boolean; onConfirm: () => Promise<any> | any; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  return (
    <Modal title={title} onClose={onClose} footer={<><Btn variant="secondary" onClick={onClose}>Cancel</Btn><Btn variant={danger ? 'danger' : 'primary'} busy={busy} onClick={async () => { setBusy(true); try { await onConfirm(); onClose(); } catch (e: any) { toast(e.message, 'bad'); } finally { setBusy(false); } }}>{confirmLabel}</Btn></>}>
      {children}
    </Modal>
  );
}

/* ---------- tabs ---------- */
export function Tabs({ tabs, value, onChange }: { tabs: { key: string; label: string; count?: number }[]; value: string; onChange: (k: string) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => <button key={t.key} role="tab" aria-selected={value === t.key} className={value === t.key ? 'on' : ''} onClick={() => onChange(t.key)}>{t.label}{t.count != null && <span className="badge" style={{ marginLeft: 6 }}>{t.count}</span>}</button>)}
    </div>
  );
}

/* ---------- table ---------- */
export type Col<T> = { key: string; header: string; render?: (r: T) => ReactNode; align?: 'right' | 'left'; className?: string };
export function Table<T extends Record<string, any>>({ cols, rows, onRow, empty = 'Nothing to show yet.', caption }: { cols: Col<T>[]; rows: T[]; onRow?: (r: T) => void; empty?: string; caption?: string }) {
  if (!rows.length) return <Empty title={empty} />;
  return (
    <div className="table-wrap">
      <table className="tbl">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead><tr>{cols.map((c) => <th key={c.key} scope="col" className={c.align === 'right' ? 'right' : ''}>{c.header}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id ?? i} className={onRow ? 'clickable' : ''} onClick={onRow ? () => onRow(r) : undefined} onKeyDown={onRow ? (e) => { if (e.key === 'Enter') onRow(r); } : undefined} tabIndex={onRow ? 0 : undefined}>
              {cols.map((c) => <td key={c.key} className={cx(c.align === 'right' && 'right mono', c.className)}>{c.render ? c.render(r) : (r[c.key] ?? '')}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export function Pager({ page, pages, onPage }: { page: number; pages: number; onPage: (p: number) => void }) {
  if (pages <= 1) return null;
  return (
    <nav className="pager" aria-label="Pagination">
      <Btn size="sm" variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</Btn>
      <span className="small">Page {page} of {pages}</span>
      <Btn size="sm" variant="secondary" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</Btn>
    </nav>
  );
}

/* ---------- simple charts (real data only) ---------- */
export function Bars({ data, format }: { data: { label: string; value: number }[]; format?: (n: number) => string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  if (!data.length) return <p className="muted small">No data in this period.</p>;
  return (
    <div>
      <div className="bars" role="img" aria-label={`Bar chart: ${data.map((d) => `${d.label} ${format ? format(d.value) : d.value}`).join(', ')}`}>
        {data.map((d, i) => <div key={i} style={{ height: `${Math.max(2, (d.value / max) * 100)}%` }} title={`${d.label}: ${format ? format(d.value) : d.value}`} />)}
      </div>
      <div className="row spread tiny muted" style={{ marginTop: 4 }}><span>{data[0].label}</span><span>{data[data.length - 1].label}</span></div>
    </div>
  );
}
export function HBars({ data, format }: { data: { label: string; value: number }[]; format?: (n: number) => string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  if (!data.length) return <p className="muted small">No data in this period.</p>;
  return <div className="stack" style={{ '--gap': '10px' } as any}>{data.map((d, i) => <div key={i}><div className="row spread small"><span>{d.label}</span><b className="mono">{format ? format(d.value) : d.value}</b></div><div className="hbar"><div style={{ width: `${(d.value / max) * 100}%` }} /></div></div>)}</div>;
}

export function KV({ items }: { items: [string, ReactNode][] }) {
  return <dl className="facts">{items.filter(([, v]) => v != null && v !== '').map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>;
}
export function Json({ value }: { value: any }) { return <pre className="json">{JSON.stringify(value, null, 2)}</pre>; }
