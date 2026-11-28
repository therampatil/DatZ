// Dedicated, full-window visualization page.
// Charts are built with plain SVG/CSS from the dataset's own records — no
// chart library, no fabricated values, every label written via textContent.

import { state } from "./state.js";
import { byId, setText, formatNumber, setOpen, showToast } from "./dom.js";
import { fetchDatasetRecords, getSessionToken } from "./api.js";
import { openFullDataset, collapseFullCard } from "./fullDataset.js";
import {
  computeAnalytics,
  formatPriceINR,
  formatRateINR,
} from "./analytics.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const PALETTE = ["#38bdf8", "#64748b", "#94a3b8", "#0284c7", "#475569", "#cbd5e1"];

function svgEl(tag, attrs = {}, text) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined) continue;
    node.setAttribute(key, String(value));
  }
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function emptyMessage(message) {
  const note = document.createElement("p");
  note.className = "chart-empty";
  note.textContent = message;
  return note;
}

function shortLabel(value) {
  const text = String(value ?? "—");
  return text.length > 12 ? `${text.slice(0, 11)}…` : text;
}

function renderHistogram(container, { buckets, valueFormatter, color = "#38bdf8" }) {
  if (!container) return;
  container.replaceChildren();
  if (!buckets.length) {
    container.append(emptyMessage("No numeric values available for this chart."));
    return;
  }

  const width = 640;
  const height = 230;
  const pad = { left: 46, right: 12, top: 14, bottom: 48 };
  const innerWidth = width - pad.left - pad.right;
  const innerHeight = height - pad.top - pad.bottom;
  const maxCount = Math.max(1, ...buckets.map((bucket) => bucket.count));
  const chart = svgEl("svg", {
    viewBox: `0 0 ${width} ${height}`,
    class: "chart-svg",
    role: "img",
    "aria-label": "Distribution histogram",
  });

  const defs = svgEl("defs");
  const gradient = svgEl("linearGradient", {
    id: `histGradient-${Math.random().toString(36).slice(2, 8)}`,
    x1: "0", y1: "1", x2: "0", y2: "0",
  });
  gradient.append(
    svgEl("stop", { offset: "0%", "stop-color": color, "stop-opacity": "0.15" }),
    svgEl("stop", { offset: "100%", "stop-color": color, "stop-opacity": "0.85" })
  );
  defs.append(gradient);
  chart.append(defs);
  const fill = `url(#${gradient.getAttribute("id")})`;

  for (let tick = 0; tick <= 4; tick += 1) {
    const y = pad.top + innerHeight - (innerHeight * tick) / 4;
    chart.append(svgEl("line", {
      x1: pad.left, y1: y, x2: width - pad.right, y2: y,
      stroke: "rgba(255, 255, 255, 0.05)", "stroke-width": 1,
    }));
    chart.append(svgEl("text", {
      x: pad.left - 8, y: y + 3, "text-anchor": "end", class: "chart-axis-text",
    }, String(Math.round((maxCount * tick) / 4))));
  }

  const slot = innerWidth / buckets.length;
  const barWidth = Math.max(6, slot * 0.6);
  buckets.forEach((bucket, index) => {
    const barHeight = (bucket.count / maxCount) * innerHeight;
    const x = pad.left + index * slot + (slot - barWidth) / 2;
    const y = pad.top + innerHeight - barHeight;
    const rect = svgEl("rect", {
      x, y, width: barWidth, height: Math.max(barHeight, 1), rx: 3, fill,
    });
    rect.append(svgEl("title", {},
      `${valueFormatter(bucket.start)} – ${valueFormatter(bucket.end)}: ${bucket.count} records`));
    chart.append(rect);
    if (bucket.count) {
      chart.append(svgEl("text", {
        x: x + barWidth / 2, y: y - 5, "text-anchor": "middle", class: "chart-value-text",
      }, String(bucket.count)));
    }
    if (buckets.length <= 7 || index % 2 === 0) {
      chart.append(svgEl("text", {
        x: x + barWidth / 2, y: height - 16, "text-anchor": "middle", class: "chart-axis-text",
      }, shortLabel(valueFormatter(bucket.start))));
    }
  });

  chart.append(svgEl("line", {
    x1: pad.left, y1: pad.top + innerHeight, x2: width - pad.right, y2: pad.top + innerHeight,
    stroke: "rgba(255, 255, 255, 0.12)", "stroke-width": 1,
  }));
  container.append(chart);
}

function renderLegend(slices) {
  const legend = document.createElement("div");
  legend.className = "chart-legend";
  slices.forEach((slice) => {
    const row = document.createElement("div");
    const dot = document.createElement("i");
    dot.style.backgroundColor = slice.color;
    const label = document.createElement("span");
    label.textContent = slice.label;
    const value = document.createElement("b");
    value.textContent = `${slice.percent}% · ${formatNumber(slice.count)}`;
    row.append(dot, label, value);
    legend.append(row);
  });
  return legend;
}

function renderDonut(container, { slices, centerLabel, centerValue }) {
  if (!container) return;
  container.replaceChildren();
  if (!slices.length) {
    container.append(emptyMessage("No grouped values available for this chart."));
    return;
  }

  const colored = slices.map((slice, index) => ({ ...slice, color: PALETTE[index % PALETTE.length] }));
  const size = 190;
  const strokeWidth = 16;
  const radius = (size - strokeWidth) / 2 - 4;
  const center = size / 2;
  const circumference = 2 * Math.PI * radius;
  const donut = svgEl("svg", {
    viewBox: `0 0 ${size} ${size}`,
    class: "chart-donut",
    role: "img",
    "aria-label": "Proportion donut chart",
  });
  donut.append(svgEl("circle", {
    cx: center, cy: center, r: radius, fill: "none", stroke: "rgba(255, 255, 255, 0.05)", "stroke-width": strokeWidth,
  }));

  let offset = 0;
  colored.forEach((slice) => {
    const length = (slice.percent / 100) * circumference;
    const arc = svgEl("circle", {
      cx: center, cy: center, r: radius, fill: "none", stroke: slice.color,
      "stroke-width": strokeWidth,
      "stroke-dasharray": `${length} ${circumference - length}`,
      "stroke-dashoffset": -offset,
      transform: `rotate(-90 ${center} ${center})`,
    });
    arc.append(svgEl("title", {}, `${slice.label}: ${slice.count} records (${slice.percent}%)`));
    donut.append(arc);
    offset += length;
  });

  donut.append(svgEl("text", { x: center, y: center - 2, "text-anchor": "middle", class: "donut-value" }, centerValue));
  donut.append(svgEl("text", { x: center, y: center + 18, "text-anchor": "middle", class: "donut-label" }, centerLabel));
  container.append(donut, renderLegend(colored));
}

function renderHorizontalBars(container, { rows, valueFormatter = (v) => formatNumber(v) }) {
  if (!container) return;
  container.replaceChildren();
  if (!rows.length) {
    container.append(emptyMessage("No categories available for this chart."));
    return;
  }

  const max = Math.max(1, ...rows.map((row) => row.count));
  const list = document.createElement("div");
  list.className = "hbar-list";
  rows.forEach((row, index) => {
    const item = document.createElement("div");
    item.className = "hbar-item";
    const label = document.createElement("span");
    label.textContent = row.label;
    label.title = row.label;
    const track = document.createElement("div");
    track.className = "hbar-track";
    const fill = document.createElement("i");
    fill.style.width = `${(row.count / max) * 100}%`;
    fill.style.backgroundColor = PALETTE[index % PALETTE.length];
    track.append(fill);
    const value = document.createElement("b");
    value.textContent = valueFormatter(row.count);
    item.append(label, track, value);
    list.append(item);
  });
  container.append(list);
}

function renderStackedBar(container, { slices }) {
  if (!container) return;
  container.replaceChildren();
  if (!slices.length) {
    container.append(emptyMessage("No breakdown available for this chart."));
    return;
  }

  const colored = slices.map((slice, index) => ({ ...slice, color: PALETTE[index % PALETTE.length] }));
  const bar = document.createElement("div");
  bar.className = "stacked-bar";
  colored.forEach((slice) => {
    const segment = document.createElement("i");
    segment.style.width = `${slice.percent}%`;
    segment.style.backgroundColor = slice.color;
    segment.title = `${slice.label}: ${slice.count} records (${slice.percent}%)`;
    bar.append(segment);
  });
  container.append(bar, renderLegend(colored));
}

function renderScatter(container, { points }) {
  if (!container) return;
  container.replaceChildren();
  if (!points.length) {
    container.append(emptyMessage("No records with both price and rate values."));
    return;
  }

  const width = 640;
  const height = 260;
  const pad = { left: 62, right: 16, top: 16, bottom: 44 };
  const innerWidth = width - pad.left - pad.right;
  const innerHeight = height - pad.top - pad.bottom;
  const xMax = Math.max(...points.map((point) => point.x)) * 1.06;
  const yMax = Math.max(...points.map((point) => point.y)) * 1.1;
  const chart = svgEl("svg", {
    viewBox: `0 0 ${width} ${height}`,
    class: "chart-svg",
    role: "img",
    "aria-label": "Asking price versus price per square foot scatter plot",
  });

  for (let tick = 0; tick <= 4; tick += 1) {
    const y = pad.top + innerHeight - (innerHeight * tick) / 4;
    const x = pad.left + (innerWidth * tick) / 4;
    chart.append(svgEl("line", { x1: pad.left, y1: y, x2: width - pad.right, y2: y, stroke: "rgba(255, 255, 255, 0.05)" }));
    chart.append(svgEl("line", { x1: x, y1: pad.top, x2: x, y2: pad.top + innerHeight, stroke: "rgba(255, 255, 255, 0.03)" }));
    chart.append(svgEl("text", { x: pad.left - 8, y: y + 3, "text-anchor": "end", class: "chart-axis-text" },
      shortLabel(formatRateINR((yMax * tick) / 4))));
    chart.append(svgEl("text", { x, y: height - 14, "text-anchor": "middle", class: "chart-axis-text" },
      shortLabel(formatPriceINR((xMax * tick) / 4))));
  }

  points.forEach((point) => {
    const cx = pad.left + (point.x / xMax) * innerWidth;
    const cy = pad.top + innerHeight - (point.y / yMax) * innerHeight;
    const dot = svgEl("circle", {
      cx, cy, r: 4, fill: "#38bdf8", "fill-opacity": 0.8, stroke: "rgba(15, 23, 42, 0.8)", "stroke-width": 1,
    });
    dot.append(svgEl("title", {}, `${point.label} — ${formatPriceINR(point.x)} at ${formatRateINR(point.y)}/sq ft`));
    chart.append(dot);
  });

  chart.append(svgEl("line", {
    x1: pad.left, y1: pad.top + innerHeight, x2: width - pad.right, y2: pad.top + innerHeight,
    stroke: "rgba(255, 255, 255, 0.12)", "stroke-width": 1,
  }));
  chart.append(svgEl("line", {
    x1: pad.left, y1: pad.top, x2: pad.left, y2: pad.top + innerHeight,
    stroke: "rgba(255, 255, 255, 0.12)", "stroke-width": 1,
  }));
  container.append(chart);
}

function renderMetricCards(analytics) {
  const container = byId("vizMetrics");
  if (!container) return;
  const priceRange = analytics.minPrice && analytics.maxPrice
    ? `${formatPriceINR(analytics.minPrice)} – ${formatPriceINR(analytics.maxPrice)}`
    : "priced inventory";
  const rateRange = analytics.minRate && analytics.maxRate
    ? `${formatRateINR(analytics.minRate)} – ${formatRateINR(analytics.maxRate)}`
    : "across listings";
  const activeShare = analytics.total
    ? Math.round((analytics.activeCount / analytics.total) * 100)
    : 0;

  const cards = [
    {
      label: "TOTAL INVENTORY VALUE",
      value: formatPriceINR(analytics.totalInventoryValue),
      caption: "sum of asking prices",
      trend: `${formatNumber(analytics.pricedCount)} priced`,
      trendTone: "flat",
      icon: "₹",
      theme: "kpi-slate",
    },
    {
      label: "VERIFIED RECORDS",
      value: formatNumber(analytics.total),
      caption: "live dataset records",
      trend: "100% verified",
      trendTone: "up",
      icon: "#",
      theme: "kpi-cyan",
    },
    {
      label: "MEDIAN ASKING PRICE",
      value: formatPriceINR(analytics.medianPrice),
      caption: "middle market valuation",
      trend: priceRange,
      trendTone: "flat",
      icon: "◈",
      theme: "kpi-slate",
    },
    {
      label: "AVG RATE / SQ FT",
      value: formatRateINR(analytics.avgRate),
      caption: "average per sq. ft.",
      trend: rateRange,
      trendTone: "flat",
      icon: "↗",
      theme: "kpi-slate",
    },
    {
      label: "RERA COMPLIANCE",
      value: `${analytics.reraPercent}%`,
      caption: "regulatory approved",
      trend: `${analytics.reraPercent}% certified`,
      trendTone: "flat",
      icon: "✓",
      theme: "kpi-cyan",
    },
    {
      label: "ACTIVE UNITS",
      value: formatNumber(analytics.activeCount),
      caption: "available listings",
      trend: `${activeShare}% of total stock`,
      trendTone: "up",
      icon: "●",
      theme: "kpi-slate",
    },
  ];

  container.replaceChildren(
    ...cards.map((c) => {
      const card = document.createElement("article");
      card.className = `viz-metric-card ${c.theme}`;
      const icon = document.createElement("span");
      icon.className = "viz-metric-icon";
      icon.textContent = c.icon;
      const title = document.createElement("span");
      title.textContent = c.label;
      const strong = document.createElement("strong");
      strong.textContent = c.value;
      const small = document.createElement("small");
      small.textContent = c.caption;
      const trend = document.createElement("span");
      trend.className = `viz-metric-trend ${c.trendTone}`;
      trend.textContent = c.trend;
      card.append(icon, title, strong, small, trend);
      return card;
    })
  );
}

/** Four headline facts drawn from the same computed analytics as the charts. */
function renderInsights(analytics) {
  const container = byId("vizInsights");
  if (!container) return;

  const top = analytics.localitySlices[0];
  const activeShare = analytics.total
    ? Math.round((analytics.activeCount / analytics.total) * 100)
    : 0;
  const items = [
    {
      label: "TOP MICRO-MARKET",
      value: top ? top.label : "—",
      note: top ? `${top.percent}% of listings` : "no locality data",
      tone: "lime",
    },
    {
      label: "ASKING PRICE BAND",
      value: analytics.minPrice
        ? `${formatPriceINR(analytics.minPrice)} – ${formatPriceINR(analytics.maxPrice)}`
        : "—",
      note: "lowest to highest listing",
      tone: "blue",
    },
    {
      label: "ACTIVE INVENTORY",
      value: formatNumber(analytics.activeCount),
      note: `${activeShare}% of all listings`,
      tone: "amber",
    },
    {
      label: "RERA REGISTERED",
      value: `${analytics.reraPercent}%`,
      note: "formally approved projects",
      tone: "teal",
    },
  ];

  container.replaceChildren(
    ...items.map((item) => {
      const card = document.createElement("div");
      card.className = `viz-insight tone-${item.tone}`;
      const label = document.createElement("span");
      label.textContent = item.label;
      const value = document.createElement("strong");
      value.textContent = item.value;
      const note = document.createElement("small");
      note.textContent = item.note;
      card.append(label, value, note);
      return card;
    })
  );
}

function syncChartExpandButton(card, expanded) {
  const button = card.querySelector(".chart-expand-btn");
  if (!button) return;
  button.setAttribute("aria-pressed", expanded ? "true" : "false");
  button.title = expanded ? "Collapse chart" : "Expand chart";
}

function collapseExpandedChart() {
  document.querySelectorAll("#vizGrid .chart-card.chart-expanded").forEach((card) => {
    card.classList.remove("chart-expanded");
    syncChartExpandButton(card, false);
  });
  const backdrop = byId("chartZoomBackdrop");
  if (backdrop) backdrop.hidden = true;
}

function toggleChartExpand(card) {
  const wasExpanded = card.classList.contains("chart-expanded");
  collapseExpandedChart();
  if (wasExpanded) return;
  card.classList.add("chart-expanded");
  syncChartExpandButton(card, true);
  const backdrop = byId("chartZoomBackdrop");
  if (backdrop) backdrop.hidden = false;
}

function setupChartExpandButtons() {
  document.querySelectorAll("#vizGrid .chart-card").forEach((card) => {
    const header = card.querySelector("header");
    if (!header || header.querySelector(".chart-expand-btn")) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "chart-expand-btn";
    button.title = "Expand chart";
    button.setAttribute("aria-label", "Expand chart");
    button.setAttribute("aria-pressed", "false");
    button.textContent = "⤢";
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleChartExpand(card);
    });
    header.append(button);
  });
}

function filterChartsByCategory(category = "all") {
  collapseExpandedChart();
  state.vizActiveCategory = category;
  document.querySelectorAll("#vizCategoryTabs .viz-tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.category === category);
  });
  const cards = document.querySelectorAll("#vizGrid .chart-card");
  cards.forEach((card) => {
    const cardCat = card.dataset.category;
    if (category === "all" || cardCat === category) {
      card.style.display = "";
    } else {
      card.style.display = "none";
    }
  });
}

function renderCharts(analytics) {
  renderMetricCards(analytics);
  renderInsights(analytics);

  renderHistogram(byId("vizPriceHistogram"), {
    buckets: analytics.priceBuckets,
    valueFormatter: formatPriceINR,
    color: "#5d8cff",
  });
  renderDonut(byId("vizLocalityDonut"), {
    slices: analytics.localitySlices,
    centerLabel: "top locality",
    centerValue: analytics.localitySlices.length ? String(analytics.localitySlices[0].percent) + "%" : "—",
  });
  renderStackedBar(byId("vizStatusStack"), { slices: analytics.statusSlices });
  renderScatter(byId("vizScatter"), { points: analytics.scatter });
  renderHorizontalBars(byId("vizBuilders"), { rows: analytics.topBuilders });
  renderHistogram(byId("vizDomHistogram"), {
    buckets: analytics.marketDayBuckets,
    valueFormatter: (value) => `${Math.round(value)}d`,
    color: "#64748b",
  });
  renderDonut(byId("vizStageDonut"), {
    slices: analytics.stageSlices,
    centerLabel: "stages",
    centerValue: String(analytics.stageSlices.length),
  });
  renderStackedBar(byId("vizMovement"), { slices: analytics.priceMovementSlices });

  filterChartsByCategory(state.vizActiveCategory || "all");
  setText("vizStatus", `Derived from ${formatNumber(analytics.total)} records · computed live`);
}

export function closeVisualization() {
  collapseExpandedChart();
  setOpen("visualizationView", false);
}

export async function openVisualization(index = state.activeDatasetIndex) {
  const dataset = state.datasets[index];
  if (!dataset) {
    showToast("Select a dataset to visualize.");
    return;
  }

  state.activeDatasetIndex = index;
  collapseFullCard();
  setText("vizTitle", dataset.title);
  setText("vizSubtitle", dataset.description);
  setText("vizStatus", "Loading records for visualization…");

  const cached = state.fullRecordsSlug === dataset.slug && state.fullRecords.length
    ? state.fullRecords
    : null;

  setOpen("profileDrawer", false);
  setOpen("datasetFullView", false);
  setOpen("visualizationView", true);

  let records = cached;
  if (!records) {
    try {
      const token = await getSessionToken();
      const result = await fetchDatasetRecords(dataset.slug, token);
      records = Array.isArray(result?.records) ? result.records : [];
      state.fullRecords = records;
      state.fullRecordsSlug = dataset.slug;
    } catch (error) {
      setText("vizStatus", `Unable to load records: ${error?.message || "server error"}`);
      showToast(`Visualization failed: ${error?.message || "please try again."}`);
      return;
    }
  }

  if (!records.length) {
    setText("vizStatus", "No records available to visualize.");
    renderCharts(computeAnalytics([]));
    return;
  }
  renderCharts(computeAnalytics(records));
}

export function bindVisualization() {
  byId("closeVisualization")?.addEventListener("click", closeVisualization);
  byId("vizBackdrop")?.addEventListener("click", closeVisualization);
  byId("vizBackToData")?.addEventListener("click", () => {
    const index = state.activeDatasetIndex;
    closeVisualization();
    void openFullDataset(index);
  });
  byId("fullVisualizeBtn")?.addEventListener("click", () => {
    void openVisualization(state.activeDatasetIndex);
  });

  document.querySelectorAll("#vizCategoryTabs .viz-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      filterChartsByCategory(tab.dataset.category || "all");
    });
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (byId("visualizationView")?.getAttribute("aria-hidden") !== "false") return;
    if (document.querySelector("#vizGrid .chart-card.chart-expanded")) {
      collapseExpandedChart();
      return;
    }
    closeVisualization();
  });
}
