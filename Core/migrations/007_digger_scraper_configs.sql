-- DatZ — Digger Scraper Configs & Universal Ingestion Tracking
-- Version: 007_digger_scraper_configs.sql

CREATE TABLE IF NOT EXISTS public.scraper_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  target_url TEXT NOT NULL,
  frequency TEXT NOT NULL DEFAULT 'manual', -- 'manual', 'hourly', 'daily', or cron expression
  dataset_id UUID REFERENCES public.datasets(id) ON DELETE SET NULL,
  last_run_at TIMESTAMPTZ,
  last_status TEXT NOT NULL DEFAULT 'idle', -- 'idle', 'running', 'completed', 'failed'
  last_error TEXT,
  extracted_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for scheduler lookups and status queries
CREATE INDEX IF NOT EXISTS idx_scraper_configs_status ON public.scraper_configs(last_status);
CREATE INDEX IF NOT EXISTS idx_scraper_configs_category ON public.scraper_configs(category);

-- Ensure RLS is active
ALTER TABLE public.scraper_configs ENABLE ROW LEVEL SECURITY;

-- Allow public read of configurations if authenticated or via service role
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'scraper_configs' AND policyname = 'service_role_all_scraper_configs'
  ) THEN
    CREATE POLICY service_role_all_scraper_configs ON public.scraper_configs
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'scraper_configs' AND policyname = 'authenticated_read_scraper_configs'
  ) THEN
    CREATE POLICY authenticated_read_scraper_configs ON public.scraper_configs
      FOR SELECT TO authenticated USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'scraper_configs' AND policyname = 'anon_read_scraper_configs'
  ) THEN
    CREATE POLICY anon_read_scraper_configs ON public.scraper_configs
      FOR SELECT TO anon USING (true);
  END IF;
END $$;
