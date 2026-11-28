import cron from "node-cron";
import { jitterMsFromEnv, runScrape } from "../scrapers/scrapeRunner.js";

export const DEFAULT_SCRAPER_CRON = "0 */6 * * *";

let schedulerStarted = false;

export function getScraperCron(): string {
  const configured = (process.env.SCRAPER_CRON || "").trim();
  if (!configured) return DEFAULT_SCRAPER_CRON;
  if (!cron.validate(configured)) {
    console.warn(
      `[scraper] SCRAPER_CRON="${configured}" is not a valid cron expression; using "${DEFAULT_SCRAPER_CRON}".`
    );
    return DEFAULT_SCRAPER_CRON;
  }
  return configured;
}

export function startScraperScheduler(): void {
  if (schedulerStarted) return;
  schedulerStarted = true;

  const expression = getScraperCron();
  const jitterMs = jitterMsFromEnv();

  cron.schedule(expression, async () => {
    await runScrape({ trigger: "scheduled", jitterMs });
  });

  console.log(
    `[scraper] scheduled with cron "${expression}" (${new Date().toISOString()}); jitter up to ${Math.round(
      jitterMs / 1000
    )}s, single-run lock enabled.`
  );
}
