import { PlatformTelemetry } from "../types/dataset.js";
import { supabase, isSupabaseConfigured } from "../db/supabase.js";

const CITY_PAGE_SIZE = 1000;
const MAX_CITY_PAGES = 50;

function emptyTelemetry(): PlatformTelemetry {
  return {
    propertiesUpdatedToday: 0,
    lastScrapeSecondsAgo: 0,
    lastScrapeTimestamp: "n/a",
    pipelineUptime: "n/a",
    activeRegions: 0,
    totalDatasets: 0,
  };
}

function startOfTodayIso(): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today.toISOString();
}

/**
 * Compatibility no-op. Telemetry is derived from database rows, never from
 * in-process counters, so this method intentionally only logs the event.
 */
export class TelemetryService {
  static recordScrapeActivity(records = 0): void {
    console.log(`[telemetry] scraper activity observed (${records} records); metrics are read from Supabase.`);
  }

  static async getTelemetry(): Promise<PlatformTelemetry> {
    if (!isSupabaseConfigured() || !supabase) {
      return emptyTelemetry();
    }

    const client = supabase;
    const telemetry = emptyTelemetry();
    const now = Date.now();

    try {
      const { count, error } = await client
        .from("properties")
        .select("id", { count: "exact", head: true })
        .gte("listing_timestamp", startOfTodayIso());
      if (error) console.warn("Telemetry: propertiesUpdatedToday query failed:", error.message);
      else telemetry.propertiesUpdatedToday = count ?? 0;
    } catch (error) {
      console.warn("Telemetry: could not count today's property updates:", error);
    }

    try {
      const { data: runs, error } = await client
        .from("scraper_runs")
        .select("started_at")
        .order("started_at", { ascending: false })
        .limit(1);
      if (error) {
        console.warn("Telemetry: last scraper run query failed:", error.message);
      } else if (runs && runs.length > 0 && runs[0].started_at) {
        const last = new Date(runs[0].started_at);
        if (!Number.isNaN(last.getTime())) {
          telemetry.lastScrapeTimestamp = last.toISOString();
          telemetry.lastScrapeSecondsAgo = Math.max(0, Math.round((now - last.getTime()) / 1000));
        }
      }
    } catch (error) {
      console.warn("Telemetry: could not read the last scraper run:", error);
    }

    try {
      const thirtyDaysAgo = new Date(now - 30 * 86_400_000).toISOString();
      const { data: runs, error } = await client
        .from("scraper_runs")
        .select("status")
        .gte("started_at", thirtyDaysAgo)
        .limit(5000);
      if (error) {
        console.warn("Telemetry: pipeline uptime query failed:", error.message);
      } else {
        const finished = (runs || []).filter((run) => run.status === "completed" || run.status === "failed");
        if (finished.length > 0) {
          const successes = finished.filter((run) => run.status === "completed").length;
          telemetry.pipelineUptime = `${((successes / finished.length) * 100).toFixed(1)}%`;
        }
      }
    } catch (error) {
      console.warn("Telemetry: could not calculate pipeline uptime:", error);
    }

    try {
      const cities = new Set<string>();
      for (let page = 0; page < MAX_CITY_PAGES; page++) {
        const offset = page * CITY_PAGE_SIZE;
        const { data, error } = await client
          .from("properties")
          .select("city")
          .range(offset, offset + CITY_PAGE_SIZE - 1);
        if (error) throw error;
        for (const row of data || []) {
          const city = String(row.city || "").trim().toLowerCase();
          if (city) cities.add(city);
        }
        if (!data || data.length < CITY_PAGE_SIZE) break;
      }
      telemetry.activeRegions = cities.size;
    } catch (error) {
      console.warn("Telemetry: could not count active regions:", error);
    }

    try {
      const { count, error } = await client
        .from("datasets")
        .select("id", { count: "exact", head: true })
        .eq("is_published", true);
      if (error) console.warn("Telemetry: dataset count query failed:", error.message);
      else telemetry.totalDatasets = count ?? 0;
    } catch (error) {
      console.warn("Telemetry: could not count published datasets:", error);
    }

    return telemetry;
  }
}
