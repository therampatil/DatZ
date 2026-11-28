-- Built-in live listing feed used by the ingestion pipeline when
-- DATZ_LISTING_SOURCES is not configured.
INSERT INTO public.data_sources (name, base_url, category)
VALUES (
  'SquareYards Pune Sale Feed',
  'https://www.squareyards.com/sale/property-for-sale-in-pune',
  'LISTINGS'
)
ON CONFLICT (name) DO UPDATE
SET base_url = EXCLUDED.base_url,
    category = EXCLUDED.category;
