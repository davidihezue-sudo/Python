import { query, one, pool, type Db } from '../db.js';

export interface TrackOpts { userId?: string | null; anonId?: string | null; entityType?: string; entityId?: string; campaignId?: string | null; adId?: string | null; props?: Record<string, any> }
export async function trackEvent(name: string, o: TrackOpts = {}, db: Db = pool) {
  await query(
    `INSERT INTO analytics_events(name, user_id, anon_id, entity_type, entity_id, campaign_id, ad_id, props) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [name, o.userId ?? null, o.anonId ?? null, o.entityType ?? null, o.entityId ?? null, o.campaignId ?? null, o.adId ?? null, JSON.stringify(o.props ?? {})], db);
}
