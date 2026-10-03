import { Suspense } from 'react';
import { ApplyForm } from '@/components/auth-forms';
import { SellTabs } from '@/components/sell-tabs';
export const metadata = { title: 'Sell, cook or drive with EAZyfoods', description: 'Open a store, cook as a home chef or deliver with EAZyfoods. Apply online and start earning from your community.', alternates: { canonical: '/sell' } };
export default function Sell() {
  return (
    <div className="wrap">
      <section className="section"><span className="eyebrow">Grow with us</span><h1>Sell your food, cook for your neighbours, or drive for us</h1><p className="muted" style={{ maxWidth: 680 }}>EAZyfoods connects local African, Caribbean and multicultural food businesses with customers who are looking for them. You set your prices, hours and delivery areas. Commission rates and payout schedules are shown in your portal before you earn anything.</p></section>
      <SellTabs vendor={<ApplyForm kind="vendor" />} chef={<ApplyForm kind="chef" />} driver={<ApplyForm kind="driver" />} />
    </div>
  );
}
void Suspense;
