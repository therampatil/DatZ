-- Supabase Production Schema for DatZ Data Marketplace
-- Version: 002_supabase_schema.sql
--
-- Idempotent: safe to run on a fresh database or after 001_initial.sql.
-- Existing tables are brought up to the current schema with ADD COLUMN IF NOT EXISTS,
-- and policies are only created when absent so repeat runs do not fail.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Datasets Master Catalog
CREATE TABLE IF NOT EXISTS public.datasets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  code TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  geography TEXT NOT NULL,
  fields_count INTEGER NOT NULL,
  coverage TEXT NOT NULL,
  snapshot_price NUMERIC(12,2) NOT NULL,
  frequency TEXT NOT NULL,
  monthly_price NUMERIC(12,2) DEFAULT 0,
  added_tag TEXT DEFAULT '+312 new today',
  updated_tag TEXT DEFAULT '4 min ago',
  attributes JSONB NOT NULL DEFAULT '[]'::jsonb,
  use_cases JSONB NOT NULL DEFAULT '[]'::jsonb,
  sources JSONB NOT NULL DEFAULT '[]'::jsonb,
  record_count INTEGER NOT NULL DEFAULT 0,
  is_published BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Supabase Storage File Snapshots
CREATE TABLE IF NOT EXISTS public.dataset_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_id UUID NOT NULL REFERENCES public.datasets(id) ON DELETE CASCADE,
  format TEXT NOT NULL CHECK (format IN ('csv', 'xlsx', 'parquet', 'csv.gz')),
  storage_bucket TEXT NOT NULL DEFAULT 'snapshots-vault',
  storage_path TEXT NOT NULL,
  file_size_bytes BIGINT NOT NULL DEFAULT 0,
  record_count INTEGER NOT NULL DEFAULT 0,
  sha256_checksum TEXT,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Core Properties & Records
CREATE TABLE IF NOT EXISTS public.properties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_id UUID NOT NULL REFERENCES public.datasets(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  project_name TEXT,
  builder_name TEXT,
  city TEXT NOT NULL DEFAULT 'Pune',
  locality TEXT NOT NULL DEFAULT 'Baner',
  location TEXT,
  pin_code TEXT,
  carpet_area_sqft NUMERIC(10,2),
  asking_price NUMERIC(14,2),
  price_per_sqft NUMERIC(10,2),
  listing_source TEXT NOT NULL DEFAULT 'Direct Owner',
  rera_status TEXT DEFAULT 'Registered',
  rera_id TEXT,
  listing_timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  days_on_market INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  scraped_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  data_quality_score NUMERIC(5,2) NOT NULL DEFAULT 0,
  is_verified BOOLEAN NOT NULL DEFAULT false,
  is_public_preview BOOLEAN NOT NULL DEFAULT false,
  content_hash TEXT,
  UNIQUE(dataset_id, external_id),
  CONSTRAINT properties_carpet_area_positive CHECK (carpet_area_sqft IS NULL OR carpet_area_sqft > 0),
  CONSTRAINT properties_price_positive CHECK (asking_price IS NULL OR asking_price > 0),
  CONSTRAINT properties_price_per_sqft_positive CHECK (price_per_sqft IS NULL OR price_per_sqft > 0)
);

-- 4. Download Orders & Payment Transactions
CREATE TABLE IF NOT EXISTS public.download_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_id UUID NOT NULL REFERENCES public.datasets(id),
  customer_email TEXT NOT NULL,
  format TEXT NOT NULL CHECK (format IN ('csv', 'xlsx', 'parquet')),
  filters JSONB NOT NULL DEFAULT '{}'::jsonb,
  amount_paid NUMERIC(12,2) NOT NULL DEFAULT 0,
  payment_provider TEXT NOT NULL DEFAULT 'sandbox',
  payment_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'ready', 'failed')),
  payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid', 'authorized', 'paid', 'refunded')),
  access_token_hash TEXT,
  file_name TEXT,
  download_url TEXT,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- API keys are stored only as hashes. Scopes are checked by the API middleware.
CREATE TABLE IF NOT EXISTS public.api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  scopes TEXT[] NOT NULL DEFAULT ARRAY['datasets:read']::text[],
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Custom Scraper Requests Form
CREATE TABLE IF NOT EXISTS public.custom_scraper_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_email TEXT NOT NULL,
  target_locations TEXT NOT NULL,
  target_sources TEXT NOT NULL,
  required_attributes TEXT NOT NULL,
  budget_estimate TEXT,
  status TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'reviewed', 'in_progress', 'completed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. Data Sources & Ingestion Telemetry
CREATE TABLE IF NOT EXISTS public.data_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  base_url TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'Real Estate',
  enabled BOOLEAN NOT NULL DEFAULT true,
  last_run_at TIMESTAMPTZ,
  last_status TEXT NOT NULL DEFAULT 'pending',
  records_tracked INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.scraper_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id UUID REFERENCES public.data_sources(id),
  dataset_id UUID REFERENCES public.datasets(id),
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  records_added INTEGER NOT NULL DEFAULT 0,
  records_updated INTEGER NOT NULL DEFAULT 0,
  records_archived INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  error_message TEXT
);

-- ---------------------------------------------------------------------------
-- Upgrade path for databases created by 001_initial.sql (CREATE TABLE IF NOT
-- EXISTS alone does not add columns to tables that already exist).
-- ---------------------------------------------------------------------------
ALTER TABLE public.datasets
  ADD COLUMN IF NOT EXISTS code TEXT,
  ADD COLUMN IF NOT EXISTS monthly_price NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS added_tag TEXT DEFAULT '+312 new today',
  ADD COLUMN IF NOT EXISTS updated_tag TEXT DEFAULT '4 min ago',
  ADD COLUMN IF NOT EXISTS attributes JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS use_cases JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS sources JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS record_count INTEGER NOT NULL DEFAULT 0;

UPDATE public.datasets
  SET code = UPPER(SUBSTRING(slug FROM 1 FOR 2))
  WHERE code IS NULL;

ALTER TABLE public.datasets ALTER COLUMN code SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS datasets_code_key ON public.datasets(code);

-- Keep the cached count in sync with the actual rows on every migration run.
UPDATE public.datasets d
  SET record_count = (SELECT count(*) FROM public.properties p WHERE p.dataset_id = d.id);

ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS city TEXT NOT NULL DEFAULT 'Pune',
  ADD COLUMN IF NOT EXISTS locality TEXT NOT NULL DEFAULT 'Baner',
  ADD COLUMN IF NOT EXISTS rera_id TEXT,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS data_quality_score NUMERIC(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_verified BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_public_preview BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS content_hash TEXT;

ALTER TABLE public.properties ALTER COLUMN listing_timestamp SET DEFAULT NOW();
UPDATE public.properties SET listing_timestamp = NOW() WHERE listing_timestamp IS NULL;
ALTER TABLE public.properties ALTER COLUMN listing_timestamp SET NOT NULL;

ALTER TABLE public.download_orders
  ADD COLUMN IF NOT EXISTS customer_email TEXT NOT NULL DEFAULT 'anonymous@datz.internal',
  ADD COLUMN IF NOT EXISTS amount_paid NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payment_provider TEXT NOT NULL DEFAULT 'sandbox',
  ADD COLUMN IF NOT EXISTS payment_id TEXT,
  ADD COLUMN IF NOT EXISTS download_url TEXT,
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'unpaid',
  ADD COLUMN IF NOT EXISTS access_token_hash TEXT;

DO $$
DECLARE
  cname TEXT;
BEGIN
  FOREACH cname IN ARRAY ARRAY[
    'properties_carpet_area_positive',
    'properties_price_positive',
    'properties_price_per_sqft_positive',
    'download_orders_payment_status_check'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = cname AND conrelid IN (
        'public.properties'::regclass, 'public.download_orders'::regclass
      )
    ) THEN
      CASE cname
        WHEN 'properties_carpet_area_positive' THEN
          ALTER TABLE public.properties ADD CONSTRAINT properties_carpet_area_positive
            CHECK (carpet_area_sqft IS NULL OR carpet_area_sqft > 0);
        WHEN 'properties_price_positive' THEN
          ALTER TABLE public.properties ADD CONSTRAINT properties_price_positive
            CHECK (asking_price IS NULL OR asking_price > 0);
        WHEN 'properties_price_per_sqft_positive' THEN
          ALTER TABLE public.properties ADD CONSTRAINT properties_price_per_sqft_positive
            CHECK (price_per_sqft IS NULL OR price_per_sqft > 0);
        WHEN 'download_orders_payment_status_check' THEN
          ALTER TABLE public.download_orders ADD CONSTRAINT download_orders_payment_status_check
            CHECK (payment_status IN ('unpaid', 'authorized', 'paid', 'refunded'));
      END CASE;
    END IF;
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_properties_content_hash
  ON public.properties(dataset_id, content_hash) WHERE content_hash IS NOT NULL;

-- Keep the cached record_count accurate without relying on migration re-runs.
CREATE OR REPLACE FUNCTION public.sync_dataset_record_count()
RETURNS TRIGGER AS $$
DECLARE
  target_id UUID;
BEGIN
  target_id := COALESCE(NEW.dataset_id, OLD.dataset_id);
  UPDATE public.datasets d
    SET record_count = (SELECT count(*) FROM public.properties p WHERE p.dataset_id = target_id)
    WHERE d.id = target_id;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_dataset_record_count ON public.properties;
CREATE TRIGGER trg_sync_dataset_record_count
  AFTER INSERT OR DELETE OR UPDATE OF dataset_id ON public.properties
  FOR EACH ROW EXECUTE FUNCTION public.sync_dataset_record_count();

ALTER TABLE public.data_sources
  ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'Real Estate',
  ADD COLUMN IF NOT EXISTS records_tracked INTEGER NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'download_orders_status_check'
      AND conrelid = 'public.download_orders'::regclass
  ) THEN
    ALTER TABLE public.download_orders
      ADD CONSTRAINT download_orders_status_check
      CHECK (status IN ('pending', 'processing', 'ready', 'failed'));
  END IF;
END $$;

-- Indexes for rapid preview queries, geographical filtering, and time series
CREATE INDEX IF NOT EXISTS idx_properties_dataset_timestamp
  ON public.properties(dataset_id, listing_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_properties_location_pin
  ON public.properties(city, locality, pin_code);
CREATE INDEX IF NOT EXISTS idx_properties_pricing
  ON public.properties(asking_price, price_per_sqft);
CREATE INDEX IF NOT EXISTS idx_orders_customer_email
  ON public.download_orders(customer_email);

-- 7. Supabase Row Level Security (RLS) Setup
ALTER TABLE public.datasets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dataset_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.download_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.custom_scraper_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.data_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scraper_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;

-- Remove the historic open policies. Server-side jobs use the service-role key
-- (which bypasses RLS); anon/authenticated clients must never see raw orders
-- or unverified property rows.
DROP POLICY IF EXISTS "Public can view sample property preview records" ON public.properties;
DROP POLICY IF EXISTS "Public can create download orders" ON public.download_orders;
DROP POLICY IF EXISTS "Public can view their own download orders" ON public.download_orders;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'datasets' AND policyname = 'Public can view published datasets') THEN
    CREATE POLICY "Public can view published datasets" ON public.datasets
      FOR SELECT USING (is_published = true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'properties' AND policyname = 'Public can view verified preview records') THEN
    CREATE POLICY "Public can view verified preview records" ON public.properties
      FOR SELECT USING (
        is_public_preview = true
        AND is_verified = true
        AND data_quality_score >= 70
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'custom_scraper_requests' AND policyname = 'Public can submit custom scraper requests') THEN
    CREATE POLICY "Public can submit custom scraper requests" ON public.custom_scraper_requests
      FOR INSERT WITH CHECK (true);
  END IF;

  -- Explicit deny makes the intent visible in Supabase's policy list. Orders
  -- are readable only through the authenticated API using a scoped token.
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'download_orders' AND policyname = 'No public order access') THEN
    CREATE POLICY "No public order access" ON public.download_orders
      FOR SELECT USING (false);
  END IF;
END $$;
