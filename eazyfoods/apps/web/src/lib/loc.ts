import { cookies } from 'next/headers';
// Delivery location chosen by the visitor. Stored by the client as "lat,lng,label".
export async function serverLoc(): Promise<{ lat: number; lng: number; label: string } | null> {
  const raw = (await cookies()).get('ez_loc')?.value;
  if (!raw) return null;
  const [lat, lng, ...rest] = decodeURIComponent(raw).split(',');
  const a = Number(lat), b = Number(lng);
  return Number.isFinite(a) && Number.isFinite(b) ? { lat: a, lng: b, label: rest.join(',') } : null;
}
