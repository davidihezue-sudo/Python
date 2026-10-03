// Portal routing by host name. vendor.eazyfoods.ca, chef.eazyfoods.ca and so on map to their own areas of the same
// codebase, so each experience can later be deployed independently. On localhost the portals live under /vendor, /chef etc.
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const PORTALS = ['vendor', 'chef', 'driver', 'admin', 'marketing'];

export function proxy(req: NextRequest) {
  const host = (req.headers.get('host') ?? '').split(':')[0];
  const sub = host.split('.')[0];
  const { pathname } = req.nextUrl;
  if (PORTALS.includes(sub) && host.split('.').length > 2 && !pathname.startsWith(`/${sub}`) && !pathname.startsWith('/api') && !pathname.startsWith('/_next') && !pathname.startsWith('/img')) {
    const url = req.nextUrl.clone();
    url.pathname = `/${sub}${pathname === '/' ? '' : pathname}`;
    return NextResponse.rewrite(url);
  }
  return NextResponse.next();
}
export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico|img/).*)'] };
