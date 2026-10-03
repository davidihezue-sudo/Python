// Background worker: runs scheduled tasks and queued jobs. Run as a separate process from the API.
import { registerAllJobs } from './jobs-registry.js';
import { runDueJobs, tickSchedules } from './lib/jobs.js';
import { pool } from './db.js';

registerAllJobs();
let stopping = false;
async function loop() {
  console.log('[worker] started');
  while (!stopping) {
    try {
      await tickSchedules();
      let ran = 0;
      do { ran = await runDueJobs(25); } while (ran >= 25 && !stopping);
    } catch (e) { console.error('[worker] error', (e as Error).message); }
    await new Promise((r) => setTimeout(r, 1000));
  }
  await pool.end();
}
process.on('SIGTERM', () => { stopping = true; });
process.on('SIGINT', () => { stopping = true; });
loop();
