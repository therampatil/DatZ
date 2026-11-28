CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS data_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  base_url TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  last_run_at TIMESTAMPTZ,
  last_status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS datasets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  geography TEXT NOT NULL,
  fields_count INTEGER NOT NULL,
  coverage TEXT NOT NULL,
  snapshot_price NUMERIC(12,2) NOT NULL,
  frequency TEXT NOT NULL,
  is_published BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS properties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_id UUID NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  project_name TEXT,
  builder_name TEXT,
  location TEXT,
  pin_code TEXT,
  carpet_area_sqft NUMERIC,
  asking_price NUMERIC,
  price_per_sqft NUMERIC,
  listing_source TEXT,
  rera_status TEXT,
  listing_timestamp TIMESTAMPTZ,
  days_on_market INTEGER,
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  scraped_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(dataset_id, external_id)
);

CREATE INDEX IF NOT EXISTS properties_dataset_listing_idx
  ON properties(dataset_id, listing_timestamp DESC);
CREATE INDEX IF NOT EXISTS properties_location_idx
  ON properties(location, pin_code);

CREATE TABLE IF NOT EXISTS scraper_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id UUID REFERENCES data_sources(id),
  dataset_id UUID REFERENCES datasets(id),
  status TEXT NOT NULL,
  records_added INTEGER NOT NULL DEFAULT 0,
  records_updated INTEGER NOT NULL DEFAULT 0,
  records_archived INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  error_message TEXT
);

CREATE TABLE IF NOT EXISTS download_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_id UUID NOT NULL REFERENCES datasets(id),
  format TEXT NOT NULL CHECK (format IN ('csv','xlsx','parquet')),
  filters JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending',
  file_name TEXT,
  file_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
