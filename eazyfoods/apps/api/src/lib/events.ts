// Real-time fan-out. Events are published locally and through Postgres NOTIFY so that the API
// processes holding SSE connections also hear events raised by the worker process.
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { pool, afterCommit } from '../db.js';
import { config } from '../config.js';

export interface BusEvent { topic: string; type: string; data: any }
const bus = new EventEmitter();
bus.setMaxListeners(0);
const ORIGIN = randomUUID();

export function publish(topic: string, type: string, data: any = {}) {
  afterCommit(() => {
    const ev: BusEvent = { topic, type, data };
    bus.emit('event', ev);
    const payload = JSON.stringify({ o: ORIGIN, ev });
    if (payload.length < 7500) pool.query('SELECT pg_notify($1, $2)', ['ez_events', payload]).catch(() => {});
  });
}

export function subscribe(topics: string[], fn: (e: BusEvent) => void) {
  const set = new Set(topics);
  const h = (e: BusEvent) => { if (set.has(e.topic)) fn(e); };
  bus.on('event', h);
  return () => bus.off('event', h);
}

let bridge: pg.Client | null = null;
export async function startEventBridge() {
  if (bridge) return;
  const c = new pg.Client({ connectionString: config.databaseUrl });
  c.on('error', () => { bridge = null; setTimeout(() => startEventBridge().catch(() => {}), 3000); });
  await c.connect();
  await c.query('LISTEN ez_events');
  c.on('notification', (m) => {
    try {
      const { o, ev } = JSON.parse(m.payload ?? '{}');
      if (o !== ORIGIN) bus.emit('event', ev);
    } catch { /* ignore malformed */ }
  });
  bridge = c;
}
export async function stopEventBridge() { await bridge?.end().catch(() => {}); bridge = null; }
