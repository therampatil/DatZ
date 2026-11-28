# Digger Scraper & Universal AI Engine (`Digger/`)

`Digger/` is the **autonomous ingestion & scraper control plane** running on port `4001`. It eliminates manual URL maintenance by automatically mapping dataset categories to multi-portal search feeds and extracting structured records using **Google Gemini AI** with a **deterministic heuristic fallback**.

---

## Universal Engine Pipeline (`Digger/src/engine/`)

Every task triggered from the Digger UI (`/api/tasks/:id/run` or `/api/scrape/instant`) runs `executeScrapingPipeline()` in `Digger/src/engine/pipeline.ts`:

```text
Category + Name
      |
      v
1. sourceResolver.ts   --> Maps 14 categories to SquareYards, 99acres, Housing, MagicBricks, MahaRERA URLs
      |
      v
2. fetcher.ts          --> HTTP GET with rotating desktop User-Agents & 15s-20s AbortController timeout
      |
      v
3. cleaner.ts          --> Cheerio strips script/style/nav/ads/popups & converts headings/lists to Markdown (<=50k chars)
      |
      v
4. aiExtractor.ts      --> Calls Gemini (`gemini-2.5-flash`) with strict JSON schema; validates via Zod (`schema.ts`)
      |                    (Automatically falls back to heuristicExtractor.ts if key missing or 0 rows returned)
      v
5. pipeline.ts         --> Computes SHA-256 content_hash, derives price_per_sqft, upserts `properties` on `(dataset_id, external_id)`,
                           updates `datasets.record_count`, writes `scraper_runs` & updates `scraper_configs`
```

### Supported 14 Categories (`sourceResolver.ts` & `heuristicExtractor.ts`)

`Digger/src/engine/sourceResolver.ts` automatically resolves multi-portal target URLs for all 14 categories (matching the 14 filters in `Core/index.html`):

1. **Residential Real Estate** (SquareYards, 99acres, Housing.com)
2. **Commercial Real Estate** (SquareYards Commercial, MagicBricks Commercial, MahaRERA Commercial)
3. **Plots & Land** (SquareYards Plots, 99acres Land & Plots)
4. **MahaRERA Projects** (MahaRERA Official Registry)
5. **Rental Properties & PG** (SquareYards Rentals, 99acres Rentals, Housing.com Rentals)
6. **Co-Working & Shared Spaces** (SquareYards Coworking, 99acres Managed Offices)
7. **Industrial & Warehousing** (SquareYards Industrial, 99acres MIDC/Warehouses, MagicBricks Industrial)
8. **Retail & High-Street Shops** (SquareYards Commercial Shops, 99acres Retail, MagicBricks Retail)
9. **Hospitality & Resorts** (SquareYards Resorts & Villas, 99acres Farmhouses & Resorts)
10. **Healthcare & Medical Spaces** (SquareYards Medical Suites, MagicBricks Healthcare)
11. **Educational Institutes & Campus** (SquareYards Institutional, 99acres Educational Hubs)
12. **Agricultural Land & Farmhouses** (SquareYards Farmhouses, 99acres Farmlands)
13. **Bank Auction & Distressed Assets** (SquareYards Auctions, 99acres Resale/Distress)
14. **Luxury & Penthouse Villas** (SquareYards Luxury Collection, 99acres Luxury)

### Extracted Schema (`Digger/src/engine/schema.ts`)
Validated with Zod (`ExtractedPropertySchema`):
- Identity & Developer: `externalId`, `projectName`, `builderName`, `reraId`, `listedBy`
- Geography: `city` (default `Pune`), `locality`, `location`, `pinCode`
- Area & Pricing: `carpetAreaSqft`, `builtUpAreaSqft`, `superBuiltUpAreaSqft`, `askingPrice`, `pricePerSqft`
- Unit & Building Metadata: `configuration`, `propertyType`, `propertySubType`, `floorNumber`, `totalFloors`, `facing`, `parkingCount`, `furnishingStatus`, `constructionStage`, `possessionDate`, `sourceUrl`, `description`

---

## Scheduled & Structured Scrapers (`Digger/src/scrapers/` & `Digger/src/jobs/`)

Alongside the Universal AI engine, `Digger/` retains dedicated deterministic scrapers and snapshot automation:
- **`mahareraScraper.ts`**: Searches the MahaRERA public registry using `MAHARERA_SEARCH_TERMS`, filtering by `MAHARERA_DISTRICT` (default `Pune`) and `MAHARERA_MAX_RESULTS`.
- **`propertyListingsScraper.ts`**: Parses server-rendered SquareYards Pune sale pages (or custom selector configs via `DATZ_LISTING_SOURCES`). Supports `DATZ_FIXTURE_MODE=true` for offline tests.
- **`pipelineOrchestrator.ts`**: Batch-upserts normalized listings (`BATCH_SIZE = 200`, `WRITE_CONCURRENCY = 3`), checks price-per-sqft consistency, updates telemetry, and triggers `SnapshotBuilder`.
- **`snapshotBuilder.ts`**: Regenerates CSV, XLSX, and Parquet exports and uploads them to Supabase Storage (`snapshots-vault`).
- **`scrapeRunner.ts` & `jobs/scheduler.ts`**: Runs `node-cron` on `SCRAPER_CRON` (default `0 */6 * * *`) with configurable random startup jitter (`SCRAPER_JITTER_SECONDS`) and an in-process single-run lock to prevent overlapping runs.
- **`cli.ts`**: Entry point for `npm run scrape`.

---

## Digger Admin Control Plane (`Digger/src/server.ts`, `Digger/public/`)

Port `4001` serves the dark-themed Digger admin UI (`public/index.html`, `public/admin.js`, `public/styles.css`) and REST endpoints:

- **`GET /api/tasks`**: Lists saved scraper configurations from `scraper_configs` (or in-memory fallback when offline).
- **`POST /api/tasks`**: Creates a category scrape task (`name`, `category`, `frequency`, `dataset_id`) without requiring a target URL (`target_url: "auto-multi-portal"`).
- **`DELETE /api/tasks/:id`**: Removes a configured scraper task.
- **`POST /api/tasks/:id/run`**: Triggers `executeScrapingPipeline()` for a saved task and returns extracted results + metrics.
- **`POST /api/scrape/instant`**: Runs an immediate one-off category scrape without saving a `scraper_configs` row.
- **`GET /api/datasets` & `PATCH /api/datasets/:id`**: Lists and edits dataset titles, categories, and update frequencies in `public.datasets`.
- **`GET /api/stats`**: Reports live Supabase connection state, Gemini AI readiness, total `properties`, and total `scraper_runs`.
