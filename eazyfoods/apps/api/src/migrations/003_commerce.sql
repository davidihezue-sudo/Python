-- Promotions, carts, orders (customer order > vendor suborder), payments, refunds, ledger, payouts

CREATE TABLE segments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  rule jsonb NOT NULL,                  -- {"type":"lapsed","days":45} see segments module
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE promotions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  code citext UNIQUE,
  type text NOT NULL CHECK (type IN ('percent','fixed','free_delivery','bogo','spend_get','first_order')),
  value numeric(12,2) NOT NULL DEFAULT 0 CHECK (value >= 0),
  max_discount numeric(12,2),
  min_order numeric(12,2) NOT NULL DEFAULT 0,
  starts_at timestamptz, ends_at timestamptz,
  usage_limit int, per_customer_limit int,
  vendor_id uuid REFERENCES vendors(id),       -- set for vendor created promotions
  funded_by text NOT NULL DEFAULT 'platform' CHECK (funded_by IN ('platform','vendor')),
  scope jsonb NOT NULL DEFAULT '{}',           -- vendor_ids, category_ids, product_ids, product_types
  segment_id uuid REFERENCES segments(id),
  stackable boolean NOT NULL DEFAULT false,
  stack_group text,
  priority int NOT NULL DEFAULT 0,
  auto_apply boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','paused','archived')),
  config jsonb NOT NULL DEFAULT '{}',          -- bogo: buy_qty/get_qty. spend_get: spend + reward. first_order: discount_type
  redemption_count int NOT NULL DEFAULT 0,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
);
CREATE TRIGGER trg_promotions_updated BEFORE UPDATE ON promotions FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX idx_promotions_active ON promotions(status, starts_at, ends_at);

CREATE TABLE carts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  anon_token text UNIQUE,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','converted','abandoned','merged')),
  currency text NOT NULL DEFAULT 'CAD',
  address_id uuid REFERENCES addresses(id) ON DELETE SET NULL,
  coupon_codes text[] NOT NULL DEFAULT '{}',
  tip numeric(12,2) NOT NULL DEFAULT 0 CHECK (tip >= 0),
  fulfillment jsonb NOT NULL DEFAULT '{}',   -- { "<vendorId>": {"mode":"delivery|pickup","scheduled_for":iso|null} }
  use_credit boolean NOT NULL DEFAULT false,
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  reminders_sent int NOT NULL DEFAULT 0,
  last_reminder_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_cart_active_user ON carts(user_id) WHERE status = 'active' AND user_id IS NOT NULL;
CREATE INDEX idx_cart_activity ON carts(last_activity_at) WHERE status = 'active';
CREATE TABLE cart_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_id uuid NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
  variant_id uuid NOT NULL REFERENCES product_variants(id),
  quantity int NOT NULL CHECK (quantity > 0),
  note text,
  added_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cart_id, variant_id)
);

CREATE SEQUENCE order_number_seq START 10001;

CREATE TABLE orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number text NOT NULL UNIQUE,
  user_id uuid NOT NULL REFERENCES users(id),
  status text NOT NULL DEFAULT 'pending_payment' CHECK (status IN ('pending_payment','confirmed','in_progress','completed','cancelled','refunded','partially_refunded','disputed')),
  payment_status text NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid','authorized','paid','failed','voided','partially_refunded','refunded')),
  currency text NOT NULL DEFAULT 'CAD',
  subtotal numeric(12,2) NOT NULL,
  vendor_discount_total numeric(12,2) NOT NULL DEFAULT 0,
  platform_discount_total numeric(12,2) NOT NULL DEFAULT 0,
  tax_total numeric(12,2) NOT NULL DEFAULT 0,
  delivery_fee_total numeric(12,2) NOT NULL DEFAULT 0,       -- gross fee before waivers
  delivery_subsidy_total numeric(12,2) NOT NULL DEFAULT 0,   -- waived by promotions or vendors
  service_fee_total numeric(12,2) NOT NULL DEFAULT 0,
  tip_total numeric(12,2) NOT NULL DEFAULT 0,
  total numeric(12,2) NOT NULL,                              -- what the customer owes
  credit_applied numeric(12,2) NOT NULL DEFAULT 0,
  amount_charged numeric(12,2) NOT NULL,                     -- total - credit_applied (card)
  delivery_address jsonb,
  coupon_codes text[] NOT NULL DEFAULT '{}',
  contact_name text, contact_phone text, contact_email text,
  customer_note text,
  quote jsonb,                                               -- full priced quote kept for audit
  idempotency_key text,
  payment_deadline timestamptz,
  placed_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, idempotency_key),
  CHECK (total >= 0 AND amount_charged >= 0)
);
CREATE TRIGGER trg_orders_updated BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX idx_orders_user ON orders(user_id, placed_at DESC);
CREATE INDEX idx_orders_status ON orders(status, placed_at DESC);
CREATE INDEX idx_orders_placed ON orders(placed_at DESC);
CREATE INDEX idx_orders_deadline ON orders(payment_deadline) WHERE status = 'pending_payment';

CREATE TABLE suborders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  vendor_id uuid NOT NULL REFERENCES vendors(id),
  suffix text NOT NULL,
  number text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending_payment' CHECK (status IN (
    'pending_payment','confirmed','vendor_accepted','preparing','ready_for_pickup','driver_assigned','driver_arriving',
    'picked_up','in_transit','delivered','completed','cancelled','refunded','partially_refunded','disputed')),
  fulfillment_type text NOT NULL CHECK (fulfillment_type IN ('delivery_platform','delivery_vendor','pickup')),
  requested_for timestamptz,                 -- null = ASAP
  prep_minutes int NOT NULL DEFAULT 20,
  estimated_ready_at timestamptz,
  promised_at timestamptz,
  distance_km numeric(7,2),
  zone_id uuid REFERENCES delivery_zones(id),
  items_subtotal numeric(12,2) NOT NULL,
  vendor_discount numeric(12,2) NOT NULL DEFAULT 0,
  platform_discount numeric(12,2) NOT NULL DEFAULT 0,
  tax_total numeric(12,2) NOT NULL DEFAULT 0,
  delivery_fee numeric(12,2) NOT NULL DEFAULT 0,
  delivery_subsidy_vendor numeric(12,2) NOT NULL DEFAULT 0,
  delivery_subsidy_platform numeric(12,2) NOT NULL DEFAULT 0,
  service_fee numeric(12,2) NOT NULL DEFAULT 0,
  tip numeric(12,2) NOT NULL DEFAULT 0,
  commission_rate numeric(5,2) NOT NULL DEFAULT 0,
  commission_amount numeric(12,2) NOT NULL DEFAULT 0,
  fixed_fee_amount numeric(12,2) NOT NULL DEFAULT 0,
  vendor_net numeric(12,2) NOT NULL DEFAULT 0,
  customer_total numeric(12,2) NOT NULL,
  refunded_amount numeric(12,2) NOT NULL DEFAULT 0,
  portions int NOT NULL DEFAULT 0,
  pickup_code text,
  vendor_note text,
  cancel_reason text, cancelled_by text,
  accepted_at timestamptz, ready_at timestamptz, picked_up_at timestamptz, delivered_at timestamptz,
  completed_at timestamptz, cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, suffix),
  CHECK (refunded_amount >= 0)
);
CREATE TRIGGER trg_suborders_updated BEFORE UPDATE ON suborders FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX idx_suborders_vendor ON suborders(vendor_id, status, created_at DESC);
CREATE INDEX idx_suborders_order ON suborders(order_id);
CREATE INDEX idx_suborders_status ON suborders(status, updated_at);

CREATE TABLE order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  suborder_id uuid NOT NULL REFERENCES suborders(id) ON DELETE CASCADE,
  vendor_id uuid NOT NULL REFERENCES vendors(id),
  product_id uuid NOT NULL REFERENCES products(id),
  variant_id uuid NOT NULL REFERENCES product_variants(id),
  name text NOT NULL, variant_name text, sku text NOT NULL, image_url text,
  product_type text NOT NULL,
  unit_price numeric(12,2) NOT NULL,
  quantity int NOT NULL CHECK (quantity > 0),
  line_subtotal numeric(12,2) NOT NULL,
  discount_vendor numeric(12,2) NOT NULL DEFAULT 0,
  discount_platform numeric(12,2) NOT NULL DEFAULT 0,
  tax_class text NOT NULL,
  tax_rate numeric(6,3) NOT NULL DEFAULT 0,
  tax_amount numeric(12,2) NOT NULL DEFAULT 0,
  portions int NOT NULL DEFAULT 0,
  commission numeric(12,2) NOT NULL DEFAULT 0,
  refunded_qty int NOT NULL DEFAULT 0,
  note text,
  CHECK (refunded_qty >= 0 AND refunded_qty <= quantity)
);
CREATE INDEX idx_order_items_suborder ON order_items(suborder_id);
CREATE INDEX idx_order_items_order ON order_items(order_id);
CREATE INDEX idx_order_items_product ON order_items(product_id);

CREATE TABLE order_status_history (
  id bigserial PRIMARY KEY,
  entity_type text NOT NULL CHECK (entity_type IN ('order','suborder','delivery')),
  entity_id uuid NOT NULL,
  from_status text, to_status text NOT NULL,
  actor_user_id uuid, actor_role text, note text,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_status_hist ON order_status_history(entity_type, entity_id, at);

CREATE TABLE promotion_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  promotion_id uuid NOT NULL REFERENCES promotions(id),
  user_id uuid NOT NULL REFERENCES users(id),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  amount numeric(12,2) NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','reversed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (promotion_id, order_id)
);
CREATE INDEX idx_redemptions_user ON promotion_redemptions(user_id, promotion_id);

CREATE TABLE payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id),
  provider text NOT NULL,
  provider_ref text,
  status text NOT NULL DEFAULT 'requires_payment' CHECK (status IN ('requires_payment','authorized','captured','failed','voided','partially_refunded','refunded')),
  amount numeric(12,2) NOT NULL,
  currency text NOT NULL DEFAULT 'CAD',
  capture_mode text NOT NULL DEFAULT 'automatic',
  card_brand text, card_last4 text,
  failure_code text, failure_internal text,
  refunded_amount numeric(12,2) NOT NULL DEFAULT 0,
  idempotency_key text UNIQUE,
  authorized_at timestamptz, captured_at timestamptz, voided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_payment_live ON payments(order_id) WHERE status IN ('authorized','captured','partially_refunded','refunded');
CREATE INDEX idx_payments_order ON payments(order_id);
CREATE TABLE payment_transactions (
  id bigserial PRIMARY KEY,
  payment_id uuid NOT NULL REFERENCES payments(id),
  kind text NOT NULL CHECK (kind IN ('authorize','capture','void','refund','chargeback','transfer','payout')),
  amount numeric(12,2) NOT NULL,
  status text NOT NULL CHECK (status IN ('succeeded','failed','pending')),
  provider_ref text,
  meta jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_paytx_payment ON payment_transactions(payment_id);

CREATE TABLE refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id),
  suborder_id uuid REFERENCES suborders(id),
  payment_id uuid REFERENCES payments(id),
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  breakdown jsonb NOT NULL,              -- {items, tax, delivery, service_fee}
  lines jsonb,                           -- [{order_item_id, qty}]
  reason text NOT NULL,
  bearer text NOT NULL CHECK (bearer IN ('vendor','platform')),
  status text NOT NULL DEFAULT 'succeeded' CHECK (status IN ('pending','succeeded','failed')),
  provider_ref text,
  dispute_id uuid,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_refunds_order ON refunds(order_id);
CREATE INDEX idx_refunds_created ON refunds(created_at DESC);

-- Immutable double entry ledger. debit = money/assets owed in, credit = obligations and revenue.
CREATE TABLE ledger_entries (
  id bigserial PRIMARY KEY,
  txn_id uuid NOT NULL,
  entry_type text NOT NULL,              -- capture | commission | delivery_fee | refund | driver_pay | payout | adjustment
  account text NOT NULL CHECK (account IN (
    'cash_clearing','liability_vendor','liability_driver','liability_tax','liability_customer_credit',
    'revenue_commission','revenue_delivery','revenue_service_fee','expense_promo','expense_driver_pay','expense_refund')),
  party_type text, party_id uuid,
  order_id uuid, suborder_id uuid, delivery_job_id uuid, refund_id uuid, payout_id uuid,
  currency text NOT NULL DEFAULT 'CAD',
  debit numeric(14,2) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit numeric(14,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  memo text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((debit = 0) <> (credit = 0))
);
CREATE INDEX idx_ledger_txn ON ledger_entries(txn_id);
CREATE INDEX idx_ledger_party ON ledger_entries(party_type, party_id, account);
CREATE INDEX idx_ledger_order ON ledger_entries(order_id);
CREATE INDEX idx_ledger_suborder ON ledger_entries(suborder_id);
CREATE INDEX idx_ledger_created ON ledger_entries(created_at);

CREATE OR REPLACE FUNCTION ledger_immutable() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'ledger_entries is append-only'; END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_ledger_no_update BEFORE UPDATE OR DELETE ON ledger_entries FOR EACH ROW EXECUTE FUNCTION ledger_immutable();

-- Every ledger transaction must balance at commit time.
CREATE OR REPLACE FUNCTION ledger_check_balanced() RETURNS trigger AS $$
DECLARE d numeric; c numeric;
BEGIN
  SELECT coalesce(sum(debit),0), coalesce(sum(credit),0) INTO d, c FROM ledger_entries WHERE txn_id = NEW.txn_id;
  IF d <> c THEN RAISE EXCEPTION 'Unbalanced ledger transaction % (debit %, credit %)', NEW.txn_id, d, c; END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;
CREATE CONSTRAINT TRIGGER trg_ledger_balanced AFTER INSERT ON ledger_entries
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ledger_check_balanced();

CREATE TABLE payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payee_type text NOT NULL CHECK (payee_type IN ('vendor','driver')),
  payee_id uuid NOT NULL,
  currency text NOT NULL DEFAULT 'CAD',
  period_start timestamptz, period_end timestamptz,
  gross numeric(12,2) NOT NULL DEFAULT 0,
  commission numeric(12,2) NOT NULL DEFAULT 0,
  fees numeric(12,2) NOT NULL DEFAULT 0,
  refunds numeric(12,2) NOT NULL DEFAULT 0,
  adjustments numeric(12,2) NOT NULL DEFAULT 0,
  net numeric(12,2) NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','paid','failed','held','reversed')),
  hold_reason text,
  provider_ref text, failure_reason text,
  scheduled_for timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz,
  statement jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_payouts_payee ON payouts(payee_type, payee_id, created_at DESC);
CREATE INDEX idx_payouts_status ON payouts(status);
CREATE TABLE payout_items (
  id bigserial PRIMARY KEY,
  payout_id uuid NOT NULL REFERENCES payouts(id) ON DELETE CASCADE,
  suborder_id uuid, delivery_job_id uuid,
  description text NOT NULL,
  gross numeric(12,2) NOT NULL DEFAULT 0,
  commission numeric(12,2) NOT NULL DEFAULT 0,
  fees numeric(12,2) NOT NULL DEFAULT 0,
  refunds numeric(12,2) NOT NULL DEFAULT 0,
  net numeric(12,2) NOT NULL
);
CREATE TABLE payout_ledger_links (
  ledger_entry_id bigint PRIMARY KEY REFERENCES ledger_entries(id),
  payout_id uuid NOT NULL REFERENCES payouts(id) ON DELETE CASCADE
);

CREATE TABLE customer_credit_entries (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  amount numeric(12,2) NOT NULL,       -- positive grants credit, negative spends it
  reason text NOT NULL,
  order_id uuid REFERENCES orders(id),
  dispute_id uuid,
  expires_at timestamptz,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_credit_user ON customer_credit_entries(user_id);
