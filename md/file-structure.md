# Complete Project File Structure

Below is the complete directory and file inventory of `/Users/therampatil/AndroidStudioProjects/DatZ` (excluding generated `node_modules/`, `dist/`, `web-dist/`, and `.git/`).

```text
DatZ/
├── md/                                    # Project documentation (this folder)
├── Core/                                  # Marketplace web app + REST export backend
│   ├── index.html                         # Main single-page marketplace shell & drawers
│   ├── styles.css                         # Full styling for catalog, full table, fullscreen, viz
│   ├── Logo.png                           # Brand logo asset
│   ├── package.json                       # Scripts (dev, dev:server, build, migrate, seed, test)
│   ├── tsconfig.json                      # TypeScript config (ES2022 / NodeNext -> dist/)
│   ├── vite.config.ts                     # Vite 7 build config (web-dist/ + Supabase env define)
│   ├── Dockerfile                         # Multi-stage Node 22 Alpine image for Core API
│   ├── docker-compose.yml                 # Local Postgres 16 + Core API orchestration
│   ├── README.md                          # Core setup, scraper & API summary
│   ├── .env / .env.example                # Environment variables & template
│   ├── .figma/                            # Figma Make site & deploy configuration
│   ├── supabase/                          # Supabase CLI config (config.toml) & link metadata
│   ├── migrations/                        # Sequential SQL migrations (001 through 007)
│   └── src/
│       ├── server.ts                      # Express 5 entrypoint, health check, route wiring
│       ├── types/
│       │   └── dataset.ts                 # Shared TypeScript interfaces (Dataset, Property, Telemetry)
│       ├── db/
│       │   ├── pool.ts                    # Direct pg connection pool & readiness helper
│       │   ├── supabase.ts                # Service-role & public-anon Supabase clients + Storage helpers
│       │   ├── migrate.ts                 # SQL migration runner for Postgres
│       │   └── seed.ts                    # Catalog & property demo seed script
│       ├── middleware/
│       │   ├── apiKey.ts                  # API key / web-session / download-token scope guard
│       │   └── rateLimit.ts               # In-memory sliding-window rate limiter per IP
│       ├── routes/
│       │   ├── auth.ts                    # Web session token & Google OAuth redirect endpoints
│       │   ├── datasets.ts                # Catalog list, details, preview, and full records routes
│       │   ├── downloads.ts               # Sample, unpaid export, signed file, & server snapshot routes
│       │   ├── orders.ts                  # Checkout order logging, sandbox confirm, custom requests
│       │   └── telemetry.ts               # Live pipeline & property count telemetry route
│       ├── services/
│       │   ├── authService.ts             # HMAC-SHA256 token signing/verification & key hashing
│       │   ├── datasetService.ts          # Dataset queries, preview metrics, 23-column row shaping
│       │   ├── downloadService.ts         # CSV / ExcelJS XLSX / Apache Parquet snapshot builders
│       │   ├── orderService.ts            # Order persistence, download URL issuance, custom requests
│       │   └── telemetryService.ts        # Telemetry aggregation from properties & scraper_runs
│       ├── web/
│       │   ├── main.js                    # Browser entrypoint wiring all UI modules & initial load
│       │   ├── state.js                   # Shared in-memory browser application state
│       │   ├── dom.js                     # Safe DOM helpers, HTML escaping, toasts, formatters
│       │   ├── supabaseClient.js          # Browser Supabase JS client (anon key + OAuth session)
│       │   ├── api.js                     # Browser Supabase adapter & session/export API calls
│       │   ├── auth.js                    # Google OAuth flow, login UI & profile state
│       │   ├── landing.js                 # IntersectionObserver scroll-reveal animations
│       │   ├── catalog.js                 # Dataset card rendering & multi-faceted filter logic
│       │   ├── details.js                 # Dataset metadata/schema/sources slide-over drawer
│       │   ├── preview.js                 # Sample data preview drawer & shared table renderer
│       │   ├── fullDataset.js             # Full spreadsheet explorer, fullscreen mode & exit bar
│       │   ├── analytics.js               # Pure client-side metric & distribution calculators
│       │   ├── visualization.js           # Zero-dependency SVG/CSS visual analytics page
│       │   ├── checkout.js                # Checkout & custom scraper request drawer bindings
│       │   ├── downloads.js               # Public sample download helper
│       │   ├── ownedDatabases.js          # "Your Databases" local browser ledger & CSV export
│       │   └── telemetry.js               # Top telemetry bar polling & rendering
│       └── __tests__/
│           ├── correctness.test.ts        # Export format, fallback & core behavior tests
│           └── security.test.ts           # Token expiry, tampering & auth security tests
│
└── Digger/                                # Autonomous multi-portal scraping & AI extraction service
    ├── package.json                       # Scripts (dev, start, scheduler, scrape, test)
    ├── tsconfig.json                      # TypeScript config (ES2022 / NodeNext -> dist/)
    ├── .env / .env.example                # Scraper, Gemini AI & Supabase env configuration
    ├── public/                            # Digger Control Plane static web UI
    │   ├── index.html                     # Scraping control & database registry UI (14 categories)
    │   ├── admin.js                       # Task creation, run triggers, stats & dataset editor logic
    │   ├── styles.css                     # Dark-theme control plane UI matching Core aesthetic
    │   └── Logo.png                       # Brand logo asset
    └── src/
        ├── server.ts                      # Digger Express server (port 4001) & admin REST API
        ├── types/
        │   └── dataset.ts                 # Shared TypeScript data models
        ├── db/
        │   ├── pool.ts                    # Direct pg connection pool
        │   ├── supabase.ts                # Supabase service-role & anon clients
        │   ├── migrate.ts                 # Migration helper
        │   └── seed.ts                    # Seed utility
        ├── engine/                        # Universal Category-Driven AI Scraper Engine
        │   ├── sourceResolver.ts          # Maps 14 categories to SquareYards/99acres/Housing/RERA URLs
        │   ├── fetcher.ts                 # HTTP HTML fetcher with User-Agent rotation & timeout
        │   ├── cleaner.ts                 # Cheerio HTML sanitizer -> structured Markdown text
        │   ├── schema.ts                  # Zod schemas for ExtractedProperty & ExtractionResult
        │   ├── aiExtractor.ts             # Google Gemini 2.5 Flash extractor + fallback trigger
        │   ├── heuristicExtractor.ts      # Regex/pattern extractor for all 14 Pune categories
        │   └── pipeline.ts                # End-to-end orchestration + Supabase properties/runs upsert
        ├── jobs/
        │   └── scheduler.ts               # node-cron scheduler (SCRAPER_CRON + jitter)
        ├── scrapers/                      # Dedicated / scheduled portal & registry scrapers
        │   ├── cli.ts                     # CLI runner (`npm run scrape`)
        │   ├── runPropertyScraper.ts      # Wrapper calling PipelineOrchestrator.runFullPipeline()
        │   ├── pipelineOrchestrator.ts    # Batched multi-source orchestrator & snapshot builder trigger
        │   ├── mahareraScraper.ts         # MahaRERA official registry HTML parser
        │   ├── propertyListingsScraper.ts # SquareYards / configurable selector-based scraper
        │   ├── scrapeRunner.ts            # Single-run lock, jitter handling & execution tracker
        │   └── snapshotBuilder.ts         # Generates & uploads CSV/XLSX/Parquet snapshots to Storage
        ├── services/
        │   ├── authService.ts             # Auth/token helpers
        │   ├── datasetService.ts          # Dataset queries & record loading
        │   ├── downloadService.ts         # Snapshot generation & upload helpers
        │   ├── ingestionHealthService.ts  # Staleness, last-run & per-source health reporting
        │   ├── orderService.ts            # Order service mirror
        │   └── telemetryService.ts        # Telemetry service mirror
        └── __tests__/
            ├── ingestion.test.ts          # Scraper ingestion & normalization tests
            ├── pipeline.test.ts           # Pipeline integration tests (offline fake Supabase)
            └── universalScraper.test.ts   # Universal engine (resolver, cleaner, heuristic) tests
```

---

## Notable File Groupings

- **Root `Core/` vs `Digger/` shared modules**: `Core/src/db/*`, `Core/src/services/*`, and `Core/src/types/dataset.ts` mirror closely with `Digger/src/db/*`, `Digger/src/services/*`, and `Digger/src/types/dataset.ts` so both packages can run independently as standalone Node/TypeScript services while targeting the exact same Supabase schema.
- **Migration History (`Core/migrations/`)**: All SQL schema evolution is stored sequentially in `Core/migrations/001_*.sql` through `007_*.sql`.
- **Single-Page Web UI (`Core/index.html` + `Core/src/web/`)**: Uses Vite (`Core/vite.config.ts`) to compile ES modules into `Core/web-dist/`, while `Core/src/server.ts` serves static assets and exposes `/api/v1/*`.
