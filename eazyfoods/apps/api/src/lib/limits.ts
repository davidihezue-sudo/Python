// Rate limit helpers. Production limits are always enforced; tests relax them unless strict mode is requested.
import { config } from '../config.js';
export const limits = { strict: false };
export const rl = (max: number) => ({ config: { rateLimit: { max: () => (config.isTest && !limits.strict ? 100000 : max), timeWindow: '1 minute' } } });
