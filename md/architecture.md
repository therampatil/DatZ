# Architecture & Data Flow

DatZ follows a **decoupled producer–store–consumer architecture**:
- **Producer (`Digger/`)**: Discovers source URLs by category, fetches web pages, strips boilerplate HTML, extracts structured records via Google Gemini AI (with deterministic regex/heuristic fallback), and upserts normalized records into Supabase.
- **Shared Persistence (`Supabase`)**: Hosts PostgreSQL tables (`datasets`, `properties`, `scraper_configs`, `scraper_runs`, `data_sources`, `download_orders`, `dataset_snapshots`, `api_keys`, `custom_scraper_requests`), Supabase Auth (Google OAuth), and Storage buckets (`snapshots-vault`, `samples-public`).
- **Consumer (`Core/`)**: Presents the public catalog, category/locality filters, instant full-dataset spreadsheet workbench, dependency-free SVG analytics dashboard, and multi-format export generator (`CSV`, `XLSX`, `Parquet`).

---

## High-Level System Diagram

```text
+-------------------------------------------------------------------------+
|                           DIGGER (Port 4001)                            |
|  Admin UI (public/index.html + admin.js) & Cron Scheduler               |
|                                                                         |
|  1. sourceResolver.ts -> Maps 14 categories to multi-portal URLs        |
|  2. fetcher.ts        -> Fetches HTML with rotating User-Agents         |
|  3. cleaner.ts        -> Cheerio strips nav/scripts -> clean Markdown   |
|  4. aiExtractor.ts    -> Gemini 2.5 Flash JSON / heuristicExtractor.ts  |
|  5. pipeline.ts       -> Upserts rows + updates dataset counts & runs   |
+------------------------------------+------------------------------------+
                                     | Service Role Key (Server-side writes)
                                     v
+-------------------------------------------------------------------------+
|                          SUPABASE PLATFORM                              |
|  PostgreSQL + RLS: datasets, properties, scraper_configs, scraper_runs  |
|  Storage Buckets : snapshots-vault (private), samples-public (public)   |
|  Identity        : Supabase Auth (Google OAuth + JWT)                   |
+------------------------------------+------------------------------------+
                                     |
          +--------------------------+--------------------------+
          | Anon Key (RLS-safe browser reads)                   | Service Role Key
          v                                                     v
+----------------------------------+   +----------------------------------+
|    CORE WEB APP (Vite / HTML)    |   |    CORE API SERVER (Port 4000)   |
|  - 14-category catalog & filters |   |  - /api/v1/datasets/*            |
|  - Full Dataset spreadsheet grid |   |  - /api/v1/downloads/* (CSV/XLSX |
|  - Fullscreen + Exit workbench   |   |    /Parquet generation & vault)  |
|  - SVG Visual Analytics          |   |  - /api/v1/auth/session          |
|  - Owned Databases ledger        |   |  - /api/v1/orders/*              |
+----------------------------------+   +----------------------------------+
```

---

## End-to-End Flow

1. **Task Creation or Instant Scrape (`Digger`)**:
   - An operator selects one of **14 real estate categories** in `Digger/public/index.html` (no manual URL needed) or schedules recurring jobs via `node-cron`.
   - `sourceResolver.ts` maps the category + query term into target portal feeds (SquareYards, 99acres, Housing.com, MagicBricks, MahaRERA).
2. **Extraction & Normalization (`Digger`)**:
   - `fetcher.ts` retrieves page HTML; `cleaner.ts` uses `cheerio` to strip scripts/navigation and normalize links into compact Markdown.
   - `aiExtractor.ts` sends cleaned text to `gemini-2.5-flash` and validates output against `ExtractedPropertySchema` (`zod`). If `GEMINI_API_KEY` is absent or returns zero rows, `heuristicExtractor.ts` parses prices, BHK configs, areas, and Pune localities deterministically.
   - `pipeline.ts` computes SHA-256 `content_hash`, upserts into `public.properties` on `(dataset_id, external_id)`, updates `datasets.record_count`, and logs telemetry to `scraper_runs` and `scraper_configs`.
3. **Marketplace Discovery & Exploration (`Core`)**:
   - `Core/src/web/api.js` queries Supabase directly (via `supabaseClient.js` using only the public anon key protected by RLS) or falls back cleanly when offline.
   - Users filter datasets by **14 matching categories**, city, Pune micro-markets, or search query in `catalog.js`.
   - Clicking **Get access** directly opens the full-dataset spreadsheet drawer (`fullDataset.js`) without a payment wall, supporting column sorting, per-column substring filtering, column visibility toggles, frozen columns, row selection, TSV copy, and fullscreen expansion with an explicit **Exit Fullscreen** header bar and `Esc` hotkey.
   - Clicking **Visualize** opens `visualization.js`, rendering interactive SVG charts computed client-side from live records (`analytics.js`).

---

## Security Boundaries

- **Two Separate Supabase Clients** (`src/db/supabase.ts` in both projects):
  - `supabase`: Initialized with `SUPABASE_SERVICE_ROLE_KEY` (bypasses RLS; server-only, never bundled into browser assets).
  - `supabasePublic`: Initialized with `SUPABASE_ANON_KEY` (subject to PostgreSQL RLS policies).
- **Stateless HMAC Tokens** (`Core/src/services/authService.ts`):
  - Web session tokens (`15m` TTL, IP-bound) and signed download tokens (`1h` TTL, order-bound) are signed using HMAC-SHA256.
- **API Keys & Scopes** (`Core/src/middleware/apiKey.ts`):
  - Server-to-server endpoints check SHA-256 hashed API keys and scoped permissions (`datasets:read`, `downloads:read`, `orders:write`, `admin`, `admin:sandbox`).
- **Rate Limiting & XSS Protection**:
  - Express endpoints enforce sliding-window rate limits (`rateLimit.ts`), while browser templates sanitize all dynamic fields via `escapeHtml()` (`Core/src/web/dom.js`).

---

## Containerized Local Stack

`Core/Dockerfile` uses a multi-stage `node:22-alpine` build (`npm run build` -> `node dist/server.js` on port `4000`).  
`Core/docker-compose.yml` defines a two-service local stack:
- `postgres` (`postgres:16-alpine` on port `5432`, persistent `datz_postgres` volume)
- `api` (Core backend container on port `4000` with `SCRAPER_ENABLED="true"`).
