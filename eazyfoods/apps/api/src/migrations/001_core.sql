-- EAZyfoods core: identity, RBAC, sessions, addresses, settings, audit, jobs, analytics, outbox
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION f_unaccent(text) RETURNS text AS $$
  SELECT public.unaccent('public.unaccent', $1)
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT;

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email citext NOT NULL UNIQUE,
  phone text,
  password_hash text NOT NULL,
  full_name text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','deleted')),
  status_reason text,
  locale text NOT NULL DEFAULT 'en',
  email_verified_at timestamptz,
  last_login_at timestamptz,
  failed_logins int NOT NULL DEFAULT 0,
  locked_until timestamptz,
  marketing_opt_in boolean NOT NULL DEFAULT false,
  referral_code text UNIQUE,
  referred_by uuid REFERENCES users(id),
  device_fingerprint text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE TRIGGER trg_users_updated BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX idx_users_phone ON users(phone) WHERE phone IS NOT NULL;
CREATE INDEX idx_users_created ON users(created_at);

CREATE TABLE roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  kind text NOT NULL CHECK (kind IN ('customer','vendor','chef','driver','staff')),
  is_system boolean NOT NULL DEFAULT true
);
CREATE TABLE permissions (
  key text PRIMARY KEY,
  area text NOT NULL,
  description text NOT NULL
);
CREATE TABLE role_permissions (
  role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_key text NOT NULL REFERENCES permissions(key) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_key)
);
CREATE TABLE user_roles (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  granted_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role_id)
);
CREATE INDEX idx_user_roles_role ON user_roles(role_id);

CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  ip text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE password_resets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE addresses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label text NOT NULL DEFAULT 'Home',
  recipient_name text,
  phone text,
  line1 text NOT NULL,
  line2 text,
  city text NOT NULL,
  region text NOT NULL,
  postal_code text NOT NULL,
  country text NOT NULL DEFAULT 'CA',
  lat double precision,
  lng double precision,
  instructions text,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX idx_addresses_user ON addresses(user_id) WHERE deleted_at IS NULL;

-- Admin configuration engine. Values are validated against a registry in code.
CREATE TABLE app_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_logs (
  id bigserial PRIMARY KEY,
  actor_user_id uuid,
  actor_role text,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  changes jsonb,
  ip text,
  user_agent text,
  request_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_entity ON audit_logs(entity_type, entity_id, created_at DESC);
CREATE INDEX idx_audit_actor ON audit_logs(actor_user_id, created_at DESC);
CREATE INDEX idx_audit_created ON audit_logs(created_at DESC);

-- Postgres-backed job queue (SKIP LOCKED). No extra infrastructure needed.
CREATE TABLE jobs (
  id bigserial PRIMARY KEY,
  name text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','done','failed')),
  run_at timestamptz NOT NULL DEFAULT now(),
  attempts int NOT NULL DEFAULT 0,
  max_attempts int NOT NULL DEFAULT 5,
  unique_key text,
  locked_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE UNIQUE INDEX uq_jobs_unique_active ON jobs(unique_key) WHERE unique_key IS NOT NULL AND status IN ('queued','running');
CREATE INDEX idx_jobs_due ON jobs(run_at) WHERE status = 'queued';
CREATE TABLE schedules (
  name text PRIMARY KEY,
  interval_seconds int NOT NULL,
  last_run_at timestamptz,
  enabled boolean NOT NULL DEFAULT true
);

-- First-party analytics events. Partition by month when volume requires it.
CREATE TABLE analytics_events (
  id bigserial PRIMARY KEY,
  name text NOT NULL,
  user_id uuid,
  anon_id text,
  entity_type text,
  entity_id text,
  campaign_id uuid,
  ad_id uuid,
  props jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_events_name_time ON analytics_events(name, created_at DESC);
CREATE INDEX idx_events_ad ON analytics_events(ad_id) WHERE ad_id IS NOT NULL;
CREATE INDEX idx_events_campaign ON analytics_events(campaign_id) WHERE campaign_id IS NOT NULL;
CREATE INDEX idx_events_user ON analytics_events(user_id, created_at DESC) WHERE user_id IS NOT NULL;

CREATE TABLE daily_metrics (
  day date NOT NULL,
  scope text NOT NULL,       -- platform | vendor | driver
  scope_id text NOT NULL DEFAULT '',
  metric text NOT NULL,
  value numeric(18,2) NOT NULL,
  PRIMARY KEY (day, scope, scope_id, metric)
);

-- Messages leave the system through provider adapters. The dev adapter keeps them here so flows are testable.
CREATE TABLE message_outbox (
  id bigserial PRIMARY KEY,
  channel text NOT NULL CHECK (channel IN ('email','sms','push')),
  recipient text NOT NULL,
  user_id uuid,
  subject text,
  body text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}',
  provider text NOT NULL,
  status text NOT NULL DEFAULT 'sent' CHECK (status IN ('sent','failed')),
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_outbox_recipient ON message_outbox(recipient, created_at DESC);

CREATE TABLE uploaded_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid REFERENCES users(id),
  purpose text NOT NULL,
  original_name text,
  mime text NOT NULL,
  bytes int NOT NULL,
  storage_key text NOT NULL UNIQUE,
  is_private boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
