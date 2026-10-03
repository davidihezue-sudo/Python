-- Sellers (vendors and chefs), catalog, inventory, kitchen, delivery zones, commission and tax rules

CREATE TABLE vendors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  seller_type text NOT NULL DEFAULT 'grocery' CHECK (seller_type IN ('grocery','specialty','prepared','chef')),
  legal_name text NOT NULL,
  trading_name text NOT NULL,
  description text,
  logo_url text,
  cover_url text,
  email text,
  phone text,
  website text,
  business_type text,
  owner_name text,
  tax_number text,
  line1 text, line2 text, city text, region text, postal_code text,
  country text NOT NULL DEFAULT 'CA',
  lat double precision, lng double precision,
  timezone text NOT NULL DEFAULT 'America/Toronto',
  currency text NOT NULL DEFAULT 'CAD',
  cuisines text[] NOT NULL DEFAULT '{}',
  verification_status text NOT NULL DEFAULT 'draft' CHECK (verification_status IN ('draft','submitted','under_review','info_required','approved','rejected','suspended')),
  verification_note text,
  submitted_at timestamptz, approved_at timestamptz, approved_by uuid REFERENCES users(id),
  accepts_delivery boolean NOT NULL DEFAULT true,
  accepts_pickup boolean NOT NULL DEFAULT true,
  uses_own_drivers boolean NOT NULL DEFAULT false,
  accepting_orders boolean NOT NULL DEFAULT true,       -- manual pause switch
  default_prep_minutes int NOT NULL DEFAULT 20,
  min_order numeric(12,2) NOT NULL DEFAULT 0,
  commission_override_pct numeric(5,2),
  bank_account_last4 text,
  payout_account_ref text,                               -- provider connected account id, never raw bank data
  rating_avg numeric(3,2) NOT NULL DEFAULT 0,
  rating_count int NOT NULL DEFAULT 0,
  is_featured boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE TRIGGER trg_vendors_updated BEFORE UPDATE ON vendors FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX idx_vendors_status ON vendors(verification_status) WHERE deleted_at IS NULL;
CREATE INDEX idx_vendors_geo ON vendors(lat, lng);
CREATE INDEX idx_vendors_name_trgm ON vendors USING gin (f_unaccent(lower(trading_name)) gin_trgm_ops);

CREATE TABLE vendor_users (
  vendor_id uuid NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  member_role text NOT NULL DEFAULT 'staff' CHECK (member_role IN ('owner','manager','staff')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (vendor_id, user_id)
);
CREATE INDEX idx_vendor_users_user ON vendor_users(user_id);

CREATE TABLE vendor_hours (
  vendor_id uuid NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  weekday smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  opens time, closes time,
  is_closed boolean NOT NULL DEFAULT false,
  PRIMARY KEY (vendor_id, weekday)
);
CREATE TABLE vendor_holidays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  day date NOT NULL, note text,
  UNIQUE (vendor_id, day)
);

-- Chef profile extends a vendor row of seller_type 'chef'. Capacity rules live here.
CREATE TABLE chefs (
  vendor_id uuid PRIMARY KEY REFERENCES vendors(id) ON DELETE CASCADE,
  display_name text NOT NULL,
  bio text,
  photo_url text,
  specialties text[] NOT NULL DEFAULT '{}',
  operating_days smallint[] NOT NULL DEFAULT '{1,2,3,4,5,6}',
  daily_capacity int,        -- max portions per day (null = unlimited)
  hourly_capacity int,       -- max portions per hour slot
  concurrent_capacity int,   -- max portions being prepared at once (kitchen capacity)
  portions_accepting boolean NOT NULL DEFAULT true
);
CREATE TABLE capacity_blackouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL, reason text,
  CHECK (ends_at > starts_at)
);
CREATE INDEX idx_blackouts_vendor ON capacity_blackouts(vendor_id, starts_at);

-- Jurisdiction aware compliance. Requirements are data, not code.
CREATE TABLE compliance_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  jurisdiction text NOT NULL,           -- e.g. CA-ON, or * for everywhere
  applies_to text NOT NULL CHECK (applies_to IN ('vendor','chef','driver')),
  doc_type text NOT NULL,
  label text NOT NULL,
  required boolean NOT NULL DEFAULT true,
  warn_days int NOT NULL DEFAULT 30,
  active boolean NOT NULL DEFAULT true,
  UNIQUE (jurisdiction, applies_to, doc_type)
);
CREATE TABLE compliance_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_type text NOT NULL CHECK (owner_type IN ('vendor','driver')),
  owner_id uuid NOT NULL,               -- vendors.id or users.id (driver)
  doc_type text NOT NULL,
  file_id uuid REFERENCES uploaded_files(id),
  reference_number text,
  issue_date date, expiry_date date,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','verified','rejected','expired')),
  review_note text,
  reviewed_by uuid REFERENCES users(id), reviewed_at timestamptz,
  expiry_notified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_compdocs_owner ON compliance_documents(owner_type, owner_id);
CREATE INDEX idx_compdocs_expiry ON compliance_documents(expiry_date) WHERE status = 'verified';

CREATE TABLE categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid REFERENCES categories(id),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  image_url text,
  position int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  seo_title text, seo_description text
);
CREATE INDEX idx_categories_parent ON categories(parent_id);
CREATE TABLE brands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL UNIQUE
);

CREATE TABLE tax_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country text NOT NULL DEFAULT 'CA',
  region text NOT NULL,                 -- province code, or * for all
  tax_class text NOT NULL,              -- standard | zero_rated | prepared | alcohol ...
  name text NOT NULL,
  rate numeric(6,3) NOT NULL CHECK (rate >= 0),
  valid_from date, valid_to date,
  active boolean NOT NULL DEFAULT true,
  UNIQUE (country, region, tax_class, name)
);

CREATE TABLE products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES vendors(id),
  category_id uuid REFERENCES categories(id),
  brand_id uuid REFERENCES brands(id),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  short_description text,
  description text,
  product_type text NOT NULL CHECK (product_type IN ('dry','fresh','frozen','prepared','chef_meal')),
  country_of_origin text,
  cuisine text,
  tags text[] NOT NULL DEFAULT '{}',
  unit text NOT NULL DEFAULT 'each',
  weight_grams int,
  dimensions jsonb,
  tax_class text NOT NULL DEFAULT 'standard',
  min_qty int NOT NULL DEFAULT 1 CHECK (min_qty >= 1),
  max_qty int CHECK (max_qty IS NULL OR max_qty >= 1),
  prep_time_minutes int,
  shelf_life_days int,
  storage_instructions text,
  ingredients_text text,
  allergens text[] NOT NULL DEFAULT '{}',
  dietary text[] NOT NULL DEFAULT '{}',          -- vendor declared
  dietary_verified text[] NOT NULL DEFAULT '{}', -- confirmed by staff with evidence
  nutrition jsonb,
  videos text[] NOT NULL DEFAULT '{}',
  currency text NOT NULL DEFAULT 'CAD',
  tracks_inventory boolean NOT NULL DEFAULT true,
  daily_capacity int,                             -- dish level capacity (chef meals)
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','archived')),
  seo_title text, seo_description text,
  popularity int NOT NULL DEFAULT 0,
  rating_avg numeric(3,2) NOT NULL DEFAULT 0,
  rating_count int NOT NULL DEFAULT 0,
  search_tsv tsvector,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE TRIGGER trg_products_updated BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX idx_products_vendor ON products(vendor_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_products_category ON products(category_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_products_status ON products(status, product_type) WHERE deleted_at IS NULL;
CREATE INDEX idx_products_cuisine ON products(cuisine);
CREATE INDEX idx_products_tsv ON products USING gin (search_tsv);
CREATE INDEX idx_products_name_trgm ON products USING gin (f_unaccent(lower(name)) gin_trgm_ops);
CREATE INDEX idx_products_tags ON products USING gin (tags);

CREATE OR REPLACE FUNCTION products_search_update() RETURNS trigger AS $$
DECLARE bname text;
BEGIN
  SELECT name INTO bname FROM brands WHERE id = NEW.brand_id;
  NEW.search_tsv :=
    setweight(to_tsvector('simple', f_unaccent(coalesce(NEW.name,''))), 'A') ||
    setweight(to_tsvector('simple', f_unaccent(coalesce(bname,'') || ' ' || coalesce(NEW.cuisine,'') || ' ' || coalesce(NEW.country_of_origin,'') || ' ' || array_to_string(NEW.tags,' '))), 'B') ||
    setweight(to_tsvector('simple', f_unaccent(coalesce(NEW.short_description,'') || ' ' || coalesce(NEW.ingredients_text,''))), 'C');
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_products_search BEFORE INSERT OR UPDATE ON products FOR EACH ROW EXECUTE FUNCTION products_search_update();

CREATE TABLE product_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  url text NOT NULL, alt text, position int NOT NULL DEFAULT 0
);
CREATE INDEX idx_product_images ON product_images(product_id, position);

CREATE TABLE product_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  sku text NOT NULL UNIQUE,
  barcode text,
  name text NOT NULL,                                   -- "5 kg", "Family"
  price numeric(12,2) NOT NULL CHECK (price >= 0),
  sale_price numeric(12,2) CHECK (sale_price IS NULL OR (sale_price >= 0 AND sale_price <= price)),
  cost numeric(12,2),
  weight_grams int,
  portions int NOT NULL DEFAULT 1,                      -- chef portions consumed per unit sold
  is_default boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  position int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_variants_updated BEFORE UPDATE ON product_variants FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX idx_variants_product ON product_variants(product_id);
CREATE INDEX idx_variants_barcode ON product_variants(barcode) WHERE barcode IS NOT NULL;

CREATE TABLE price_history (
  id bigserial PRIMARY KEY,
  variant_id uuid NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  old_price numeric(12,2), new_price numeric(12,2),
  old_sale_price numeric(12,2), new_sale_price numeric(12,2),
  changed_by uuid REFERENCES users(id),
  changed_at timestamptz NOT NULL DEFAULT now()
);

-- Inventory. available = on_hand - reserved. The CHECK constraints make overselling impossible at the database level.
CREATE TABLE inventory (
  variant_id uuid PRIMARY KEY REFERENCES product_variants(id) ON DELETE CASCADE,
  vendor_id uuid NOT NULL REFERENCES vendors(id),
  on_hand int NOT NULL DEFAULT 0,
  reserved int NOT NULL DEFAULT 0,
  incoming int NOT NULL DEFAULT 0,
  damaged int NOT NULL DEFAULT 0,
  expired int NOT NULL DEFAULT 0,
  reorder_threshold int NOT NULL DEFAULT 0,
  supplier text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inv_nonneg CHECK (on_hand >= 0 AND reserved >= 0 AND incoming >= 0 AND damaged >= 0 AND expired >= 0),
  CONSTRAINT inv_no_oversell CHECK (reserved <= on_hand)
);
CREATE INDEX idx_inventory_vendor ON inventory(vendor_id);
CREATE TABLE inventory_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id uuid NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  batch_code text NOT NULL,
  quantity int NOT NULL CHECK (quantity >= 0),
  expiry_date date,
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (variant_id, batch_code)
);
CREATE TABLE inventory_movements (
  id bigserial PRIMARY KEY,
  variant_id uuid NOT NULL REFERENCES product_variants(id),
  vendor_id uuid NOT NULL REFERENCES vendors(id),
  kind text NOT NULL CHECK (kind IN ('receive','reserve','release','commit','adjust_add','adjust_remove','damaged','expired','correction','return','recipe_deduct','initial')),
  delta_on_hand int NOT NULL DEFAULT 0,
  delta_reserved int NOT NULL DEFAULT 0,
  on_hand_after int NOT NULL,
  reserved_after int NOT NULL,
  reason text,
  ref_type text, ref_id text,
  actor_user_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_inv_mov_variant ON inventory_movements(variant_id, created_at DESC);
CREATE INDEX idx_inv_mov_ref ON inventory_movements(ref_type, ref_id);

-- Kitchen: ingredients and recipes owned by chefs/prepared food vendors
CREATE TABLE ingredients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  name text NOT NULL,
  unit text NOT NULL,                       -- g, kg, ml, l, each
  cost_per_unit numeric(12,4) NOT NULL DEFAULT 0,
  stock_qty numeric(14,3) NOT NULL DEFAULT 0 CHECK (stock_qty >= 0),
  reorder_threshold numeric(14,3) NOT NULL DEFAULT 0,
  UNIQUE (vendor_id, name)
);
CREATE TABLE recipes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  name text NOT NULL,
  yield_servings numeric(8,2) NOT NULL CHECK (yield_servings > 0),
  prep_minutes int NOT NULL DEFAULT 0,
  cook_minutes int NOT NULL DEFAULT 0,
  steps text[] NOT NULL DEFAULT '{}',
  selling_price numeric(12,2),
  deduct_ingredients boolean NOT NULL DEFAULT false,   -- optional stock deduction on sale
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE recipe_ingredients (
  recipe_id uuid NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  ingredient_id uuid NOT NULL REFERENCES ingredients(id),
  quantity numeric(14,3) NOT NULL CHECK (quantity > 0),
  PRIMARY KEY (recipe_id, ingredient_id)
);

-- Delivery zones (platform wide or per vendor) and configurable fee rules
CREATE TABLE delivery_zones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL CHECK (scope IN ('platform','vendor')),
  vendor_id uuid REFERENCES vendors(id) ON DELETE CASCADE,
  name text NOT NULL,
  zone_type text NOT NULL CHECK (zone_type IN ('radius','postal','polygon')),
  center_lat double precision, center_lng double precision, radius_km numeric(6,2),
  postal_prefixes text[] NOT NULL DEFAULT '{}',
  polygon jsonb,                                         -- [[lng,lat],...]
  fee_model text NOT NULL DEFAULT 'distance' CHECK (fee_model IN ('flat','distance')),
  base_fee numeric(12,2) NOT NULL DEFAULT 0,
  per_km_fee numeric(12,2) NOT NULL DEFAULT 0,
  free_over numeric(12,2),
  min_order numeric(12,2) NOT NULL DEFAULT 0,
  max_distance_km numeric(6,2),
  priority int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  CHECK ((scope = 'vendor') = (vendor_id IS NOT NULL))
);
CREATE INDEX idx_zones_vendor ON delivery_zones(vendor_id) WHERE vendor_id IS NOT NULL;

-- Surcharge / multiplier / discount rules for the delivery fee engine (distance, weight, time, demand, weather ...)
CREATE TABLE delivery_fee_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('surcharge','multiplier','discount')),
  amount numeric(12,2),                 -- surcharge/discount in dollars
  multiplier numeric(6,3),              -- multiplier kind
  conditions jsonb NOT NULL DEFAULT '{}',
  priority int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true
);

CREATE TABLE commission_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  scope text NOT NULL CHECK (scope IN ('global','category','vendor')),
  vendor_id uuid REFERENCES vendors(id) ON DELETE CASCADE,
  category_id uuid REFERENCES categories(id) ON DELETE CASCADE,
  percent numeric(5,2) NOT NULL CHECK (percent >= 0 AND percent <= 100),
  fixed_fee numeric(12,2) NOT NULL DEFAULT 0,
  valid_from timestamptz, valid_to timestamptz,        -- promotional commission windows
  is_active boolean NOT NULL DEFAULT true
);
