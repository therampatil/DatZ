# Database Schema, Migrations & Environment

Both `Core/` and `Digger/` share a single **PostgreSQL / Supabase** database whose schema is versioned in `Core/migrations/`.

---

## SQL Migrations (`Core/migrations/`)

| Migration File | Summary of Changes |
| :--- | :--- |
| `001_initial.sql` | Initial `data_sources` table and `pgcrypto` extension. |
| `002_supabase_schema.sql` | Idempotent production schema: `datasets`, `dataset_snapshots`, `properties`, `download_orders`, `api_keys`, `custom_scraper_requests`, `data_sources`, `scraper_runs`, indexes, and base RLS policies. |
| `003_pune_real_estate_fields.sql` | Expands `properties` and catalog metadata for Pune real estate intelligence (atomic built-up/super-built-up, floor/total floors, RERA, geo coordinates, price change deltas). |
| `004_full_access_and_field_trim.sql` | Sets catalog `fields_count = 23` for the standardized 23-column product surface while preserving deeper DB columns. |
| `005_squareyards_source.sql` | Registers the built-in `SquareYards Pune Sale Feed` in `public.data_sources`. |
| `006_browser_auth_and_access.sql` | Adds `user_id` (`auth.users`) to `download_orders` and updates public preview RLS policies on `properties`. |
| `007_digger_scraper_configs.sql` | Adds `public.scraper_configs` for Digger's autonomous scraper tasks (`name`, `category`, `target_url`, `frequency`, `dataset_id`, `last_status`, `extracted_count`, RLS policies). |

---

## Key Tables Overview

- **`public.datasets`**: Marketplace catalog entries (`id`, `slug`, `code`, `title`, `description`, `category`, `geography`, `fields_count`, `coverage`, `frequency`, `record_count`, `attributes`, `use_cases`, `sources`, `is_published`).
- **`public.properties`**: Normalized real estate listings keyed uniquely on `(dataset_id, external_id)` with `CHECK` constraints requiring strictly positive `carpet_area_sqft`, `asking_price`, and `price_per_sqft` when non-null.
- **`public.scraper_configs`**: Saved category scraping tasks managed by Digger (`last_status`: `idle` | `running` | `completed` | `failed`).
- **`public.scraper_runs`**: Execution log tracking `started_at`, `completed_at`, `status`, record counts, and `error_message`.
- **`public.data_sources`**: External source registry and last run status.
- **`public.dataset_snapshots`**: Metadata linking generated files (`csv`, `xlsx`, `parquet`) to Supabase Storage paths and SHA-256 checksums.
- **`public.download_orders`**: Order ledger with `format`, `status`, `payment_status`, `access_token_hash`, `download_url`, and optional `user_id`.
- **`public.api_keys`**: Hashed API keys (`key_hash`) and `scopes` array.
- **`public.custom_scraper_requests`**: Submitted custom scraping inquiries.

---

## Supabase Storage & Auth

- **Storage Buckets**:
  - `snapshots-vault` (`SUPABASE_STORAGE_BUCKET`): Private bucket for full generated snapshots served via time-limited Signed URLs.
  - `samples-public` (`SUPABASE_STORAGE_PUBLIC_BUCKET`): Public bucket for sample files.
- **Row Level Security (RLS)**:
  - `service_role` gets unrestricted access on server processes (`Core` backend & `Digger`).
  - `anon` and `authenticated` browser clients read published `datasets`, verified/preview `properties`, and `scraper_configs` safely under RLS.

---

## Environment Variables (`.env.example`)

### Shared / Core & Digger Settings
| Variable | Default / Example | Used By | Purpose |
| :--- | :--- | :--- | :--- |
| `PORT` | `4000` (Core) / `4001` (Digger) | Both | HTTP listen port |
| `SUPABASE_URL` | `https://<ref>.supabase.co` | Both | Supabase project URL (also injected into Vite as `VITE_SUPABASE_URL`) |
| `SUPABASE_ANON_KEY` | `<anon-jwt>` | Both | Public RLS-bound key (also injected into Vite as `VITE_SUPABASE_ANON_KEY`) |
| `SUPABASE_SERVICE_ROLE_KEY` | `<service-role-jwt>` | Server only | Server-side DB writes, Storage uploads, and scraper upserts |
| `DATABASE_URL` | `postgres://...` | Optional | Direct PostgreSQL pool fallback when not using Supabase REST |
| `SUPABASE_STORAGE_BUCKET` | `snapshots-vault` | Both | Private snapshot bucket |
| `SUPABASE_STORAGE_PUBLIC_BUCKET` | `samples-public` | Both | Public sample bucket |

### Core Auth, Access & Payment Flags
- `CORS_ORIGIN` — Comma-separated allowed origins.
- `DOWNLOAD_TOKEN_SECRET` — Secret for HMAC-SHA256 web session and download tokens.
- `DATZ_API_KEYS` — JSON array of scoped API keys.
- `ALLOW_UNPAID_FULL_ACCESS` — `true` by default for testing full dataset access/exports.
- `ALLOW_SANDBOX_PAYMENTS` — `false` by default; enables sandbox order confirmation endpoint.
- `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` / `STRIPE_SECRET_KEY` — Gateway placeholders for production billing.

### Digger AI & Scraper Flags
- `GEMINI_API_KEY` (or `GOOGLE_API_KEY`) — Enables `gemini-2.5-flash` extraction in `Digger/src/engine/aiExtractor.ts` (if omitted, uses `heuristicExtractor.ts`).
- `SCRAPER_ENABLED` — Enables scheduled scraping (`true`/`false`).
- `SCRAPER_CRON` — 5-field cron schedule (default `0 */6 * * *`).
- `SCRAPER_JITTER_SECONDS` — Max random startup jitter in seconds (`90`).
- `SCRAPER_STALE_AFTER_HOURS` — Ingestion freshness threshold (`12`).
- `MAHARERA_SEARCH_TERMS`, `MAHARERA_MAX_RESULTS`, `MAHARERA_DISTRICT` — MahaRERA query filters.
- `DATZ_LISTING_MAX_PAGES`, `DATZ_LISTING_SOURCES`, `DATZ_FIXTURE_MODE` — Listing scraper pagination, custom CSS selectors, and offline test fixture switch.
