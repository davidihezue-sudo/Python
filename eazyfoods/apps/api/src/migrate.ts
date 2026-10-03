import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './db.js';
import { config } from './config.js';

const here = dirname(fileURLToPath(import.meta.url));

export async function migrate(opts: { reset?: boolean } = {}) {
  if (opts.reset) {
    if (config.isProd) throw new Error('Refusing to reset a production database');
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  }
  await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const dir = join(here, 'migrations');
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const done = new Set((await pool.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
  const applied: string[] = [];
  for (const f of files) {
    if (done.has(f)) continue;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(readFileSync(join(dir, f), 'utf8'));
      await client.query('INSERT INTO schema_migrations(name) VALUES ($1)', [f]);
      await client.query('COMMIT');
      applied.push(f);
    } catch (e) {
      await client.query('ROLLBACK');
      throw new Error(`Migration ${f} failed: ${(e as Error).message}`);
    } finally {
      client.release();
    }
  }
  return applied;
}

if (process.argv[1] && /migrate\.(ts|js)$/.test(process.argv[1])) {
  migrate({ reset: process.argv.includes('--reset') })
    .then((a) => { console.log(a.length ? `Applied: ${a.join(', ')}` : 'Database is up to date'); return pool.end(); })
    .catch((e) => { console.error(e.message); process.exit(1); });
}
