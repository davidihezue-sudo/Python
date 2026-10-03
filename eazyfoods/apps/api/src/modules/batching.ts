// Delivery batching: decide whether jobs can share a driver and compute the stop sequence with ETAs.
import { haversineKm, minutesFor, roadKm, type LatLng } from '../lib/geo.js';

export interface BatchJob {
  id: string; pickup: LatLng; dropoff: LatLng; needsCold: boolean; readyAt: Date | null; picked: boolean;
}
export interface BatchCfg { enabled: boolean; max_batch: number; max_pickup_gap_km: number; max_dropoff_gap_km: number; max_detour_minutes: number; max_ready_gap_minutes: number; cold_max_minutes: number }
export interface Stop { type: 'pickup' | 'dropoff'; jobId: string; lat: number; lng: number; etaMinutes: number }

function permutations<T>(a: T[]): T[][] {
  if (a.length <= 1) return [a];
  return a.flatMap((x, i) => permutations([...a.slice(0, i), ...a.slice(i + 1)]).map((p) => [x, ...p]));
}

/** Best stop order by total travel time, pickups before their own dropoffs. Exact for the small batch sizes allowed. */
export function planRoute(start: LatLng, jobs: BatchJob[], speedKmh: number): { stops: Stop[]; totalMinutes: number } {
  const stops: { type: 'pickup' | 'dropoff'; job: BatchJob }[] = [];
  for (const j of jobs) { if (!j.picked) stops.push({ type: 'pickup', job: j }); stops.push({ type: 'dropoff', job: j }); }
  let best: { stops: Stop[]; total: number } | null = null;
  for (const perm of permutations(stops)) {
    const seen = new Set<string>();
    let ok = true;
    for (const s of perm) {
      if (s.type === 'pickup') seen.add(s.job.id);
      else if (!s.job.picked && !seen.has(s.job.id)) { ok = false; break; }
    }
    if (!ok) continue;
    let pos = start, t = 0;
    const out: Stop[] = [];
    for (const s of perm) {
      const p = s.type === 'pickup' ? s.job.pickup : s.job.dropoff;
      t += minutesFor(roadKm(pos, p), speedKmh) + (s.type === 'pickup' ? 2 : 3); // handover time at each stop
      out.push({ type: s.type, jobId: s.job.id, lat: p.lat, lng: p.lng, etaMinutes: t });
      pos = p;
    }
    if (!best || t < best.total) best = { stops: out, total: t };
  }
  return { stops: best?.stops ?? [], totalMinutes: best?.total ?? 0 };
}

export interface BatchCheck { ok: boolean; reason?: string; route?: Stop[]; totalMinutes?: number }

/** Never batch orders that violate the configured constraints. */
export function canBatch(driverPos: LatLng, jobs: BatchJob[], cfg: BatchCfg, speedKmh: number): BatchCheck {
  if (jobs.length <= 1) {
    const r = planRoute(driverPos, jobs, speedKmh);
    return { ok: true, route: r.stops, totalMinutes: r.totalMinutes };
  }
  if (!cfg.enabled) return { ok: false, reason: 'Batching is disabled' };
  if (jobs.length > cfg.max_batch) return { ok: false, reason: 'Too many orders in one batch' };
  for (let i = 0; i < jobs.length; i++) {
    for (let k = i + 1; k < jobs.length; k++) {
      const a = jobs[i], b = jobs[k];
      if (!a.picked && !b.picked && haversineKm(a.pickup, b.pickup) > cfg.max_pickup_gap_km) return { ok: false, reason: 'Pickups are too far apart' };
      if (haversineKm(a.dropoff, b.dropoff) > cfg.max_dropoff_gap_km) return { ok: false, reason: 'Drop offs are too far apart' };
      if (a.readyAt && b.readyAt && Math.abs(a.readyAt.getTime() - b.readyAt.getTime()) / 60000 > cfg.max_ready_gap_minutes) return { ok: false, reason: 'Orders are not ready at similar times' };
    }
  }
  const batch = planRoute(driverPos, jobs, speedKmh);
  // Detour: each drop off may be later than if delivered alone, but only by the configured limit.
  for (const j of jobs) {
    const solo = planRoute(driverPos, [j], speedKmh).stops.find((s) => s.type === 'dropoff' && s.jobId === j.id)!.etaMinutes;
    const inBatch = batch.stops.find((s) => s.type === 'dropoff' && s.jobId === j.id)!.etaMinutes;
    if (inBatch - solo > cfg.max_detour_minutes) return { ok: false, reason: 'The detour would delay an order too much' };
    if (j.needsCold && inBatch > cfg.cold_max_minutes) return { ok: false, reason: 'Cold items would be in transit too long' };
  }
  return { ok: true, route: batch.stops, totalMinutes: batch.totalMinutes };
}
