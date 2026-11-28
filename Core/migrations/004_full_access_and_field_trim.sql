-- DatZ — full access for testing & 23-field product surface
-- Version: 004_full_access_and_field_trim.sql
--
-- The product surface (previews, exports, docs) now exposes 23 fields. The
-- underlying property columns are intentionally retained for data preservation:
-- this is a presentation/export trim, not a destructive DB migration. No
-- columns are dropped and no stored data is removed.

-- Idempotent catalog count update; re-running this migration is safe.
UPDATE public.datasets
   SET fields_count = 23
 WHERE slug = 'pune-real-estate-data';
