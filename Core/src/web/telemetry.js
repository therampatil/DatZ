// Platform telemetry is rendered only from GET /api/v1/telemetry.
// Missing values are shown as "—" — never fabricated.

import { fetchTelemetry } from "./api.js";
import { setText, formatNumber } from "./dom.js";

export function renderTelemetry(data) {
  const rows = formatNumber(data?.propertiesUpdatedToday, "—");
  const seconds = Number(data?.lastScrapeSecondsAgo);
  const scrape = Number.isFinite(seconds) ? `${Math.max(0, Math.round(seconds))} sec` : "—";
  const uptime = data?.pipelineUptime === null || data?.pipelineUptime === undefined || data?.pipelineUptime === ""
    ? "—"
    : String(data.pipelineUptime);
  const regions = formatNumber(data?.activeRegions, "—");

  setText("telemetryRows", rows, "—");
  setText("telemetryLastScrape", scrape, "—");
  setText("telemetryUptime", uptime, "—");
  setText("welcomeRowsUpdated", rows, "—");
  setText("welcomeUptime", uptime, "—");
  setText("welcomeActiveRegions", regions, "—");
  setText("heroRegions", regions, "—");
  setText("heroLastScrape", scrape, "—");
}

export async function updateTelemetry() {
  try {
    renderTelemetry(await fetchTelemetry());
  } catch {
    renderTelemetry(null);
  }
}

export function startTelemetry() {
  updateTelemetry();
  window.setInterval(updateTelemetry, 10000);
}
