import { sget } from '@/lib/server';
export const metadata = { title: 'Help and frequently asked questions', description: 'Answers about ordering, delivery, chef orders, refunds, allergens and payments on EAZyfoods.', alternates: { canonical: '/faq' } };
export default async function Faq() {
  const list = (await sget<any>('/articles?kind=faq&limit=50'))?.articles ?? [];
  const full = (await Promise.all(list.map((a: any) => sget<any>(`/articles/${a.slug}`)))).map((x) => x?.article).filter(Boolean);
  const ld = { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: full.map((a: any) => ({ '@type': 'Question', name: a.title, acceptedAnswer: { '@type': 'Answer', text: a.body } })) };
  return (
    <div className="wrap" style={{ maxWidth: 820 }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }} />
      <h1 style={{ margin: '22px 0 12px' }}>Help and FAQ</h1>
      <div className="stack" style={{ '--gap': '8px' } as any}>{full.map((a: any) => <details key={a.slug} className="card pad"><summary className="bold" style={{ cursor: 'pointer' }}>{a.title}</summary><p style={{ marginTop: 10 }}>{a.body}</p></details>)}</div>
      <div className="card pad" style={{ marginTop: 24 }}><h2 style={{ fontSize: '1.2rem' }}>Still need help?</h2><p>Signed in customers can contact support about an order from their <a href="/account/support">support page</a>. We reply in the app and by email.</p></div>
    </div>
  );
}
