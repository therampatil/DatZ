# DatZ — Project Documentation

Welcome to the **`md/`** documentation folder for **DatZ**, a full-stack **Real-World Data Marketplace & Autonomous Web Ingestion Platform** currently focused on **Pune & Indian Real Estate Intelligence** across 14 property categories.

DatZ is split into two cooperating sub-projects backed by a shared **Supabase** (PostgreSQL + Auth + Storage) layer:

| Sub-Project | Location | Default Port | Role |
| :--- | :--- | :--- | :--- |
| **Core** | [`Core/`](../Core/) | `4000` (API) / `5173` (Vite dev) | Customer-facing data marketplace UI, spreadsheet explorer, SVG analytics, and CSV/XLSX/Parquet export API. |
| **Digger** | [`Digger/`](../Digger/) | `4001` | Autonomous multi-portal scraping engine, Gemini AI + heuristic extractor, cron scheduler, and admin control plane UI. |

---

## Documentation Index

1. **[Architecture & Data Flow](./architecture.md)** — How `Digger`, `Supabase`, and `Core` fit together, end-to-end ingestion-to-marketplace flow, security/RLS model, and Docker setup.
2. **[Complete File Structure](./file-structure.md)** — Full annotated directory tree and file-by-file reference for every file in `Core/` and `Digger/`.
3. **[Core Marketplace Guide](./core-marketplace.md)** — Frontend workbench modules (`src/web/*.js`), backend Express API (`/api/v1/*`), spreadsheet explorer, and SVG visualization engine.
4. **[Digger Scraper & AI Engine](./digger-scraper.md)** — Category-based auto-link resolution (14 categories), HTML-to-Markdown cleaning, Gemini AI + heuristic extraction, cron scheduling, and Admin UI.
5. **[Database, Migrations & Environment](./database-and-env.md)** — PostgreSQL/Supabase schema (`001`–`007`), RLS policies, Storage buckets, and `.env` configuration.

---

## Quick Start

### 1. Start Digger (Scraping Engine & Admin UI — Port `4001`)
```bash
cd Digger
npm install
npm run dev       # Starts Digger admin UI & API on http://localhost:4001
```

Other Digger commands:
```bash
npm run scrape    # Run CLI pipeline once
npm run scheduler # Run cron scheduler process
npm test          # Run Digger tests
```

### 2. Start Core (Marketplace Backend & Frontend — Port `4000` / `5173`)
```bash
cd Core
npm install
npm run dev:server # Express API on http://localhost:4000
npm run dev        # Vite frontend dev server (in a second terminal)
```

Production build & tests for Core:
```bash
npm run build      # Compiles TypeScript server (dist/) and Vite web bundle (web-dist/)
npm start          # Serves compiled API and built frontend
npm test           # Runs Core correctness & security test suite
```
