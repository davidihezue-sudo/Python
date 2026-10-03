'use client';
import { useEffect, useRef } from 'react';
import { post } from '@/lib/api';

// Records one impression when an ad is at least half visible, then links through the tracked click redirect.
export function AdCard({ ad, hero }: { ad: any; hero?: boolean }) {
  const ref = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    if (!ad?.id || !ref.current) return;
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { post(`/ads/${ad.id}/impression`).catch(() => {}); io.disconnect(); } }, { threshold: 0.5 });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [ad?.id]);
  const href = ad.campaign_id || ad.advertiser_type ? `/api/ads/${ad.id}/click` : ad.click_url;
  if (hero) {
    return (
      <section className="hero" aria-label={ad.title}>
        <img src={ad.image_url ?? '/img/food/hero-lagos.svg'} alt="" />
        <div className="copy"><span className="eyebrow">{ad.sponsored ? 'Sponsored' : 'This week'}</span><h1>{ad.title}</h1>{ad.subtitle && <p>{ad.subtitle}</p>}<a ref={ref} className="btn primary lg" href={href}>{ad.cta_label ?? 'Shop now'}</a></div>
      </section>
    );
  }
  return (
    <a ref={ref} href={href} className="mode-card" style={{ gridTemplateColumns: '1fr 140px' }}>
      <div style={{ padding: 18 }}><span className="eyebrow">{ad.sponsored ? 'Sponsored' : 'Featured'}</span><h3 style={{ margin: '4px 0' }}>{ad.title}</h3><p className="small muted" style={{ margin: 0 }}>{ad.subtitle}</p></div>
      <img src={ad.image_url ?? '/img/food/hero-spice.svg'} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
    </a>
  );
}
