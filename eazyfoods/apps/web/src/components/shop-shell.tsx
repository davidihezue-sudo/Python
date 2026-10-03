'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useAuth, useCart, useLoc } from './providers';
import { Btn, Icon, Input, Modal, Spinner, useToast, cx } from './ui';
import { get, post, qs } from '@/lib/api';
import { money } from '@/lib/format';
import { t } from '@/lib/i18n';
import { useDebounced } from '@/hooks/useApi';

export function Logo() { return <Link href="/" className="logo" aria-label="EAZyfoods home">EAZy<b>foods</b></Link>; }

function SearchBox() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 200);
  const [sugg, setSugg] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [idx, setIdx] = useState(-1);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (dq.trim().length < 2) { setSugg([]); return; }
    let live = true;
    get(`/products/autocomplete${qs({ q: dq })}`).then((d) => { if (live) { setSugg(d.suggestions ?? []); setOpen(true); } }).catch(() => {});
    return () => { live = false; };
  }, [dq]);
  useEffect(() => { const h = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); }; document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h); }, []);
  const go = (to: string) => { setOpen(false); router.push(to); };
  const hrefOf = (s: any) => (s.type === 'product' ? `/p/${s.value}` : s.type === 'vendor' ? `/stores/${s.value}` : s.type === 'chef' ? `/chefs/${s.value}` : s.type === 'category' ? `/c/${s.value}` : s.type === 'cuisine' ? `/cuisine/${encodeURIComponent(s.value)}` : `/search?q=${encodeURIComponent(s.label)}`);
  return (
    <div className="search-box" ref={box} role="search">
      <Icon name="search" size={18} />
      <form onSubmit={(e) => { e.preventDefault(); if (idx >= 0 && sugg[idx]) go(hrefOf(sugg[idx])); else if (q.trim()) go(`/search?q=${encodeURIComponent(q.trim())}`); }}>
        <label htmlFor="site-search" className="sr-only">{t('nav.search')}</label>
        <input id="site-search" className="input" type="search" placeholder={t('nav.search')} value={q} autoComplete="off" role="combobox" aria-expanded={open && sugg.length > 0} aria-controls="suggest-list" aria-activedescendant={idx >= 0 ? `sg-${idx}` : undefined}
          onChange={(e) => { setQ(e.target.value); setIdx(-1); }} onFocus={() => sugg.length && setOpen(true)}
          onKeyDown={(e) => { if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(sugg.length - 1, i + 1)); } else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(-1, i - 1)); } else if (e.key === 'Escape') setOpen(false); }} />
      </form>
      {open && sugg.length > 0 && (
        <div className="suggest" id="suggest-list" role="listbox">
          {sugg.map((s, i) => (
            <div key={i} id={`sg-${i}`} role="option" aria-selected={i === idx} onMouseDown={(e) => { e.preventDefault(); go(hrefOf(s)); }}>
              <span>{s.label}</span><span className="muted small">{s.hint ?? ({ vendor: 'Store', chef: 'Chef', category: 'Category', cuisine: 'Cuisine', brand: 'Brand' } as any)[s.type] ?? ''}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function LocationPicker() {
  const { loc, setLoc, pickerOpen, setPickerOpen } = useLoc();
  const { me } = useAuth();
  const toast = useToast();
  const router = useRouter();
  const [postal, setPostal] = useState('');
  const [busy, setBusy] = useState(false);
  const [addrs, setAddrs] = useState<any[]>([]);
  useEffect(() => { if (pickerOpen && me?.user) get('/customers/me/addresses').then((d) => setAddrs(d.addresses ?? [])).catch(() => {}); }, [pickerOpen, me?.user]);
  if (!pickerOpen) return null;
  const apply = (l: any) => { setLoc(l); setPickerOpen(false); toast(`Delivering to ${l.label}`); router.refresh(); };
  return (
    <Modal title="Where should we deliver?" onClose={() => setPickerOpen(false)}>
      <div className="stack">
        <p className="muted">Enter your postal code and we will show the stores and chefs that deliver to you, with real delivery fees.</p>
        <form className="row" style={{ alignItems: 'flex-end' }} onSubmit={async (e) => {
          e.preventDefault(); setBusy(true);
          try { const g = await post('/locate', { postal_code: postal }); apply({ lat: g.lat, lng: g.lng, label: g.postal_code ?? postal.toUpperCase(), postal: g.postal_code, city: g.city, region: g.region }); } catch (er: any) { toast(er.message, 'bad'); } finally { setBusy(false); }
        }}>
          <div className="grow"><Input label="Postal code" value={postal} onChange={setPostal} placeholder="M5R 1H3" autoComplete="postal-code" /></div>
          <Btn variant="primary" type="submit" busy={busy}>Use this</Btn>
        </form>
        {typeof navigator !== 'undefined' && 'geolocation' in navigator && <Btn variant="secondary" onClick={() => navigator.geolocation.getCurrentPosition((p) => apply({ lat: p.coords.latitude, lng: p.coords.longitude, label: 'Current location' }), () => toast('Location permission was not given. Enter a postal code instead.', 'bad'))}><Icon name="pin" size={16} /> Use my current location</Btn>}
        {addrs.length > 0 && (<div><h3>Saved addresses</h3><div className="stack" style={{ '--gap': '8px' } as any}>{addrs.map((a) => <button key={a.id} className="choice" onClick={() => apply({ lat: a.lat, lng: a.lng, label: `${a.label ?? 'Address'}: ${a.postal_code}`, postal: a.postal_code, city: a.city, region: a.region })}><span><b>{a.label ?? 'Address'}</b><br /><span className="small muted">{a.line1}, {a.city} {a.postal_code}</span></span></button>)}</div></div>)}
        {loc && <Btn variant="ghost" onClick={() => { setLoc(null); setPickerOpen(false); router.refresh(); }}>Clear location</Btn>}
      </div>
    </Modal>
  );
}

export function CartDrawer() {
  const { cart, open, setOpen, setQty, busy } = useCart();
  const pathname = usePathname();
  useEffect(() => { setOpen(false); }, [pathname, setOpen]);
  useEffect(() => { if (!open) return; const k = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false); document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k); }, [open, setOpen]);
  if (!open) return null;
  const groups = cart?.quote?.groups ?? [];
  return (
    <>
      <div className="overlay" style={{ zIndex: 84 }} onClick={() => setOpen(false)} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label="Your cart">
        <div className="modal-head"><h2 style={{ margin: 0, fontSize: '1.25rem' }}>{t('cart.title')}</h2><button className="icon-btn" onClick={() => setOpen(false)} aria-label="Close cart"><Icon name="x" /></button></div>
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {!groups.length ? <div className="empty"><h3>{t('cart.empty')}</h3><p>{t('cart.emptySub')}</p></div> : groups.map((g: any) => (
            <section key={g.vendorId}>
              <div style={{ padding: '10px 18px', background: 'var(--paper-2)' }} className="bold small">{g.vendorName}</div>
              {g.lines.map((l: any) => (
                <div key={l.variantId} className="line-item" style={{ gridTemplateColumns: '56px 1fr auto' }}>
                  <img src={l.imageUrl ?? '/img/food/meal.svg'} alt="" width={56} height={56} style={{ width: 56, height: 56 }} />
                  <div><div className="bold small">{l.name}</div><div className="muted tiny">{l.variantName}</div><div className="small">{money(l.unitPrice)}</div></div>
                  <div className="qty" role="group" aria-label={`Quantity for ${l.name}`}><button disabled={busy} onClick={() => setQty(l.variantId, l.qty - 1)} aria-label="Decrease">−</button><output>{l.qty}</output><button disabled={busy} onClick={() => setQty(l.variantId, l.qty + 1)} aria-label="Increase">+</button></div>
                </div>
              ))}
            </section>
          ))}
        </div>
        {!!groups.length && <div style={{ padding: 18, borderTop: '1px solid var(--line)' }} className="stack"><div className="row spread"><span>{t('common.subtotal')}</span><b>{money(cart.quote.totals.subtotal)}</b></div><Link className="btn primary block" href="/cart">View cart and checkout</Link></div>}
      </aside>
    </>
  );
}

export function Header() {
  const { me } = useAuth();
  const { count, setOpen } = useCart();
  const { loc, setPickerOpen } = useLoc();
  const [menu, setMenu] = useState(false);
  const pathname = usePathname();
  useEffect(() => setMenu(false), [pathname]);
  const roles = me?.roles ?? [];
  const staff = roles.some((r) => !['customer', 'driver'].includes(r));
  const portals: { href: string; label: string }[] = [];
  if (me?.memberships?.length) portals.push({ href: me.memberships[0].seller_type === 'chef' ? '/chef' : '/vendor', label: me.memberships[0].seller_type === 'chef' ? 'Chef portal' : 'Vendor portal' });
  if (me?.driver) portals.push({ href: '/driver', label: 'Driver app' });
  if (staff) portals.push({ href: '/admin', label: 'Admin' });
  if (me?.permissions?.includes('marketing.manage')) portals.push({ href: '/marketing', label: 'Marketing' });
  const cur = (h: string) => (pathname === h || pathname.startsWith(h + '/') ? 'page' : undefined);
  return (
    <header className="site-header">
      <div className="topline"><div className="wrap"><span>African and multicultural food from local stores and home chefs</span><span className="hide-sm"><Link href="/sell">{t('nav.sell')}</Link> · <Link href="/faq">{t('nav.help')}</Link></span></div></div>
      <div className="wrap">
        <div className="header-row">
          <div className="row"><Logo />
            <button className="location-btn hide-sm" onClick={() => setPickerOpen(true)} aria-label={loc ? `Delivering to ${loc.label}. Change location` : 'Set delivery location'}><Icon name="pin" size={16} /><span className="small">{loc ? loc.label : t('nav.setLocation')}</span></button>
          </div>
          <SearchBox />
          <nav className="row" aria-label="Main">
            <div className="nav-links">
              <Link href="/search" aria-current={cur('/search')}>{t('nav.shop')}</Link>
              <Link href="/stores" aria-current={cur('/stores')}>{t('nav.stores')}</Link>
              <Link href="/chefs" aria-current={cur('/chefs')}>{t('nav.chefs')}</Link>
              <Link href="/recipes" aria-current={cur('/recipes')}>{t('nav.recipes')}</Link>
            </div>
            <button className="icon-btn" onClick={() => setOpen(true)} aria-label={`${t('nav.cart')}, ${count} items`}><Icon name="cart" />{count > 0 && <span className="badge-dot" aria-hidden="true">{count}</span>}</button>
            {me?.user ? (
              <div style={{ position: 'relative' }}>
                <button className="icon-btn" onClick={() => setMenu((m) => !m)} aria-expanded={menu} aria-haspopup="menu" aria-label="Account menu"><Icon name="user" />{(me.unreadNotifications ?? 0) > 0 && <span className="badge-dot" aria-hidden="true">{me.unreadNotifications}</span>}</button>
                {menu && (
                  <div className="menu" role="menu" onKeyDown={(e) => e.key === 'Escape' && setMenu(false)}>
                    <div className="small muted" style={{ padding: '6px 12px' }}>{me.user.full_name}</div>
                    <Link role="menuitem" href="/account/orders">{t('nav.orders')}</Link><Link role="menuitem" href="/account">{t('nav.account')}</Link><Link role="menuitem" href="/account/favorites">Favourites</Link><Link role="menuitem" href="/account/notifications">Notifications</Link><Link role="menuitem" href="/account/loyalty">Rewards and credit</Link>
                    {portals.map((p) => <Link key={p.href} role="menuitem" href={p.href}>{p.label}</Link>)}
                    <LogoutItem />
                  </div>
                )}
              </div>
            ) : (<Link className="btn sm" href="/login">{t('nav.signIn')}</Link>)}
          </nav>
        </div>
      </div>
    </header>
  );
}
function LogoutItem() { const { logout } = useAuth(); return <button role="menuitem" onClick={logout}>{t('nav.signOut')}</button>; }

export function BottomNav() {
  const pathname = usePathname();
  const { count, setOpen } = useCart();
  const items = [{ href: '/', label: 'Home', icon: 'home' }, { href: '/search', label: 'Browse', icon: 'search' }, { href: '/account/orders', label: 'Orders', icon: 'bag' }, { href: '/account', label: 'Account', icon: 'user' }];
  return (
    <nav className="bottom-nav" aria-label="Quick navigation">
      {items.map((i) => <Link key={i.href} href={i.href} aria-current={pathname === i.href ? 'page' : undefined}><Icon name={i.icon} size={22} />{i.label}</Link>)}
      <button style={{ display: 'none' }} onClick={() => setOpen(true)} aria-hidden="true" tabIndex={-1}>{count}</button>
    </nav>
  );
}

export function Footer() {
  return (
    <footer className="site-footer">
      <div className="wrap">
        <div className="grid cols-4" style={{ '--gap': '28px' } as any}>
          <div><div className="logo" style={{ color: '#fff' }}>EAZy<b>foods</b></div><p className="small" style={{ marginTop: 10 }}>{t('brand.tagline')}</p></div>
          <div><h4>Shop</h4><ul><li><Link href="/search">All products</Link></li><li><Link href="/stores">Stores</Link></li><li><Link href="/chefs">Home chefs</Link></li><li><Link href="/recipes">Recipes</Link></li></ul></div>
          <div><h4>Sell and deliver</h4><ul><li><Link href="/sell">Sell on EAZyfoods</Link></li><li><Link href="/sell#chefs">Cook as a chef</Link></li><li><Link href="/sell#drivers">Drive with us</Link></li></ul></div>
          <div><h4>Help</h4><ul><li><Link href="/faq">FAQ</Link></li><li><Link href="/account/support">Contact support</Link></li></ul></div>
        </div>
        <p className="tiny" style={{ marginTop: 28, opacity: 0.8 }}>© {new Date().getFullYear()} EAZyfoods. Prices in Canadian dollars. Taxes shown at checkout.</p>
      </div>
    </footer>
  );
}

export function ShopShell({ children }: { children: React.ReactNode }) {
  return (<><Header /><main id="main" tabIndex={-1} style={{ paddingBottom: 40 }}>{children}</main><Footer /><BottomNav /><CartDrawer /><LocationPicker /></>);
}
void cx; void Spinner;
