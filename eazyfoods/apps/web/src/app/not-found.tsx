import Link from 'next/link';
export default function NotFound() {
  return (<main id="main" className="wrap" style={{ padding: '60px 16px', textAlign: 'center' }}><p className="eyebrow">404</p><h1>We could not find that page</h1><p className="muted">It may have moved, or the seller may no longer be listed.</p><div className="row" style={{ justifyContent: 'center' }}><Link className="btn primary" href="/">Go home</Link><Link className="btn secondary" href="/search">Browse food</Link></div></main>);
}
