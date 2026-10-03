'use client';
import { useEffect, useState } from 'react';
import { Tabs } from './ui';
export function SellTabs({ vendor, chef, driver }: { vendor: React.ReactNode; chef: React.ReactNode; driver: React.ReactNode }) {
  const [tab, setTab] = useState('vendor');
  useEffect(() => { const h = window.location.hash.replace('#', ''); if (h === 'chefs') setTab('chef'); if (h === 'drivers') setTab('driver'); }, []);
  const copy: Record<string, string> = { vendor: 'Open a store: grocery, specialty or restaurant. Upload your catalogue, manage stock with barcodes and get paid on a schedule.', chef: 'Cook at home and sell to your neighbourhood. You set your daily portion limit and which days you cook.', driver: 'Deliver on your own schedule. Pay is shown on every offer before you accept it.' };
  return (<section id="apply" aria-label="Apply"><Tabs value={tab} onChange={setTab} tabs={[{ key: 'vendor', label: 'Open a store' }, { key: 'chef', label: 'Become a chef' }, { key: 'driver', label: 'Drive with us' }]} /><p className="muted">{copy[tab]}</p><div style={{ maxWidth: 780 }}>{tab === 'vendor' ? vendor : tab === 'chef' ? chef : driver}</div></section>);
}
