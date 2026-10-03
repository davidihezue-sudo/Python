// Outbound messaging adapters. The "dev" adapters store messages in message_outbox so every flow
// works locally. SendGrid and Twilio adapters need credentials and are not exercised by automated tests.
import { query } from '../db.js';
import { config } from '../config.js';

export interface Outbound { channel: 'email' | 'sms' | 'push'; to: string; userId?: string; subject?: string; body: string; data?: any }

async function record(m: Outbound, provider: string, status: 'sent' | 'failed', error?: string) {
  await query(
    `INSERT INTO message_outbox(channel, recipient, user_id, subject, body, data, provider, status, error) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [m.channel, m.to, m.userId ?? null, m.subject ?? null, m.body, JSON.stringify(m.data ?? {}), provider, status, error ?? null]);
}

export async function send(m: Outbound) {
  try {
    if (m.channel === 'email' && config.email.provider === 'sendgrid' && config.email.sendgridKey) {
      const r = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST', headers: { Authorization: `Bearer ${config.email.sendgridKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ personalizations: [{ to: [{ email: m.to }] }], from: { email: config.email.from.replace(/.*<|>/g, '') }, subject: m.subject, content: [{ type: 'text/plain', value: m.body }] }),
      });
      if (!r.ok) throw new Error(`SendGrid ${r.status}`);
      return record(m, 'sendgrid', 'sent');
    }
    if (m.channel === 'sms' && config.sms.provider === 'twilio' && config.sms.twilioSid) {
      const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${config.sms.twilioSid}/Messages.json`, {
        method: 'POST',
        headers: { Authorization: 'Basic ' + Buffer.from(`${config.sms.twilioSid}:${config.sms.twilioToken}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ To: m.to, From: config.sms.twilioFrom ?? '', Body: m.body }),
      });
      if (!r.ok) throw new Error(`Twilio ${r.status}`);
      return record(m, 'twilio', 'sent');
    }
    // Push via Firebase is a documented integration point; falls back to the dev outbox.
    return record(m, 'dev', 'sent');
  } catch (e: any) {
    await record(m, config[m.channel === 'email' ? 'email' : m.channel === 'sms' ? 'sms' : 'push'].provider, 'failed', e.message);
    throw e;
  }
}
