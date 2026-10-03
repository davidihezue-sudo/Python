import { buildApp } from './app.js';
import { config } from './config.js';
import { pool } from './db.js';

const app = await buildApp({ bridge: true });
await app.listen({ port: config.port, host: config.host });
const shutdown = async () => { await app.close(); await pool.end(); process.exit(0); };
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
