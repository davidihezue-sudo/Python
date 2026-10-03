// Geography helpers and a pluggable geocoder. The "local" geocoder knows Greater Toronto Area postal
// prefixes so the whole platform works without a maps key. Google or Mapbox can replace it via env.
import { config } from '../config.js';

export interface LatLng { lat: number; lng: number }
const R = 6371;
const rad = (d: number) => (d * Math.PI) / 180;

export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
/** Road distance estimate. Straight line distance times a circuity factor; swap for a routing API in production. */
export const roadKm = (a: LatLng, b: LatLng, factor = 1.3) => Math.round(haversineKm(a, b) * factor * 100) / 100;

export function pointInPolygon(p: LatLng, poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > p.lat !== yj > p.lat && p.lng < ((xj - xi) * (p.lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function minutesFor(distanceKm: number, speedKmh: number) {
  return Math.max(3, Math.round((distanceKm / Math.max(speedKmh, 5)) * 60));
}

/** Round coordinates to ~1km so drivers see a general area before accepting a job. */
export const approx = (p: LatLng): LatLng => ({ lat: Math.round(p.lat * 100) / 100, lng: Math.round(p.lng * 100) / 100 });

const FSA: Record<string, LatLng> = {
  M4W: { lat: 43.6769, lng: -79.3771 }, M5V: { lat: 43.6426, lng: -79.3871 }, M5H: { lat: 43.6505, lng: -79.3840 },
  M6H: { lat: 43.6689, lng: -79.4372 }, M4C: { lat: 43.6953, lng: -79.3183 }, M1B: { lat: 43.8067, lng: -79.1944 },
  M1P: { lat: 43.7576, lng: -79.2732 }, M9W: { lat: 43.7068, lng: -79.5942 }, M3C: { lat: 43.7254, lng: -79.3405 },
  M2N: { lat: 43.7701, lng: -79.4081 }, M6K: { lat: 43.6368, lng: -79.4281 }, M4M: { lat: 43.6595, lng: -79.3402 },
  M1K: { lat: 43.7273, lng: -79.2635 }, M8V: { lat: 43.6054, lng: -79.5013 }, M9V: { lat: 43.7391, lng: -79.5883 },
  L5B: { lat: 43.5931, lng: -79.6413 }, L5N: { lat: 43.5948, lng: -79.7580 }, L4Z: { lat: 43.6141, lng: -79.6413 },
  L5L: { lat: 43.5390, lng: -79.6850 }, L6Y: { lat: 43.6717, lng: -79.7552 }, L6T: { lat: 43.7234, lng: -79.7165 },
  L6R: { lat: 43.7330, lng: -79.7520 }, L1S: { lat: 43.8540, lng: -79.0200 }, L3R: { lat: 43.8600, lng: -79.3000 },
  L4K: { lat: 43.8100, lng: -79.5000 }, L6A: { lat: 43.8500, lng: -79.5000 }, L7L: { lat: 43.3870, lng: -79.7900 },
};
const CITIES: Record<string, LatLng> = {
  toronto: { lat: 43.6532, lng: -79.3832 }, mississauga: { lat: 43.5890, lng: -79.6441 }, brampton: { lat: 43.7315, lng: -79.7624 },
  scarborough: { lat: 43.7731, lng: -79.2578 }, 'north york': { lat: 43.7615, lng: -79.4111 }, etobicoke: { lat: 43.6205, lng: -79.5132 },
  markham: { lat: 43.8561, lng: -79.3370 }, vaughan: { lat: 43.8361, lng: -79.4983 }, pickering: { lat: 43.8384, lng: -79.0868 },
  ajax: { lat: 43.8509, lng: -79.0204 }, oakville: { lat: 43.4675, lng: -79.6877 }, burlington: { lat: 43.3255, lng: -79.7990 },
};

export interface GeocodeInput { line1?: string; city?: string; region?: string; postal_code?: string; country?: string }
export async function geocode(a: GeocodeInput): Promise<LatLng | null> {
  const mp = config.maps;
  try {
    if (mp.provider === 'google' && mp.googleKey) {
      const q = [a.line1, a.city, a.region, a.postal_code, a.country].filter(Boolean).join(', ');
      const r = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(q)}&key=${mp.googleKey}`);
      const j: any = await r.json();
      const loc = j.results?.[0]?.geometry?.location;
      if (loc) return { lat: loc.lat, lng: loc.lng };
    }
    if (mp.provider === 'mapbox' && mp.mapboxToken) {
      const q = [a.line1, a.city, a.region, a.postal_code].filter(Boolean).join(', ');
      const r = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json?limit=1&access_token=${mp.mapboxToken}`);
      const j: any = await r.json();
      const c = j.features?.[0]?.center;
      if (c) return { lat: c[1], lng: c[0] };
    }
  } catch { /* fall through to local */ }
  const fsa = (a.postal_code ?? '').replace(/\s/g, '').toUpperCase().slice(0, 3);
  if (FSA[fsa]) return jitter(FSA[fsa], a.line1 ?? '');
  const city = (a.city ?? '').trim().toLowerCase();
  if (CITIES[city]) return jitter(CITIES[city], a.line1 ?? '');
  return null;
}
// Deterministic small offset so different street addresses in one area are not identical points.
function jitter(p: LatLng, seed: string): LatLng {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return { lat: p.lat + (((h % 100) - 50) / 100) * 0.004, lng: p.lng + ((((h >> 8) % 100) - 50) / 100) * 0.004 };
}
