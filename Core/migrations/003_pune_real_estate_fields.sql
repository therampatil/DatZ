-- DatZ — Pune Real Estate Data field expansion
-- Version: 003_pune_real_estate_fields.sql
--
-- Idempotent upgrade for the single active dataset. The 29 requested
-- bullet fields expand into 36 atomic exported columns; combined bullets
-- (e.g. built-up / super built-up, floor / total floors, RERA ID) are split
-- into separate machine-readable columns while keeping the requested data.

-- ---------------------------------------------------------------------------
-- 1. Single active catalog entry
-- ---------------------------------------------------------------------------
UPDATE public.datasets
   SET slug = 'pune-real-estate-data',
       code = 'PR',
       title = 'Pune Real Estate Data',
       description = 'Verified Pune residential property listings from public RERA filings and configured listing sources.',
       fields_count = 36,
       coverage = 'Pune, Maharashtra',
       is_published = true
 WHERE slug IN ('pune-real-estate-data', 'pune-mumbai-owner-listings')
    OR title = 'Pune Real Estate Data';

-- ---------------------------------------------------------------------------
-- 2. New property columns
-- ---------------------------------------------------------------------------
ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS built_up_area_sqft NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS super_built_up_area_sqft NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS configuration TEXT,
  ADD COLUMN IF NOT EXISTS property_type TEXT,
  ADD COLUMN IF NOT EXISTS property_sub_type TEXT,
  ADD COLUMN IF NOT EXISTS floor_number INTEGER,
  ADD COLUMN IF NOT EXISTS total_floors INTEGER,
  ADD COLUMN IF NOT EXISTS facing TEXT,
  ADD COLUMN IF NOT EXISTS parking_count INTEGER,
  ADD COLUMN IF NOT EXISTS furnishing_status TEXT,
  ADD COLUMN IF NOT EXISTS previous_asking_price NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS price_change_amount NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS price_change_percent NUMERIC(6,2),
  ADD COLUMN IF NOT EXISTS construction_stage TEXT,
  ADD COLUMN IF NOT EXISTS possession_date DATE,
  ADD COLUMN IF NOT EXISTS listed_by TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS source_url TEXT,
  ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- ---------------------------------------------------------------------------
-- 3. Constraints (guarded so repeat runs are safe)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  cname TEXT;
BEGIN
  FOREACH cname IN ARRAY ARRAY[
    'properties_built_up_positive',
    'properties_super_built_up_positive',
    'properties_previous_price_positive',
    'properties_latitude_range',
    'properties_longitude_range',
    'properties_listed_by_check'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = cname AND conrelid = 'public.properties'::regclass
    ) THEN
      CASE cname
        WHEN 'properties_built_up_positive' THEN
          ALTER TABLE public.properties ADD CONSTRAINT properties_built_up_positive
            CHECK (built_up_area_sqft IS NULL OR built_up_area_sqft > 0);
        WHEN 'properties_super_built_up_positive' THEN
          ALTER TABLE public.properties ADD CONSTRAINT properties_super_built_up_positive
            CHECK (super_built_up_area_sqft IS NULL OR super_built_up_area_sqft > 0);
        WHEN 'properties_previous_price_positive' THEN
          ALTER TABLE public.properties ADD CONSTRAINT properties_previous_price_positive
            CHECK (previous_asking_price IS NULL OR previous_asking_price > 0);
        WHEN 'properties_latitude_range' THEN
          ALTER TABLE public.properties ADD CONSTRAINT properties_latitude_range
            CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90);
        WHEN 'properties_longitude_range' THEN
          ALTER TABLE public.properties ADD CONSTRAINT properties_longitude_range
            CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180);
        WHEN 'properties_listed_by_check' THEN
          ALTER TABLE public.properties ADD CONSTRAINT properties_listed_by_check
            CHECK (listed_by IN ('owner', 'builder', 'broker', 'agent', 'unknown'));
      END CASE;
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 4. Freshness bookkeeping and indexes
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.touch_properties_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_touch_properties_updated_at ON public.properties;
CREATE TRIGGER trg_touch_properties_updated_at
  BEFORE UPDATE ON public.properties
  FOR EACH ROW EXECUTE FUNCTION public.touch_properties_updated_at();

CREATE INDEX IF NOT EXISTS idx_properties_pune_location
  ON public.properties(city, locality, pin_code);
CREATE INDEX IF NOT EXISTS idx_properties_price_change
  ON public.properties(price_change_percent DESC);
CREATE INDEX IF NOT EXISTS idx_properties_source_url
  ON public.properties(source_url) WHERE source_url IS NOT NULL;

-- Existing rows predate the new feed: mark them honestly as unknown/legacy.
UPDATE public.properties
   SET listed_by = 'unknown',
       updated_at = COALESCE(updated_at, NOW())
 WHERE listed_by IS NULL;
