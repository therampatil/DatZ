# DatZ — Real-World Data Marketplace

Production-ready backend and web marketplace for **DatZ**, providing continuously updated, high-value Indian datasets with an initial focus on **Indian Real Estate Intelligence**.

## Architecture & Technology Stack

- **Frontend**: Vite 7, modular ES modules, semantic HTML, and responsive CSS
- **Authentication & browser data**: Supabase Auth with Google OAuth and the official Supabase client, protected by Row Level Security
- **Optional ingestion/export runtime**: Node.js 22 LTS, TypeScript 5, Express 5
- **Database & Identity**: [Supabase](https://supabase.com) (PostgreSQL 17, PostGIS, Row Level Security)
- **Object Storage**: Supabase Storage (`snapshots-vault` and `samples-public`) with authenticated expiring Signed URLs
- **Data Export Formats**:
  - **CSV**: Streamed via `csv-stringify`
  - **XLSX**: Formatted via `ExcelJS` with frozen header rows and styled columns
  - **Parquet**: Native Apache Parquet generated via `@dsnp/parquetjs`
- **Validation**: Strict schema parsing with `zod`
- **Web Scraping & Telemetry**: Live MahaRERA public-registry search plus SquareYards Pune sale listings (server-rendered HTML via `cheerio`), quality gating, batched Supabase upserts, and `scraper_runs` telemetry

---

## Getting Started

### 1. Prerequisites
- Node.js >= 20
- Supabase CLI (`brew install supabase/tap/supabase`)

### 2. Environment Configuration
The project is linked to your Supabase project (`DatZ`):
```env
PORT=4000
NODE_ENV=development
CORS_ORIGIN=*

SUPABASE_URL=https://szctsxukxcvukxprnwwc.supabase.co
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
SUPABASE_STORAGE_BUCKET=snapshots-vault
SUPABASE_STORAGE_PUBLIC_BUCKET=samples-public
SCRAPER_ENABLED=true
```

### 3. Database Migration & Seeding
Migrations and seed data are already deployed to the linked Supabase project. To re-run:
```bash
# Apply schema migrations via Supabase CLI
supabase db query --linked -f migrations/002_supabase_schema.sql

# Optional: seed the catalog metadata. This also inserts demo property rows;
# skip it when you want the database to contain live-scraped data only.
npm run seed
```

### 4. Live ingestion
```bash
# Scrape the real sources, validate/deduplicate, and upsert into Supabase
npm run scrape
```

- **MahaRERA** (`mahareraScraper.ts`) searches the official public registry for the terms in `MAHARERA_SEARCH_TERMS`, keeps only projects in `MAHARERA_DISTRICT` (default `Pune`, set `all` for state-wide), and stops at `MAHARERA_MAX_RESULTS`.
- **SquareYards** (`propertyListingsScraper.ts`) is the built-in listing feed when `DATZ_LISTING_SOURCES` is empty. It reads the public Pune sale page, whose server-rendered cards expose price, area, locality, seller type, and coordinates as data attributes. `DATZ_LISTING_MAX_PAGES` controls pagination (default 2, max 5) with a short delay between pages.
- Setting `DATZ_LISTING_SOURCES` to a JSON array replaces the built-in feed with your own selector-based sources. `DATZ_FIXTURE_MODE=true` swaps both scrapers for offline fixtures (tests only).
- Every run writes `scraper_runs` rows, upserts `properties` on `(dataset_id, external_id)`, then refreshes the CSV/XLSX/Parquet snapshots in Supabase Storage. Verify with `GET /api/v1/datasets/pune-real-estate-data/records` or the in-app full dataset view.

### 5. Ingestion operations
- **Schedule**: `SCRAPER_CRON` (default `0 */6 * * *`, every six hours). Invalid expressions fall back to the default with a warning. `SCRAPER_ENABLED=false` disables the scheduler entirely.
- **Jitter**: `SCRAPER_JITTER_SECONDS` (default 90) adds a random delay to scheduled runs so replicas and restarts do not scrape simultaneously.
- **Single-run lock**: scheduled and manual triggers share one in-process lock. A trigger that arrives while a run is active returns `409` / `skipped` instead of overlapping network and database work.
- **Freshness**: `SCRAPER_STALE_AFTER_HOURS` (default 12) controls when ingestion is reported as stale. `GET /health` includes a compact `ingestion` block; `GET /api/v1/scrapers/health` returns the full report (last success/failure, error, per-source status, record counts, in-flight flag) for an `admin` key.
- **Multiple replicas**: the lock is in-process. Run the scraper from a single instance or an external scheduler/worker; otherwise each replica will scrape once per cron tick.

### 6. Continuous integration
`.github/workflows/ci.yml` runs `npm ci`, `npm run build`, `npm test`, and `node --check` over every browser module on pushes and pull requests. The test suite is fully offline: parsers are exercised against captured HTML, and the pipeline integration test injects a fake Supabase client.

### 7. Running the Application
```bash
# Start the Vite frontend
npm run dev

# Build both the optional server runtime and production frontend
npm run build

# Build only the deployable static frontend (output: web-dist)
npm run build:web

# Start the optional ingestion/export server
npm run dev:server
npm start
```

The static frontend uses `SUPABASE_URL` and `SUPABASE_ANON_KEY` at build time.
`SUPABASE_SERVICE_ROLE_KEY` is server-only and is never included in the browser
bundle. Apply `migrations/006_browser_auth_and_access.sql` before enabling
authenticated full-record access and access requests.

### Browser features
- **Get access** records a pending, unpaid order (payment is simulated) and opens the full in-app dataset. The chosen export format carries through from the sample tab.
- **Visualize** opens a dedicated full-window analytics page with SVG charts computed from that database's own records: price histogram, locality donut, market-status stacked bar, price-vs-rate scatter, ranked builders, days-on-market histogram, construction-stage donut, and price-movement breakdown. No chart library is used. An insight strip and six KPI cards summarise the same computed values, category tabs filter the chart grid, and any chart can be expanded into a focused overlay (Esc or the backdrop closes it).
- **Full dataset table** behaves like a spreadsheet: click any column heading to sort (asc → desc → off), toggle the per-column filter row for substring filters, show/hide columns from the Columns menu (preference saved in this browser), select rows with checkboxes, copy selected or all filtered rows as tab-separated values, and reset the view in one click. Headers and the index column stay frozen while scrolling.
- **Expand** turns the table workbench into an immersive full-screen grid (from the header or the ⤢ control). The formula bar and status bar stay docked at the bottom; **Exit** or Esc collapses back to the normal layout.
- **Your Databases** is a dedicated full-window page (Profile → Your Databases, the profile tab's "Open full page" button, or the top nav link). It searches across dataset, order ID, email and format, filters by status, sorts by date/dataset/format/record count, paginates, refreshes from the ledger, and exports the list as CSV. Entries come from a per-browser access ledger populated by real checkout responses; orders stay pending because no payment gateway is connected, and no user id exists on orders, so the list is per-browser rather than per-account.

---

## API Reference

### Active dataset
The catalog contains exactly one dataset: **Pune Real Estate Data** (`pune-real-estate-data`, code `PR`). Snapshot exports (CSV/XLSX/Parquet) contain 23 atomic columns covering identity, location, pricing and price change, RERA/construction, market status, provenance, and geo (latitude/longitude). Area/configuration and raw scraped/listing timestamp columns are intentionally not exposed on the product surface; the underlying database columns are retained for data preservation.

### Catalog & Previews
- `GET /health` — Real database reachability check (returns 503 when a configured DB is unreachable) plus a compact `ingestion` summary (`status`, `stale`, `inFlight`, last success, record count).
- `GET /api/v1/datasets` — The single Pune dataset with a live `record_count`.
- `GET /api/v1/datasets/:slug` — Full metadata, attributes, use cases, and sources.
- `GET /api/v1/datasets/:slug/preview` — Real preview rows and statistics; `metrics.total_records` equals the number of exported rows.
- `GET /api/v1/datasets/:slug/records` — Web session required; all rows for the in-app full-dataset view (`data.records`, `data.total`).

### Auth, Sampling & Snapshot Downloads
- `POST /api/v1/auth/session` — Issues a short-lived, IP-bound web session token for checkout.
- `POST /api/v1/downloads/sample` — Public, rate-limited sample export (maximum 50 rows, full 23-column schema). This is a sample, not a paid snapshot.
- `POST /api/v1/downloads/export` — Web session required; testing-only unpaid full export (all rows, 23 columns, no storage upload and no order row). Disabled with `ALLOW_UNPAID_FULL_ACCESS=false` once a payment gateway is live. Request body: `{ "datasetSlug": "pune-real-estate-data", "format": "csv" | "xlsx" | "parquet" }`.
- `POST /api/v1/downloads/snapshot` — Server-to-server full export; requires an API key with `downloads:read` scope.
  - Request body:
    ```json
    {
      "datasetSlug": "pune-real-estate-data",
      "format": "parquet",
      "city": "Pune"
    }
    ```
- `GET /api/v1/downloads/file?token=...` — Serves a fulfilled order only; the token is HMAC-signed, order-bound, and expires. Bare `?slug=&format=` access is not supported.

### Orders & Custom Scrapers
- `POST /api/v1/orders/checkout` — Creates a **pending, unpaid** order. No file is generated and no payment is claimed until a gateway is integrated (requires web session token or `orders:write` API key).
- `POST /api/v1/orders/:id/confirm` — Sandbox-only fulfillment hook; disabled unless `ALLOW_SANDBOX_PAYMENTS=true` and called with an `admin:sandbox` key.
- `POST /api/v1/orders/custom-requests` — Submits custom scraping requests.
- `GET /api/v1/telemetry` — Counts derived from real `properties` and `scraper_runs` rows; shows `0`/`n/a` honestly.
- `POST /api/v1/scrapers/run` — Triggers an ingestion run; requires an `admin` API key. Returns `409` when another run is already in flight and `500` with the failed run's outcome when ingestion fails.
- `GET /api/v1/scrapers/health` — Full ingestion health report (last success/failure timestamps, last error, per-source status, dataset counts, in-flight flag); requires an `admin` API key.
