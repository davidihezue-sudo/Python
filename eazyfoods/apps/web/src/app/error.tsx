'use client';
export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (<main id="main" className="wrap" style={{ padding: '60px 16px', textAlign: 'center' }}><h1>Something went wrong</h1><p className="muted">We hit a problem loading this page. Nothing was charged or changed.</p><button className="btn primary" onClick={reset}>Try again</button></main>);
}
