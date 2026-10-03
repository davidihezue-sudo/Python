export const metadata = { title: 'Driver app', robots: { index: false }, manifest: '/driver.webmanifest' };
export default function L({ children }: { children: React.ReactNode }) { return <main id="main" tabIndex={-1}>{children}</main>; }
