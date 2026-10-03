export const money = (n: number | string | null | undefined, currency = 'CAD') =>
  new Intl.NumberFormat('en-CA', { style: 'currency', currency }).format(Number(n ?? 0));
export const date = (d: string | Date | null | undefined, opts: Intl.DateTimeFormatOptions = { dateStyle: 'medium' }) => (d ? new Intl.DateTimeFormat('en-CA', opts).format(new Date(d)) : '');
export const dateTime = (d: string | Date | null | undefined) => date(d, { dateStyle: 'medium', timeStyle: 'short' });
export const time = (d: string | Date | null | undefined) => date(d, { timeStyle: 'short' });
export function relative(d: string | Date): string {
  const s = Math.round((new Date(d).getTime() - Date.now()) / 1000);
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  const abs = Math.abs(s);
  if (abs < 60) return rtf.format(s, 'second');
  if (abs < 3600) return rtf.format(Math.round(s / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(s / 3600), 'hour');
  return rtf.format(Math.round(s / 86400), 'day');
}
export const pct = (n: number | null | undefined) => (n == null ? 'n/a' : `${n}%`);
export const label = (s: string) => s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
export const km = (n: number | null | undefined) => (n == null ? '' : `${n.toFixed(1)} km`);
export const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;
export const productUrl = (slug: string) => `/p/${slug}`;
