# Core Marketplace (`Core/`)

`Core/` provides both the **customer-facing web marketplace** and the **Express 5 REST & export backend**.

---

## Frontend Architecture (`Core/index.html`, `Core/styles.css`, `Core/src/web/`)

The browser interface is built with vanilla ES modules bundled by Vite 7 (`npm run build:web` -> `Core/web-dist/`). No heavy UI or charting framework is used.

### Core Modules
- **`main.js`**: Application bootstrapper. Binds filters, details, preview, checkout, full dataset, visualization, owned databases, auth controls, telemetry polling, and landing scroll animations. Handles card actions (`Details` -> `openDetails`, `Get access` -> `openFullDataset` directly without a payment wall).
- **`state.js`**: Shared mutable client state (`datasets`, `activeDatasetIndex`, `previewRecords`, `fullRecords`, pagination, sort, filters, fullscreen flag `fullCardExpanded`, etc.).
- **`api.js`**: Supabase browser adapter using `supabaseClient.js` (public anon key only). Fetches datasets (`datasets` + property counts), normalizes 23-column property records, formats INR prices (`₹ L` / `₹ Cr`), and requests signed session/export downloads.
- **`supabaseClient.js`**: Initializes `@supabase/supabase-js` with `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, persisting OAuth sessions in the browser.
- **`dom.js`**: Safe DOM manipulation helpers (`byId`, `setText`, `setOpen`, `showToast`, `formatNumber`, `escapeHtml`, `createEmptyState`).

### Interactive Views & Drawers
1. **Catalog & Filtering (`catalog.js`)**:
   - Renders dataset cards (without any preview button; cards offer **Details** and **Get access**).
   - Filters live across **14 real estate categories** matching Digger, city pills (`Pune`, `Mumbai`, `Bengaluru`, `Hyderabad`, `NCR`), Pune micro-markets (`Baner`, `Balewadi`, `Wakad`, `Kharadi`, `Hinjewadi`, `Viman Nagar`), property types, update frequency, and instant keyword search (`Cmd/Ctrl + K`).
2. **Dataset Details Drawer (`details.js`)**:
   - Slide-over drawer presenting dataset schema attributes, use cases, sources, record count, and coverage.
3. **Full Dataset Spreadsheet Workbench (`fullDataset.js`)**:
   - Full-window spreadsheet explorer opened immediately by **Get access**.
   - Supports column sorting (`asc -> desc -> off`), collapsible per-column substring filter row, column visibility selector (saved to `localStorage`), frozen index/key columns, row density selector (`compact`, `standard`, `comfortable`), pagination (`10`, `25`, `50`, `100`, `all`), row selection, TSV clipboard copy (`Ctrl/Cmd + C`), and in-place CSV/XLSX/Parquet export.
   - **Fullscreen Expand & Exit**: Clicking the expand SVG icon button toggles `.card-expanded` (`position: fixed; inset: 0; z-index: 115`). Inside `#fullViewTableCard`, a dedicated `#fullViewTableHead` bar (`z-index: 120`) reveals the **Exit Fullscreen** (`#fullCardExitBtn`) button alongside `Esc` keyboard support so exit is always visible and accessible.
4. **Visual Analytics Dashboard (`analytics.js` + `visualization.js`)**:
   - Full-window dark-terminal dashboard building pure SVG/CSS charts directly from the active dataset's records: price histogram, locality donut, market-status bar, price-vs-rate scatter plot, builder rankings, days-on-market histogram, construction-stage donut, and price movement breakdown.
5. **Auth & User Ledger (`auth.js`, `ownedDatabases.js`)**:
   - Google OAuth sign-in via Supabase Auth (`auth.js`) and a per-browser **Your Databases** ledger (`ownedDatabases.js`) tracking accessed datasets with CSV export.
6. **Telemetry & Sample Downloads (`telemetry.js`, `downloads.js`, `preview.js`, `checkout.js`, `landing.js`)**:
   - Live top telemetry ticker, landing scroll reveals, public sample export helper, and optional checkout/custom-request drawer wiring.

---

## Backend API (`Core/src/server.ts` & `Core/src/routes/`)

The Express 5 server runs on port `4000` (configurable via `PORT`) with structured JSON request logging (`X-Request-Id`), opt-in CORS (`CORS_ORIGIN`), and database connectivity checks.

### Endpoint Summary

| Method & Path | Auth / Scope | Purpose |
| :--- | :--- | :--- |
| `GET /health` | Public | Probes Supabase or PostgreSQL and returns `200 healthy` / `503 unhealthy`. |
| `GET /api/v1/datasets` | Public | Lists published datasets with live record counts and query filters. |
| `GET /api/v1/datasets/:slug` | Public | Returns full metadata, attributes, sources, and use cases. |
| `GET /api/v1/datasets/:slug/preview` | Public | Returns preview rows and summary statistics. |
| `GET /api/v1/datasets/:slug/records` | `web:session` | Rate-limited full record fetch for in-app workbench. |
| `POST /api/v1/auth/session` | Public | Issues a short-lived (15m), IP-bound HMAC `web:session` token. |
| `POST /api/v1/downloads/sample` | Public | Streams a public sample capped at 50 rows (`csv`/`xlsx`/`parquet`). |
| `POST /api/v1/downloads/export` | `web:session` | Testing-only full export (`ALLOW_UNPAID_FULL_ACCESS !== "false"`). |
| `POST /api/v1/downloads/snapshot` | `downloads:read` | Server-to-server full export; uploads to Storage & returns file or Signed URL. |
| `GET /api/v1/downloads/file?token=...` | Download token / `downloads:read` | Streams a fulfilled order snapshot via HMAC order-bound token. |
| `POST /api/v1/orders/checkout` | `web:session` or `orders:write` | Logs a `download_orders` entry (`pending`/`unpaid`). |
| `POST /api/v1/orders/:id/confirm` | `admin:sandbox` | Sandbox fulfillment (`ALLOW_SANDBOX_PAYMENTS=true` only). |
| `POST /api/v1/orders/custom-requests` | Public / Rate-limited | Stores custom scraping requests in `custom_scraper_requests`. |
| `GET /api/v1/telemetry` | Public | Aggregates real counts from `properties` and `scraper_runs`. |

### Multi-Format Export Engine (`Core/src/services/downloadService.ts`)
- **CSV**: Generated via `csv-stringify/sync`.
- **XLSX**: Styled workbook with frozen header rows built via `exceljs`.
- **Parquet**: Columnar Apache Parquet buffer built via `@dsnp/parquetjs`.
