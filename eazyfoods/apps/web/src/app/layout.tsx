import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import { Providers } from '@/components/providers';
import { t } from '@/lib/i18n';

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';
export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: { default: `${t('brand.name')} | African and multicultural food marketplace`, template: `%s | ${t('brand.name')}` },
  description: t('brand.tagline'),
  applicationName: t('brand.name'),
  manifest: '/manifest.webmanifest',
  icons: { icon: '/img/brand/logo-default.svg' },
  openGraph: { type: 'website', siteName: t('brand.name'), title: t('brand.name'), description: t('brand.tagline'), images: ['/img/food/hero-lagos.svg'] },
  robots: { index: true, follow: true },
  alternates: { canonical: '/' },
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#b43f17' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main">{t('nav.skip')}</a>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
