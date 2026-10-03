-- Drivers, vehicles, delivery jobs, dispatch offers, batches, earnings

CREATE TABLE driver_profiles (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  legal_name text NOT NULL,
  phone text NOT NULL,
  address_line1 text, city text, region text, postal_code text,
  licence_number text, licence_expiry date,
  verification_status text NOT NULL DEFAULT 'draft' CHECK (verification_status IN ('draft','submitted','under_review','info_required','approved','rejected','suspended')),
  verification_note text,
  approved_at timestamptz, approved_by uuid REFERENCES users(id),
  availability text NOT NULL DEFAULT 'offline' CHECK (availability IN ('offline','online')),
  current_lat double precision, current_lng double precision, location_updated_at timestamptz,
  rating_avg numeric(3,2) NOT NULL DEFAULT 0,
  rating_count int NOT NULL DEFAULT 0,
  offers_received int NOT NULL DEFAULT 0,
  offers_accepted int NOT NULL DEFAULT 0,
  jobs_completed int NOT NULL DEFAULT 0,
  jobs_cancelled int NOT NULL DEFAULT 0,
  payout_account_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_drivers_updated BEFORE UPDATE ON driver_profiles FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX idx_drivers_avail ON driver_profiles(availability, verification_status);

CREATE TABLE vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES driver_profiles(user_id) ON DELETE CASCADE,
  vehicle_type text NOT NULL CHECK (vehicle_type IN ('car','bike','ebike','scooter','van')),
  make text, model text, year int, colour text, plate text,
  insurance_expiry date,
  is_active boolean NOT NULL DEFAULT true,
  has_cold_storage boolean NOT NULL DEFAULT false
);
CREATE INDEX idx_vehicles_driver ON vehicles(driver_id);

CREATE TABLE driver_locations (
  id bigserial PRIMARY KEY,
  driver_id uuid NOT NULL REFERENCES driver_profiles(user_id) ON DELETE CASCADE,
  lat double precision NOT NULL, lng double precision NOT NULL,
  heading real, speed_kmh real,
  delivery_job_id uuid,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_driver_loc ON driver_locations(driver_id, recorded_at DESC);

CREATE TABLE delivery_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid REFERENCES driver_profiles(user_id),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','cancelled')),
  route jsonb,                    -- ordered stops with ETAs
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE delivery_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  suborder_id uuid NOT NULL UNIQUE REFERENCES suborders(id),
  order_id uuid NOT NULL REFERENCES orders(id),
  vendor_id uuid NOT NULL REFERENCES vendors(id),
  batch_id uuid REFERENCES delivery_batches(id),
  status text NOT NULL DEFAULT 'waiting_for_ready' CHECK (status IN (
    'waiting_for_ready','awaiting_driver','offered','assigned','at_pickup','picked_up','in_transit','delivered','failed','cancelled')),
  driver_id uuid REFERENCES driver_profiles(user_id),
  pickup_lat double precision NOT NULL, pickup_lng double precision NOT NULL, pickup_address text,
  dropoff_lat double precision NOT NULL, dropoff_lng double precision NOT NULL,
  distance_km numeric(7,2) NOT NULL,
  est_minutes int NOT NULL,
  weight_grams int NOT NULL DEFAULT 0,
  needs_cold boolean NOT NULL DEFAULT false,
  priority int NOT NULL DEFAULT 0,
  customer_fee numeric(12,2) NOT NULL DEFAULT 0,     -- what the customer paid for delivery
  driver_pay numeric(12,2) NOT NULL DEFAULT 0,       -- computed when assigned
  pay_breakdown jsonb,
  platform_margin numeric(12,2) NOT NULL DEFAULT 0,  -- customer_fee - driver_pay (excludes tip)
  tip numeric(12,2) NOT NULL DEFAULT 0,
  delivery_pin text,
  pin_attempts int NOT NULL DEFAULT 0,
  proof jsonb,                                       -- {pin:true, photo_file_id, gps:{lat,lng,distance_m}, signature, at}
  ready_at timestamptz,
  assigned_at timestamptz, picked_up_at timestamptz, delivered_at timestamptz,
  dispatch_attempts int NOT NULL DEFAULT 0,
  failure_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_jobs_updated BEFORE UPDATE ON delivery_jobs FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX idx_djobs_status ON delivery_jobs(status, created_at);
CREATE INDEX idx_djobs_driver ON delivery_jobs(driver_id, status);
CREATE INDEX idx_djobs_order ON delivery_jobs(order_id);

CREATE TABLE delivery_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES delivery_jobs(id) ON DELETE CASCADE,
  driver_id uuid NOT NULL REFERENCES driver_profiles(user_id),
  status text NOT NULL DEFAULT 'offered' CHECK (status IN ('offered','accepted','rejected','expired','withdrawn')),
  score numeric(10,3),
  est_pay numeric(12,2) NOT NULL,
  pickup_distance_km numeric(7,2),
  is_batch boolean NOT NULL DEFAULT false,
  offered_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  responded_at timestamptz
);
CREATE INDEX idx_offers_job ON delivery_offers(job_id, status);
CREATE INDEX idx_offers_driver ON delivery_offers(driver_id, status);
CREATE UNIQUE INDEX uq_offer_open_per_job ON delivery_offers(job_id) WHERE status = 'offered';

CREATE TABLE driver_earnings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES driver_profiles(user_id),
  job_id uuid REFERENCES delivery_jobs(id),
  kind text NOT NULL DEFAULT 'delivery' CHECK (kind IN ('delivery','cancellation_compensation','adjustment')),
  base numeric(12,2) NOT NULL DEFAULT 0,
  distance_pay numeric(12,2) NOT NULL DEFAULT 0,
  time_pay numeric(12,2) NOT NULL DEFAULT 0,
  peak_bonus numeric(12,2) NOT NULL DEFAULT 0,
  surge numeric(12,2) NOT NULL DEFAULT 0,
  guarantee_topup numeric(12,2) NOT NULL DEFAULT 0,
  multi_order_bonus numeric(12,2) NOT NULL DEFAULT 0,
  promo_bonus numeric(12,2) NOT NULL DEFAULT 0,
  tip numeric(12,2) NOT NULL DEFAULT 0,
  total numeric(12,2) NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_earning_job ON driver_earnings(job_id) WHERE kind = 'delivery';
CREATE INDEX idx_earn_driver ON driver_earnings(driver_id, created_at DESC);

CREATE TABLE driver_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES delivery_jobs(id),
  driver_id uuid NOT NULL REFERENCES driver_profiles(user_id),
  kind text NOT NULL CHECK (kind IN ('vendor_not_ready','vendor_closed','customer_unavailable','incorrect_address','damaged_order','vehicle_problem','accident','other')),
  notes text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','resolved')),
  resolution text,
  ticket_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
