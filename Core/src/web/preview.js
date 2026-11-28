// Live data & analytics preview workbench.

import { state, currentDataset, markSelectedCard } from "./state.js";
import {
  byId,
  setText,
  formatNumber,
  escapeHtml,
  safeColor,
  safePercent,
  setOpen,
  renderTableMessage,
} from "./dom.js";
import { fetchPreview } from "./api.js";
import { openFullDataset } from "./fullDataset.js";
import { requestSampleExport } from "./downloads.js";

// The 23-column display contract, grouped for the two-level table header.
// Labels are static UI copy; every value is read from the API response.
export const FIELD_GROUPS = [
  {
    label: "Identity",
    fields: [
      { key: "property_id", label: "Property ID" },
      { key: "rera_id", label: "RERA ID" },
      { key: "project_name", label: "Project Name" },
      { key: "builder_name", label: "Builder Name" },
    ],
  },
  {
    label: "Location",
    fields: [
      { key: "locality", label: "Locality" },
      { key: "city", label: "City" },
      { key: "pin_code", label: "Pin Code" },
    ],
  },
  {
    label: "Pricing & Price Change",
    fields: [
      { key: "asking_price", label: "Asking Price" },
      { key: "price_per_sqft", label: "Price / sq ft" },
      { key: "previous_asking_price", label: "Previous Asking Price" },
      { key: "price_change_amount", label: "Price Change Amount" },
      { key: "price_change_percent", label: "Price Change (%)" },
    ],
  },
  {
    label: "RERA & Construction",
    fields: [
      { key: "rera_status", label: "RERA Status" },
      { key: "construction_stage", label: "Construction Stage" },
      { key: "possession_date", label: "Possession Date" },
    ],
  },
  {
    label: "Market & Timeline",
    fields: [
      { key: "status", label: "Market Status" },
      { key: "days_on_market", label: "Days on Market" },
      { key: "listing_date", label: "Listing Date" },
    ],
  },
  {
    label: "Provenance & Geo",
    fields: [
      { key: "listed_by", label: "Listed By" },
      { key: "listing_source", label: "Listing Source" },
      { key: "source_url", label: "Source URL" },
      { key: "latitude", label: "Latitude" },
      { key: "longitude", label: "Longitude" },
    ],
  },
];

const CELL_CLASS_BY_KEY = {
  property_id: "col-id",
  rera_id: "col-id",
  project_name: "col-project",
  builder_name: "col-builder",
  locality: "col-locality",
  asking_price: "col-price",
  price_per_sqft: "col-rate",
};

const SCHEMA_KEYS = new Set(FIELD_GROUPS.flatMap((group) => group.fields.map((field) => field.key)));

// Retired or legacy keys must never be shown, even if an older API response
// still sends them. Row numbering is rendered by the shared table renderer.
export const HIDDEN_KEYS = new Set([
  "carpet_area",
  "carpet_area_sqft",
  "built_up_area_sqft",
  "super_built_up_area_sqft",
  "configuration",
  "property_type",
  "property_sub_type",
  "floor_number",
  "total_floors",
  "facing",
  "parking_count",
  "furnishing_status",
  "listing_timestamp",
  "scraped_at",
  "builder",
  "project_location",
  "asking_price_inr",
  "price_per_sqft_inr",
  "previous_asking_price_inr",
  "price_change_amount_inr",
  "row_index",
]);

const PREVIEW_TABLE = { tableId: "previewTable", tbodyId: "previewRows" };

function humanizeKey(key) {
  return String(key).replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function extraKeysFor(records) {
  const keys = new Set();
  for (const record of records || []) {
    for (const key of Object.keys(record || {})) {
      if (!SCHEMA_KEYS.has(key) && !HIDDEN_KEYS.has(key)) keys.add(key);
    }
  }
  return [...keys];
}

/**
 * Build the grouped, horizontally scrollable table header for either table.
 * `options` is opt-in so the preview table keeps its original two-row header:
 *   - selectable: adds a select-all checkbox column
 *   - filterRow: adds a per-column input row
 *   - sort: `{ key, dir }` marks the active sortable column
 *   - filters: `{ [key]: substring }` pre-fills the filter inputs
 */
export function getExcelColLetter(index) {
  let letter = "";
  let temp = index;
  while (temp >= 0) {
    letter = String.fromCharCode((temp % 26) + 65) + letter;
    temp = Math.floor(temp / 26) - 1;
  }
  return letter;
}

function renderTableHeader(
  { tableId } = PREVIEW_TABLE,
  groups = FIELD_GROUPS,
  extraKeys = [],
  options = {}
) {
  const thead = byId(tableId)?.querySelector("thead");
  if (!thead) return;

  const rowSpan = options.filterRow ? 3 : 2;
  const headerRows = [];

  const groupRow = document.createElement("tr");
  if (options.selectable) {
    const selectHead = document.createElement("th");
    selectHead.className = "select-col";
    selectHead.rowSpan = rowSpan;
    const selectAll = document.createElement("input");
    selectAll.type = "checkbox";
    selectAll.id = "fullSelectAll";
    selectAll.setAttribute("aria-label", "Select all rows on this page");
    selectHead.appendChild(selectAll);
    groupRow.appendChild(selectHead);
  }
  const indexHead = document.createElement("th");
  indexHead.rowSpan = rowSpan;
  indexHead.className = "index-col";
  indexHead.textContent = "#";
  groupRow.appendChild(indexHead);

  for (const group of groups) {
    const th = document.createElement("th");
    th.className = "group-head";
    th.colSpan = group.fields.length;
    th.textContent = group.label;
    groupRow.appendChild(th);
  }
  if (extraKeys.length) {
    const th = document.createElement("th");
    th.className = "group-head";
    th.colSpan = extraKeys.length;
    th.textContent = "Additional fields";
    groupRow.appendChild(th);
  }
  headerRows.push(groupRow);

  const labelRow = document.createElement("tr");
  let colCounter = 0;
  const addLabelHead = (field) => {
    const th = document.createElement("th");
    th.title = field.key;
    const cLetter = getExcelColLetter(colCounter);
    colCounter++;

    if (options.selectable) {
      const letterSpan = document.createElement("span");
      letterSpan.className = "col-letter-badge";
      letterSpan.textContent = cLetter;
      th.appendChild(letterSpan);
    }

    const labelSpan = document.createElement("span");
    labelSpan.className = "col-label-text";
    labelSpan.textContent = field.label;
    th.appendChild(labelSpan);

    if (options.sort) {
      th.dataset.fieldKey = field.key;
      th.classList.add("sortable");
      th.title = `Sort by ${field.label} (Col ${cLetter})`;
      const arrow = document.createElement("span");
      arrow.className = "sort-arrow";
      if (options.sort.key === field.key) {
        th.classList.add("sorted", options.sort.dir);
        arrow.textContent = options.sort.dir === "desc" ? " ▼" : " ▲";
      } else {
        arrow.className = "sort-arrow sort-idle";
        arrow.textContent = " ↕";
      }
      th.appendChild(arrow);
    }
    labelRow.appendChild(th);
  };
  for (const group of groups) {
    for (const field of group.fields) addLabelHead(field);
  }
  for (const key of extraKeys) addLabelHead({ key, label: humanizeKey(key) });
  headerRows.push(labelRow);

  if (options.filterRow) {
    const filterRow = document.createElement("tr");
    filterRow.className = "filter-row";
    // The index and selection headers use rowSpan=3, so no placeholder cells
    // are added here — they already occupy this row.
    const addFilterHead = (key) => {
      const th = document.createElement("th");
      const input = document.createElement("input");
      input.type = "search";
      input.className = "filter-input";
      input.placeholder = "Filter…";
      input.dataset.filterKey = key;
      input.setAttribute("aria-label", `Filter ${humanizeKey(key)}`);
      input.value = options.filters?.[key] || "";
      th.appendChild(input);
      filterRow.appendChild(th);
    };
    for (const group of groups) {
      for (const field of group.fields) addFilterHead(field.key);
    }
    for (const key of extraKeys) addFilterHead(key);
    headerRows.push(filterRow);
  }

  thead.replaceChildren(...headerRows);
}

export function renderPreviewHeader(extraKeys = []) {
  renderTableHeader(PREVIEW_TABLE, FIELD_GROUPS, extraKeys);
}

/** The third preview card uses API field counts, never invented benchmarks. */
function renderSchemaCard(dataset) {
  setText("schemaTitle", dataset?.fieldsCount === null || dataset?.fieldsCount === undefined
    ? "—"
    : `${formatNumber(dataset.fieldsCount)} fields`, "—");
  setText("schemaGroupCount", `${FIELD_GROUPS.length} groups`, "—");

  const container = byId("schemaGroups");
  if (!container) return;
  container.replaceChildren(
    ...FIELD_GROUPS.map((group) => {
      const chip = document.createElement("div");
      chip.className = "schema-group-chip";
      const label = document.createElement("span");
      label.textContent = group.label;
      chip.appendChild(label);
      return chip;
    })
  );
}

/**
 * Shared grouped-table renderer. Both the preview workbench and the full
 * dataset view use it, so escaping, grouping and null handling stay identical.
 */
export function renderTableInto(
  { tableId, tbodyId } = PREVIEW_TABLE,
  records,
  emptyMessage = "No records available.",
  startOffset = 0,
  options = {}
) {
  const tbody = byId(tbodyId);
  if (!tbody) return;

  const rows = Array.isArray(records) ? records : [];
  const hidden = options.hiddenKeys instanceof Set ? options.hiddenKeys : new Set();
  const groups = FIELD_GROUPS
    .map((group) => ({
      ...group,
      fields: group.fields.filter((field) => !hidden.has(field.key)),
    }))
    .filter((group) => group.fields.length > 0);
  const extraKeys = extraKeysFor(rows).filter((key) => !hidden.has(key));

  if (!options.skipHeader) renderTableHeader({ tableId }, groups, extraKeys, options);

  if (!rows.length) {
    renderTableMessage(emptyMessage, { tableId, tbodyId });
    return;
  }

  const selected = options.selected instanceof Set ? options.selected : new Set();
  const indices = Array.isArray(options.recordIndices) ? options.recordIndices : null;

  // Every API-derived value passes through escapeHtml before innerHTML.
  tbody.innerHTML = rows
    .map((record, i) => {
      const absoluteIndex = indices ? indices[i] : startOffset + i;
      const isRowSelected = selected.has(absoluteIndex);
      const selectCell = options.selectable
        ? `<td class="select-col"><input type="checkbox" data-select-index="${escapeHtml(absoluteIndex)}"${isRowSelected ? " checked" : ""} aria-label="Select row ${escapeHtml(absoluteIndex + 1)}"></td>`
        : "";
      let colIdx = 0;
      const allFields = [
        ...groups.flatMap((g) => g.fields),
        ...extraKeys.map((k) => ({ key: k, label: humanizeKey(k) }))
      ];
      const cells = allFields.map((field) => {
        const value = record?.[field.key] ?? "—";
        const cls = CELL_CLASS_BY_KEY[field.key] || "";
        const cLetter = getExcelColLetter(colIdx);
        const coord = `${cLetter}${startOffset + i + 1}`;
        const currentCol = colIdx;
        colIdx++;
        return `<td class="excel-cell${cls ? ` ${cls}` : ""}" data-row="${startOffset + i}" data-col="${currentCol}" data-col-letter="${cLetter}" data-coord="${coord}" data-field-key="${escapeHtml(field.key)}" data-field-label="${escapeHtml(field.label || field.key)}" data-raw-value="${escapeHtml(value)}"><span class="cell-text">${escapeHtml(value)}</span></td>`;
      });
      return `<tr data-row-index="${absoluteIndex}" class="${isRowSelected ? "row-selected" : ""}">${selectCell}<td class="row-num-cell" data-row-index="${absoluteIndex}"><span class="row-num">${escapeHtml(absoluteIndex + 1)}</span></td>${cells.join("")}</tr>`;
    })
    .join("");
}

export function renderPreviewRows(records) {
  renderTableInto(PREVIEW_TABLE, records, "No preview records available for this dataset.");
}

export function applyTableFilter() {
  const query = (byId("tableSearchInput")?.value || "").toLowerCase().trim();
  const market = state.activeTableMarket.toLowerCase();

  const filtered = state.previewRecords.filter((record) => {
    const locality = String(record?.locality ?? "").toLowerCase();
    const project = String(record?.project_name ?? "").toLowerCase();
    const matchesMarket = market === "all" || locality.includes(market) || project.includes(market);
    // Search spans every supplied field, not just a hand-picked few.
    const hay = Object.values(record || {}).join(" ").toLowerCase();
    return matchesMarket && (!query || hay.includes(query));
  });

  renderPreviewRows(filtered);
  setText("tableRowCount", `${filtered.length} of ${state.previewRecords.length} verified records`, "0 of 0 verified records");
}

function renderLegend(labels, colors, values) {
  const legend = byId("previewLegend");
  if (!legend) return;

  if (!labels.length) {
    const empty = document.createElement("span");
    empty.textContent = "No distribution data available";
    legend.replaceChildren(empty);
    return;
  }

  legend.replaceChildren(
    ...labels.map((label, i) => {
      const span = document.createElement("span");
      const dot = document.createElement("i");
      dot.style.backgroundColor = safeColor(colors[i] || colors[0]);
      const value = document.createElement("b");
      value.textContent = values[i] ?? "—";
      span.append(dot, document.createTextNode(`${label} `), value);
      return span;
    })
  );
}

function renderDatasetVisuals(metrics) {
  setText("visualTitle", metrics?.title ?? "—");
  setText("distributionRows", metrics?.totalRecords !== null && metrics?.totalRecords !== undefined
    ? `${formatNumber(metrics.totalRecords)} rows`
    : "—");
  setText("pieTitle", metrics?.statusTitle ?? "—");

  document.querySelectorAll("#miniBars i").forEach((bar, i) => {
    bar.style.height = `${safePercent(metrics?.bars?.[i], 0)}%`;
  });

  setText("priceBracketLow", metrics?.priceBrackets?.[0] ?? "—");
  setText("priceBracketMid", metrics?.priceBrackets?.[1] ?? "—");
  setText("priceBracketHigh", metrics?.priceBrackets?.[2] ?? "—");
  renderLegend(metrics?.legend || [], metrics?.colors || [], metrics?.values || []);

  const pie = byId("previewPie");
  if (!pie) return;

  if (!metrics?.legend?.length) {
    pie.style.background = "conic-gradient(#242936 0 100%)";
    return;
  }

  const colors = metrics.colors.length ? metrics.colors : ["#62a3ff", "#c9ff35", "#7f8797"];
  let cursor = 0;
  const stops = metrics.legend.map((_label, i) => {
    const start = cursor;
    cursor = Math.min(100, cursor + safePercent(parseFloat(metrics.values[i]), 0));
    return `${safeColor(colors[i] || colors[0])} ${start}% ${cursor}%`;
  });
  if (cursor < 100) stops.push(`#242936 ${cursor}% 100%`);
  pie.style.background = `conic-gradient(${stops.join(", ")})`;
}

export function closeDrawer() {
  setOpen("datasetDrawer", false);
}

export async function openDrawer(index = state.activeDatasetIndex) {
  const dataset = state.datasets[index];
  if (!dataset) {
    showPreviewError("Select a dataset to preview.");
    return;
  }

  state.activeDatasetIndex = index;
  markSelectedCard(index);

  setText("drawerTitle", dataset.title);
  setText("drawerRecords", formatNumber(dataset.recordCount));
  setText("drawerFields", dataset.fieldsCount === null || dataset.fieldsCount === undefined
    ? "—"
    : `${formatNumber(dataset.fieldsCount)} fields`);
  setText("drawerCoverage", dataset.coverage);
  setText("snapshotRecordEst", formatNumber(dataset.recordCount));
  renderSchemaCard(dataset);
  setText(
    "sampleResult",
    "Sample files include the full 23-column schema and up to 50 rows. Get access to explore every record in-app.",
    "—"
  );

  const search = byId("tableSearchInput");
  if (search) search.value = "";
  state.activeTableMarket = "all";
  document.querySelectorAll(".market-pill").forEach((pill) => {
    pill.classList.toggle("active", pill.dataset.market === "all");
  });

  state.previewRecords = [];
  renderPreviewHeader();
  renderTableMessage("Loading preview…");
  renderDatasetVisuals(null);
  setOpen("datasetDrawer", true);

  try {
    const preview = await fetchPreview(dataset.slug);
    if (state.activeDatasetIndex !== index) return; // a different dataset was opened meanwhile

    state.previewRecords = preview.records;
    renderDatasetVisuals(preview.metrics);

    if (state.previewRecords.length) {
      applyTableFilter();
    } else {
      renderTableMessage("No preview records available for this dataset.");
    }
  } catch (error) {
    if (state.activeDatasetIndex !== index) return;
    state.previewRecords = [];
    renderDatasetVisuals(null);
    renderTableMessage(`Preview is unavailable right now: ${error?.message || "server error"}`);
  }
}

function showPreviewError(message) {
  renderTableMessage(message);
}

export function bindPreview() {
  renderPreviewHeader();

  byId("maximizeDrawer")?.addEventListener("click", () => {
    document.querySelector(".drawer-panel")?.classList.toggle("compact-drawer");
  });

  document.querySelector(".drawer-backdrop")?.addEventListener("click", closeDrawer);
  byId("closeDrawer")?.addEventListener("click", closeDrawer);

  byId("drawerAccess")?.addEventListener("click", () => openFullDataset(state.activeDatasetIndex));

  document.querySelectorAll(".drawer-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      const panelId = `${tab.dataset.tab}Panel`;
      if (!["previewPanel", "snapshotPanel"].includes(panelId)) return;
      document.querySelectorAll(".drawer-tab,.tab-panel").forEach((el) => el.classList.remove("active"));
      tab.classList.add("active");
      byId(panelId)?.classList.add("active");
    });
  });

  document.querySelectorAll(".format-options button").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".format-options button").forEach((b) => b.classList.remove("active"));
      button.classList.add("active");
      if (["csv", "xlsx", "parquet"].includes(button.dataset.format)) {
        state.selectedFormat = button.dataset.format;
        state.checkoutFormat = button.dataset.format;
      }
    });
  });

  byId("tableSearchInput")?.addEventListener("input", applyTableFilter);

  byId("microMarketPills")?.addEventListener("click", (event) => {
    const pill = event.target.closest(".market-pill");
    if (!pill) return;
    document.querySelectorAll(".market-pill").forEach((p) => p.classList.remove("active"));
    pill.classList.add("active");
    state.activeTableMarket = pill.dataset.market || "all";
    applyTableFilter();
  });

  byId("snapshotDownload")?.addEventListener("click", () => {
    requestSampleExport(currentDataset()?.slug, state.selectedFormat, byId("sampleResult"));
  });
}
