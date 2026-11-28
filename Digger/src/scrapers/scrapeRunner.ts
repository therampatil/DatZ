import { runPropertyScraper } from "./runPropertyScraper.js";

export type ScrapeTrigger = "manual" | "scheduled";

export interface ScrapePipelineResult {
  status: string;
  totalIngested: number;
  datasetsUpdated: number;
  snapshotsCreated: number;
  durationMs: number;
  sources?: Array<{
    source: string;
    status: "completed" | "failed";
    rows: number;
    added: number;
    updated: number;
    rejected: number;
    duplicates: number;
  }>;
}

export interface ScrapeRunOutcome {
  status: "completed" | "skipped" | "failed";
  trigger: ScrapeTrigger;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  result?: ScrapePipelineResult;
  error?: string;
}

const MAX_JITTER_MS = 10 * 60_000;

let inFlight = false;
let lastOutcome: ScrapeRunOutcome | null = null;

export function isScrapeRunning(): boolean {
  return inFlight;
}

export function getLastScrapeOutcome(): ScrapeRunOutcome | null {
  return lastOutcome;
}

export function jitterMsFromEnv(): number {
  const configured = Number(process.env.SCRAPER_JITTER_SECONDS);
  const seconds = Number.isFinite(configured) && configured >= 0 ? configured : 90;
  return Math.min(MAX_JITTER_MS, Math.floor(seconds * 1000));
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Shared entry point for every scrape trigger. Only one pipeline may run at a
 * time: a concurrent trigger returns `skipped` instead of piling network
 * requests and database writes onto an already-running ingestion.
 */
export async function runScrape(options: {
  trigger: ScrapeTrigger;
  jitterMs?: number;
}): Promise<ScrapeRunOutcome> {
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();

  if (inFlight) {
    const outcome: ScrapeRunOutcome = {
      status: "skipped",
      trigger: options.trigger,
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: 0,
      error: "A scrape is already running; this trigger was skipped.",
    };
    console.warn(`[scraper] ${options.trigger} trigger skipped: a run is already in flight.`);
    return outcome;
  }

  inFlight = true;
  try {
    const jitterMs = Math.max(0, options.jitterMs ?? 0);
    if (jitterMs > 0) {
      const delay = Math.floor(Math.random() * jitterMs);
      console.log(`[scraper] ${options.trigger} trigger waiting ${Math.round(delay / 1000)}s jitter before starting.`);
      await sleep(delay);
    }

    const result = (await runPropertyScraper()) as ScrapePipelineResult;
    const outcome: ScrapeRunOutcome = {
      status: "completed",
      trigger: options.trigger,
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedMs,
      result,
    };
    lastOutcome = outcome;
    console.log(`[scraper] ${options.trigger} run completed in ${outcome.durationMs}ms.`);
    return outcome;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const outcome: ScrapeRunOutcome = {
      status: "failed",
      trigger: options.trigger,
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedMs,
      error: message,
    };
    lastOutcome = outcome;
    console.error(`[scraper] ${options.trigger} run failed:`, message);
    return outcome;
  } finally {
    inFlight = false;
  }
}
