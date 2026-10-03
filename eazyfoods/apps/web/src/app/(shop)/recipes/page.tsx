import Link from 'next/link';
import { sget } from '@/lib/server';
export const metadata = { title: 'Recipes and food guides', description: 'Authentic African and Caribbean recipes with shoppable ingredients, plus guides to spices, staples and cooking techniques.', alternates: { canonical: '/recipes' } };
export default async function Recipes() {
  const [r, g, b] = await Promise.all([sget<any>('/articles?kind=recipe&limit=30'), sget<any>('/articles?kind=guide&limit=12'), sget<any>('/articles?kind=blog&limit=12')]);
  const Grid = ({ items }: { items: any[] }) => <div className="grid cols-4">{items.map((a) => <Link key={a.slug} href={`/articles/${a.slug}`} className="store-card"><div className="cover"><img src={a.hero_image ?? '/img/food/platter.svg'} alt="" loading="lazy" /></div><div className="body"><h3 style={{ margin: 0 }}>{a.title}</h3><p className="small muted" style={{ margin: 0 }}>{a.excerpt}</p></div></Link>)}</div>;
  return (
    <div className="wrap">
      <h1 style={{ margin: '22px 0 6px' }}>Recipes and guides</h1><p className="muted">Every recipe lists the ingredients you can add to your cart in one click.</p>
      <section className="section"><h2>Recipes</h2>{r?.articles?.length ? <Grid items={r.articles} /> : <p className="muted">No recipes published yet.</p>}</section>
      {g?.articles?.length ? <section className="section"><h2>Guides</h2><Grid items={g.articles} /></section> : null}
      {b?.articles?.length ? <section className="section"><h2>Stories</h2><Grid items={b.articles} /></section> : null}
    </div>
  );
}
