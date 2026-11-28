-- Browser-authenticated and preview access for the static Supabase frontend.
-- The anon key remains subject to RLS; the service-role key is never bundled.

ALTER TABLE public.download_orders
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_download_orders_user_created
  ON public.download_orders(user_id, created_at DESC);

-- Allow public preview for records that are marked as public preview OR meet the quality threshold
DROP POLICY IF EXISTS "Public can view verified preview records" ON public.properties;
CREATE POLICY "Public can view verified preview records" ON public.properties
  FOR SELECT TO anon, authenticated
  USING (
    is_public_preview = true
    OR is_verified = true
    OR data_quality_score >= 70
  );

-- Authenticated users can view all active properties
DROP POLICY IF EXISTS "Authenticated users can view verified records" ON public.properties;
CREATE POLICY "Authenticated users can view verified records" ON public.properties
  FOR SELECT TO authenticated
  USING (
    status = 'active'
    OR is_verified = true
    OR data_quality_score >= 50
  );

-- Allow authenticated users to manage their own orders
DROP POLICY IF EXISTS "Authenticated users can create their own orders" ON public.download_orders;
CREATE POLICY "Authenticated users can create their own orders" ON public.download_orders
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Authenticated users can view their own orders" ON public.download_orders;
CREATE POLICY "Authenticated users can view their own orders" ON public.download_orders
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Backfill flags for existing high quality / official rows
UPDATE public.properties
  SET is_verified = true
  WHERE listing_source ILIKE '%maharera%'
     OR listing_source ILIKE '%rera%'
     OR data_quality_score >= 70;

UPDATE public.properties
  SET is_public_preview = true
  WHERE data_quality_score >= 70
     OR is_verified = true;

-- Update canonical record count on dataset
UPDATE public.datasets d
  SET record_count = (SELECT count(*) FROM public.properties p WHERE p.dataset_id = d.id);
