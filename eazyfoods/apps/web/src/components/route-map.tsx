'use client';
// Schematic route diagram drawn from real coordinates (pickup, driver, drop off). Not a street map: no map tiles are loaded.
export function RouteMap({ pickup, dropoff, driver, label }: { pickup?: { lat: number; lng: number } | null; dropoff?: { lat: number; lng: number } | null; driver?: { lat: number; lng: number } | null; label?: string }) {
  const pts = [pickup, dropoff, driver].filter(Boolean) as { lat: number; lng: number }[];
  if (pts.length < 2) return null;
  const minLat = Math.min(...pts.map((p) => p.lat)), maxLat = Math.max(...pts.map((p) => p.lat));
  const minLng = Math.min(...pts.map((p) => p.lng)), maxLng = Math.max(...pts.map((p) => p.lng));
  const padLat = (maxLat - minLat || 0.01) * 0.2, padLng = (maxLng - minLng || 0.01) * 0.2;
  const W = 640, H = 360;
  const sx = (lng: number) => ((lng - (minLng - padLng)) / (maxLng - minLng + 2 * padLng || 1)) * W;
  const sy = (lat: number) => H - ((lat - (minLat - padLat)) / (maxLat - minLat + 2 * padLat || 1)) * H;
  const P = (p: { lat: number; lng: number }) => ({ x: sx(p.lng), y: sy(p.lat) });
  const a = pickup && P(pickup), b = dropoff && P(dropoff), d = driver && P(driver);
  return (
    <div className="map">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label ?? 'Route from the store to your address'} preserveAspectRatio="xMidYMid meet">
        <defs><pattern id="g" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="currentColor" strokeOpacity="0.08" /></pattern></defs>
        <rect width={W} height={H} fill="url(#g)" />
        {a && b && <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#1f5a3f" strokeWidth="3" strokeDasharray="8 8" />}
        {a && <g><circle cx={a.x} cy={a.y} r="12" fill="#e0a017" stroke="#1d1a16" strokeWidth="2" /><text x={a.x + 18} y={a.y + 5} fontSize="15" fontWeight="700" fill="#1d1a16">Store</text></g>}
        {b && <g><circle cx={b.x} cy={b.y} r="12" fill="#b43f17" stroke="#1d1a16" strokeWidth="2" /><text x={b.x + 18} y={b.y + 5} fontSize="15" fontWeight="700" fill="#1d1a16">You</text></g>}
        {d && <g><circle cx={d.x} cy={d.y} r="9" fill="#1d5a8a" stroke="#fff" strokeWidth="3" /><text x={d.x + 16} y={d.y + 5} fontSize="15" fontWeight="700" fill="#1d1a16">Driver</text></g>}
      </svg>
    </div>
  );
}
