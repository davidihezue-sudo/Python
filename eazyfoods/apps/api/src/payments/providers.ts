// Payment processor adapters. The sandbox adapter behaves like a card processor in test mode:
// it accepts test tokens, can decline, and never moves real money. Stripe Connect is the production
// adapter and needs STRIPE_SECRET_KEY (it is written against the public REST API and is not exercised by the automated tests).
import { randomBytes } from 'node:crypto';
import { config } from '../config.js';
import type { Cents } from '../money.js';

export interface AuthorizeInput { amount: Cents; currency: string; token: string; idempotencyKey: string; capture: boolean; description: string; metadata: Record<string, string> }
export interface AuthorizeResult { ok: boolean; ref?: string; captured?: boolean; brand?: string; last4?: string; failureCode?: string; failureInternal?: string }
export interface PaymentProvider {
  name: string;
  authorize(i: AuthorizeInput): Promise<AuthorizeResult>;
  capture(ref: string, amount: Cents, idempotencyKey: string): Promise<{ ok: boolean; ref: string; failureInternal?: string }>;
  void(ref: string): Promise<{ ok: boolean }>;
  refund(ref: string, amount: Cents, idempotencyKey: string): Promise<{ ok: boolean; ref: string; failureInternal?: string }>;
  transfer(destination: string | null, amount: Cents, memo: string, idempotencyKey: string): Promise<{ ok: boolean; ref: string; failureInternal?: string }>;
}

/** Test tokens, modelled on common processor test cards. */
export const SANDBOX_TOKENS: Record<string, { ok: boolean; brand?: string; last4?: string; code?: string }> = {
  tok_visa: { ok: true, brand: 'visa', last4: '4242' },
  tok_visa_debit: { ok: true, brand: 'visa', last4: '5556' },
  tok_mastercard: { ok: true, brand: 'mastercard', last4: '4444' },
  tok_amex: { ok: true, brand: 'amex', last4: '8431' },
  tok_declined: { ok: false, brand: 'visa', last4: '0002', code: 'card_declined' },
  tok_insufficient_funds: { ok: false, brand: 'visa', last4: '9995', code: 'insufficient_funds' },
  tok_expired: { ok: false, brand: 'visa', last4: '0069', code: 'expired_card' },
  tok_processing_error: { ok: false, brand: 'visa', last4: '0119', code: 'processing_error' },
};

class SandboxProvider implements PaymentProvider {
  name = 'sandbox';
  private seen = new Map<string, AuthorizeResult>();
  async authorize(i: AuthorizeInput): Promise<AuthorizeResult> {
    const prior = this.seen.get(i.idempotencyKey);
    if (prior) return prior;
    const t = SANDBOX_TOKENS[i.token];
    let res: AuthorizeResult;
    if (!t) res = { ok: false, failureCode: 'invalid_token', failureInternal: `Unknown sandbox token ${i.token.slice(0, 12)}` };
    else if (!t.ok) res = { ok: false, brand: t.brand, last4: t.last4, failureCode: t.code, failureInternal: `Sandbox decline ${t.code}` };
    else res = { ok: true, ref: `sbx_pi_${randomBytes(8).toString('hex')}`, captured: i.capture, brand: t.brand, last4: t.last4 };
    this.seen.set(i.idempotencyKey, res);
    return res;
  }
  async capture(ref: string) { return { ok: true, ref: `${ref}_cap` }; }
  async void() { return { ok: true }; }
  async refund(ref: string) { return { ok: true, ref: `sbx_re_${randomBytes(6).toString('hex')}` }; }
  async transfer() { return { ok: true, ref: `sbx_tr_${randomBytes(6).toString('hex')}` }; }
}

class StripeProvider implements PaymentProvider {
  name = 'stripe';
  private async call(path: string, body: Record<string, any>, idem: string) {
    const r = await fetch(`https://api.stripe.com/v1/${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.payments.stripeSecretKey}`, 'Content-Type': 'application/x-www-form-urlencoded', 'Idempotency-Key': idem },
      body: new URLSearchParams(flatten(body)),
    });
    return { status: r.status, json: (await r.json()) as any };
  }
  async authorize(i: AuthorizeInput): Promise<AuthorizeResult> {
    const { json } = await this.call('payment_intents', {
      amount: i.amount, currency: i.currency.toLowerCase(), payment_method: i.token, confirm: 'true', capture_method: i.capture ? 'automatic' : 'manual',
      description: i.description, metadata: i.metadata, automatic_payment_methods: { enabled: 'true', allow_redirects: 'never' }, transfer_group: i.metadata.order_number,
    }, i.idempotencyKey);
    if (json.error) return { ok: false, failureCode: json.error.decline_code ?? json.error.code ?? 'card_declined', failureInternal: json.error.message };
    const ok = ['requires_capture', 'succeeded'].includes(json.status);
    const card = json.latest_charge ? undefined : undefined;
    return { ok, ref: json.id, captured: json.status === 'succeeded', failureCode: ok ? undefined : 'card_declined', failureInternal: ok ? undefined : `Intent status ${json.status}`, brand: card, last4: undefined };
  }
  async capture(ref: string, amount: Cents, idem: string) {
    const { json } = await this.call(`payment_intents/${ref}/capture`, { amount_to_capture: amount }, idem);
    return { ok: !json.error, ref, failureInternal: json.error?.message };
  }
  async void(ref: string) { const { json } = await this.call(`payment_intents/${ref}/cancel`, {}, `void:${ref}`); return { ok: !json.error }; }
  async refund(ref: string, amount: Cents, idem: string) {
    const { json } = await this.call('refunds', { payment_intent: ref, amount }, idem);
    return { ok: !json.error, ref: json.id ?? ref, failureInternal: json.error?.message };
  }
  async transfer(destination: string | null, amount: Cents, memo: string, idem: string) {
    if (!destination) return { ok: false, ref: '', failureInternal: 'Payee has no connected payout account' };
    const { json } = await this.call('transfers', { amount, currency: 'cad', destination, description: memo }, idem);
    return { ok: !json.error, ref: json.id ?? '', failureInternal: json.error?.message };
  }
}
function flatten(o: Record<string, any>, prefix = ''): [string, string][] {
  const out: [string, string][] = [];
  for (const [k, v] of Object.entries(o)) {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v !== null && typeof v === 'object') out.push(...flatten(v, key)); else out.push([key, String(v)]);
  }
  return out;
}

let instance: PaymentProvider | null = null;
export function getProvider(): PaymentProvider {
  if (!instance) instance = config.payments.provider === 'stripe' && config.payments.stripeSecretKey ? new StripeProvider() : new SandboxProvider();
  return instance;
}
export const isSandbox = () => getProvider().name === 'sandbox';
