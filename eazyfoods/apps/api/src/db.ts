import pg from 'pg';
import { AsyncLocalStorage } from 'node:async_hooks';
import { config } from './config.js';

// BIGINT and NUMERIC come back as JS numbers. Monetary math is done in integer cents (see money.ts).
pg.types.setTypeParser(20, (v) => Number(v));
pg.types.setTypeParser(1700, (v) => Number(v));

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: Number(process.env.DB_POOL_MAX ?? 20) });
pool.on('error', (e) => console.error('[db] idle client error', e.message));

export type Db = pg.Pool | pg.PoolClient;

export async function query<T = any>(sql: string, params: any[] = [], db: Db = pool): Promise<T[]> {
  const r = await db.query(sql, params);
  return r.rows as T[];
}
export async function one<T = any>(sql: string, params: any[] = [], db: Db = pool): Promise<T | null> {
  const rows = await query<T>(sql, params, db);
  return rows[0] ?? null;
}

const effects = new AsyncLocalStorage<(f: () => void) => void>();
/** Run f after the surrounding transaction commits (or immediately when there is none). Used for real-time events. */
export function afterCommit(f: () => void) {
  const defer = effects.getStore();
  if (defer) defer(f); else f();
}

/** Run fn inside a transaction. Retries on serialization/deadlock failures. */
export async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>, attempts = 3): Promise<T> {
  for (let i = 1; ; i++) {
    const c = await pool.connect();
    const pending: (() => void)[] = [];
    try {
      await c.query('BEGIN');
      const out = await effects.run((f) => pending.push(f), () => fn(c));
      await c.query('COMMIT');
      for (const f of pending) { try { f(); } catch { /* effects must not fail the request */ } }
      return out;
    } catch (e: any) {
      await c.query('ROLLBACK').catch(() => {});
      if ((e.code === '40001' || e.code === '40P01') && i < attempts) continue;
      throw e;
    } finally {
      c.release();
    }
  }
}

/** Advisory lock scoped to the current transaction, keyed by arbitrary text. */
export async function advisoryLock(c: pg.PoolClient, key: string) {
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [key]);
}
