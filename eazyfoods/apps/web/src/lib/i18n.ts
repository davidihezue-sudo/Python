// Message catalog lookup. Add fr.json (and others) and register them here; components only call t('key').
import en from '@/i18n/en.json';

const catalogs: Record<string, any> = { en };
let current = 'en';
export const setLocale = (l: string) => { if (catalogs[l]) current = l; };
export function t(key: string, vars: Record<string, string | number> = {}): string {
  const find = (c: any) => key.split('.').reduce((o, k) => (o == null ? o : o[k]), c);
  const raw = find(catalogs[current]) ?? find(catalogs.en) ?? key;
  return typeof raw === 'string' ? raw.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? '')) : key;
}
