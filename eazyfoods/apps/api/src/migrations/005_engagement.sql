-- Marketing, advertising, content, reviews, support, messaging, notifications, loyalty, risk

CREATE TABLE campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL, description text,
  starts_at timestamptz, ends_at timestamptz,
  segment_id uuid REFERENCES segments(id),
  promotion_id uuid REFERENCES promotions(id),
  landing_slug text,
  tracking jsonb NOT NULL DEFAULT '{}',
  product_ids uuid[] NOT NULL DEFAULT '{}',
  vendor_ids uuid[] NOT NULL DEFAULT '{}',
  budget numeric(12,2),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','scheduled','active','paused','ended')),
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ad_placements (
  key text PRIMARY KEY,
  label text NOT NULL,
  max_slots int NOT NULL DEFAULT 1
);
CREATE TABLE ads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  placement_key text NOT NULL REFERENCES ad_placements(key),
  campaign_id uuid REFERENCES campaigns(id),
  advertiser_type text NOT NULL DEFAULT 'platform' CHECK (advertiser_type IN ('platform','vendor','external')),
  advertiser_vendor_id uuid REFERENCES vendors(id),
  advertiser_name text,
  title text NOT NULL, subtitle text, image_url text, cta_label text,
  click_url text NOT NULL,
  product_id uuid REFERENCES products(id),
  segment_id uuid REFERENCES segments(id),
  cost_model text NOT NULL DEFAULT 'flat' CHECK (cost_model IN ('flat','cpc','cpm')),
  rate numeric(10,4) NOT NULL DEFAULT 0,
  budget numeric(12,2), spent numeric(12,2) NOT NULL DEFAULT 0,
  starts_at timestamptz, ends_at timestamptz,
  position int NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','paused','ended')),
  impressions int NOT NULL DEFAULT 0, clicks int NOT NULL DEFAULT 0,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_ads_placement ON ads(placement_key, status);

CREATE TABLE homepage_sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('hero','search','category_rail','product_rail','vendor_rail','chef_rail','cuisine_grid','country_grid','collection','banner','editorial','shop_modes')),
  title text,
  subtitle text,
  config jsonb NOT NULL DEFAULT '{}',   -- e.g. {"source":"trending"} | {"collection":"slug"} | {"limit":8}
  position int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  starts_at timestamptz, ends_at timestamptz,
  segment_id uuid REFERENCES segments(id),
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE collections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE, title text NOT NULL, description text, image_url text,
  is_active boolean NOT NULL DEFAULT true,
  starts_at timestamptz, ends_at timestamptz
);
CREATE TABLE collection_items (
  collection_id uuid NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  position int NOT NULL DEFAULT 0,
  PRIMARY KEY (collection_id, product_id)
);

CREATE TABLE articles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  kind text NOT NULL CHECK (kind IN ('blog','recipe','guide','faq','landing')),
  title text NOT NULL, excerpt text, body text NOT NULL DEFAULT '',
  hero_image text,
  recipe jsonb,                          -- {servings, prep_minutes, cook_minutes, steps[], cuisine}
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  author_id uuid REFERENCES users(id),
  seo_title text, seo_description text,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_articles_kind ON articles(kind, status, published_at DESC);
CREATE TABLE article_products (
  article_id uuid NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  label text,                            -- ingredient name as written in the recipe
  quantity int NOT NULL DEFAULT 1,
  position int NOT NULL DEFAULT 0,
  PRIMARY KEY (article_id, product_id)
);

CREATE TABLE search_synonyms (
  term text PRIMARY KEY,
  synonyms text[] NOT NULL
);
CREATE TABLE search_queries (
  id bigserial PRIMARY KEY,
  query text NOT NULL, user_id uuid, anon_id text, result_count int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_search_queries ON search_queries(created_at DESC);

CREATE TABLE favorites (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject_type text NOT NULL CHECK (subject_type IN ('product','vendor','chef')),
  subject_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, subject_type, subject_id)
);
CREATE TABLE wishlists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE wishlist_items (
  wishlist_id uuid NOT NULL REFERENCES wishlists(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (wishlist_id, product_id)
);
CREATE TABLE recently_viewed (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  viewed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, product_id)
);

CREATE TABLE reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  suborder_id uuid NOT NULL REFERENCES suborders(id),   -- reviews must hang off a real delivered order
  subject_type text NOT NULL CHECK (subject_type IN ('product','vendor','driver','order')),
  subject_id uuid NOT NULL,
  rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  title text, body text,
  photos text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'published' CHECK (status IN ('pending','published','hidden','flagged')),
  vendor_response text, responded_at timestamptz, responded_by uuid REFERENCES users(id),
  moderation_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, suborder_id, subject_type, subject_id)
);
CREATE INDEX idx_reviews_subject ON reviews(subject_type, subject_id, status, created_at DESC);

CREATE SEQUENCE ticket_number_seq START 5001;
CREATE TABLE support_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number text NOT NULL UNIQUE,
  requester_id uuid NOT NULL REFERENCES users(id),
  order_id uuid REFERENCES orders(id),
  suborder_id uuid REFERENCES suborders(id),
  vendor_id uuid REFERENCES vendors(id),
  driver_id uuid REFERENCES driver_profiles(user_id),
  category text NOT NULL CHECK (category IN ('missing_items','incorrect_items','late_delivery','damaged','payment_issue','refund_request','vendor_complaint','driver_complaint','driver_issue','vendor_support','other')),
  subject text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','assigned','waiting_customer','waiting_vendor','waiting_driver','resolved','closed')),
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  assigned_to uuid REFERENCES users(id),
  resolution_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);
CREATE TRIGGER trg_tickets_updated BEFORE UPDATE ON support_tickets FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX idx_tickets_status ON support_tickets(status, priority, created_at);
CREATE INDEX idx_tickets_requester ON support_tickets(requester_id);
CREATE INDEX idx_tickets_vendor ON support_tickets(vendor_id) WHERE vendor_id IS NOT NULL;

-- One message table for ticket threads, order chat and dispute threads.
CREATE TABLE messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_type text NOT NULL CHECK (thread_type IN ('ticket','order','dispute')),
  thread_id uuid NOT NULL,
  channel text,                         -- for order threads: customer_vendor | customer_driver | vendor_driver
  sender_id uuid NOT NULL REFERENCES users(id),
  sender_role text NOT NULL,
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  attachments uuid[] NOT NULL DEFAULT '{}',
  is_internal boolean NOT NULL DEFAULT false,   -- staff only notes
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_messages_thread ON messages(thread_type, thread_id, created_at);

CREATE TABLE disputes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid REFERENCES support_tickets(id),
  order_id uuid NOT NULL REFERENCES orders(id),
  suborder_id uuid NOT NULL REFERENCES suborders(id),
  opened_by uuid NOT NULL REFERENCES users(id),
  reason text NOT NULL,
  claimed_amount numeric(12,2),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','vendor_response','under_review','resolved')),
  vendor_response text, vendor_responded_at timestamptz,
  resolution text CHECK (resolution IN ('full_refund','partial_refund','replacement','vendor_credit','customer_credit','no_refund')),
  resolution_amount numeric(12,2),
  resolution_reason text,
  resolved_by uuid REFERENCES users(id), resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_disputes_status ON disputes(status);
CREATE INDEX idx_disputes_vendor ON disputes(suborder_id);

CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL,
  title text NOT NULL, body text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}',
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_notif_user ON notifications(user_id, created_at DESC);
CREATE INDEX idx_notif_unread ON notifications(user_id) WHERE read_at IS NULL;
CREATE TABLE notification_preferences (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL,                 -- notification kind or '*' for default
  email boolean NOT NULL DEFAULT true,
  sms boolean NOT NULL DEFAULT false,
  push boolean NOT NULL DEFAULT true,
  PRIMARY KEY (user_id, kind)
);
CREATE TABLE push_tokens (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token text NOT NULL, platform text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, token)
);

CREATE TABLE loyalty_ledger (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  points int NOT NULL,
  reason text NOT NULL,
  order_id uuid REFERENCES orders(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_loyalty_user ON loyalty_ledger(user_id);
CREATE UNIQUE INDEX uq_loyalty_order_earn ON loyalty_ledger(order_id, reason) WHERE reason = 'order_earn';

CREATE TABLE referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id uuid NOT NULL REFERENCES users(id),
  referred_id uuid NOT NULL UNIQUE REFERENCES users(id),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','rewarded','rejected')),
  first_order_id uuid REFERENCES orders(id),
  reward_amount numeric(12,2),
  rejection_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  rewarded_at timestamptz,
  CHECK (referrer_id <> referred_id)
);

-- Risk signals are prompts for human review, never automatic accusations.
CREATE TABLE risk_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_type text NOT NULL CHECK (subject_type IN ('customer','vendor','driver','order','review','promotion')),
  subject_id uuid NOT NULL,
  kind text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('low','medium','high')),
  details jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','reviewed','dismissed','actioned')),
  dedupe_key text UNIQUE,
  reviewed_by uuid REFERENCES users(id), reviewed_at timestamptz, review_note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_risk_status ON risk_signals(status, severity, created_at DESC);

CREATE TABLE operational_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL, severity text NOT NULL DEFAULT 'medium',
  title text NOT NULL, details jsonb NOT NULL DEFAULT '{}',
  entity_type text, entity_id text,
  dedupe_key text UNIQUE,
  resolved_at timestamptz, resolved_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_alerts_open ON operational_alerts(created_at DESC) WHERE resolved_at IS NULL;

-- Vendor subscription plans and featured listings (revenue streams beyond commission)
CREATE TABLE vendor_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE, name text NOT NULL,
  monthly_price numeric(12,2) NOT NULL DEFAULT 0,
  commission_discount_pct numeric(5,2) NOT NULL DEFAULT 0,
  features jsonb NOT NULL DEFAULT '{}',
  is_active boolean NOT NULL DEFAULT true
);
CREATE TABLE vendor_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES vendors(id),
  plan_id uuid NOT NULL REFERENCES vendor_plans(id),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','cancelled','past_due')),
  current_period_end timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
