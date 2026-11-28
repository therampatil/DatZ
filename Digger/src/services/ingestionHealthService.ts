import { supabase, isSupabaseConfigured } from "../db/supabase.js";
import { getLastScrapeOutcome, isScrapeRunning } from "../scrapers/scrapeRunner.js";

export type IngestionStatus = "healthy" | "degraded" | "stale" | "disabled" | "unconfigured";

export interface IngestionSourceHealth {
  name: string;
  lastStatus: string;
  lastRunAt: string | null;
}

export interface IngestionHealth {
  status: IngestionStatus;
  stale: boolean;
  staleAfterHours: number;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastError: string | null;
  hoursSinceLastSuccess: number | null;
  recordCount: number;
  fieldsCount: number;
  datasetUpdatedAt: string | null;
  sources: IngestionSourceHealth[];
  scheduler: {
    inFlight: boolean;
    lastTriggeredRun: {
      status: "completed" | "skipped" | "failed";
      trigger: "manual" | "scheduled";
      finishedAt: string;
    } | null;
  };
}

interface ScraperRunRow {
  status: string | null;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
  data_sources?: { name?: string | null } | null;
}

const DEFAULT_STALE_AFTER_HOURS = 12;
const RUN_HISTORY_LIMIT = 100;

export function staleAfterHoursFromEnv(): number {
  const configured = Number(process.env.SCRAPER_STALE_AFTER_HOURS);
  if (Number.isFinite(configured) && configured > 0) return configured;
  return DEFAULT_STALE_AFTER_HOURS;
}

function isScraperEnabled(): boolean {
  return process.env.SCRAPER_ENABLED !== "false";
}

function toMillis(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function emptyHealth(status: IngestionStatus): IngestionHealth {
  const lastOutcome = getLastScrapeOutcome();
  return {
    status,
    stale: false,
    staleAfterHours: staleAfterHoursFromEnv(),
    lastRunAt: null,
    lastSuccessAt: null,
    lastFailureAt: null,
    lastError: null,
    hoursSinceLastSuccess: null,
    recordCount: 0,
    fieldsCount: 0,
    datasetUpdatedAt: null,
    sources: [],
    scheduler: {
      inFlight: isScrapeRunning(),
      lastTriggeredRun: lastOutcome
        ? { status: lastOutcome.status, trigger: lastOutcome.trigger, finishedAt: lastOutcome.finishedAt }
        : null,
    },
  };
}

/**
 * Reads ingestion health from Supabase (the durable source of truth) and the
 * in-process runner (to surface an in-flight manual/scheduled scrape).
 *
 * `stale` means the newest successful scraper run is older than
 * SCRAPER_STALE_AFTER_HOURS (default 12h) or has never completed.
 */
export async function getIngestionHealth(): Promise<IngestionHealth> {
  if (!isScraperEnabled()) return emptyHealth("disabled");
  if (!isSupabaseConfigured() || !supabase) return emptyHealth("unconfigured");

  const client = supabase;
  const health = emptyHealth("healthy");
  const staleAfterHours = staleAfterHoursFromEnv();
  health.staleAfterHours = staleAfterHours;

  let runs: ScraperRunRow[] = [];
  try {
    const { data, error } = await client
      .from("scraper_runs")
      .select("status, started_at, completed_at, error_message, data_sources(name)")
      .order("started_at", { ascending: false })
      .limit(RUN_HISTORY_LIMIT);
    if (error) {
      console.warn("[health] scraper_runs query failed:", error.message);
      health.status = "degraded";
      health.lastError = `Could not read scraper runs: ${error.message}`;
    } else {
      runs = (data || []) as unknown as ScraperRunRow[];
    }
  } catch (error) {
    health.status = "degraded";
    health.lastError = error instanceof Error ? error.message : String(error);
  }

  const latest = runs[0] || null;
  health.lastRunAt = latest?.started_at || null;

  const latestSuccess = runs.find((run) => run.status === "completed");
  health.lastSuccessAt = latestSuccess?.completed_at || latestSuccess?.started_at || null;

  const latestFailure = runs.find((run) => run.status === "failed");
  health.lastFailureAt = latestFailure?.completed_at || latestFailure?.started_at || null;

  const successMs = toMillis(health.lastSuccessAt);
  const failureMs = toMillis(health.lastFailureAt);
  health.hoursSinceLastSuccess =
    successMs === null ? null : Math.max(0, round1((Date.now() - successMs) / 3_600_000));

  const failureIsNewer = failureMs !== null && (successMs === null || failureMs > successMs);
  if (failureIsNewer) {
    health.lastError = latestFailure?.error_message || "The most recent scrape run failed.";
  }

  health.stale = successMs === null || (Date.now() - successMs) / 3_600_000 > staleAfterHours;

  if (health.stale) {
    health.status = "stale";
  } else if (failureIsNewer || health.status === "degraded") {
    health.status = "degraded";
  }

  const latestBySource = new Map<string, ScraperRunRow>();
  for (const run of runs) {
    const name = run.data_sources?.name || "Unattributed source";
    if (!latestBySource.has(name)) latestBySource.set(name, run);
  }
  health.sources = [...latestBySource.entries()].map(([name, run]) => ({
    name,
    lastStatus: run.status || "unknown",
    lastRunAt: run.completed_at || run.started_at || null,
  }));

  try {
    const { data, error } = await client
      .from("datasets")
      .select("record_count, fields_count, updated_at")
      .order("updated_at", { ascending: false })
      .limit(1);
    if (error) {
      console.warn("[health] dataset query failed:", error.message);
      if (health.status === "healthy") health.status = "degraded";
      health.lastError = health.lastError || `Could not read dataset counts: ${error.message}`;
    } else if (data && data.length > 0) {
      const dataset = data[0] as { record_count?: number | null; fields_count?: number | null; updated_at?: string | null };
      health.recordCount = Number(dataset.record_count || 0);
      health.fieldsCount = Number(dataset.fields_count || 0);
      health.datasetUpdatedAt = dataset.updated_at || null;
    }
  } catch (error) {
    console.warn("[health] dataset query threw:", error);
    if (health.status === "healthy") health.status = "degraded";
  }

  return health;
}
