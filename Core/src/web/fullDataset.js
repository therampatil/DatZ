// Full in-app dataset explorer with spreadsheet-style controls (sort, per-column
// filters, column visibility, row selection, clipboard copy), pagination,
// locality filtering, export menu, and horizontal scroll support.
// Visual analytics live in the dedicated visualization page.

import { state, currentDataset } from "./state.js";
import { byId, setText, formatNumber, setOpen, showToast } from "./dom.js";
import { fetchDatasetRecords, downloadFullExport, getSessionToken } from "./api.js";
import { renderTableInto, FIELD_GROUPS, HIDDEN_KEYS } from "./preview.js";
import { parseNumeric, formatPriceINR } from "./analytics.js";
import { saveAccessRecord } from "./ownedDatabases.js";

const FORMATS = new Set(["csv", "xlsx", "parquet"]);
const FULL_TABLE = { tableId: "fullDatasetTable", tbodyId: "fullDatasetRows" };
const HIDDEN_COLS_KEY = "datz_full_hidden_columns";
let fullTotal = 0;

function humanize(key) {
  return String(key).replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function getTypeName(val) {
  if (val === null || val === undefined || val === "" || val === "—") return "EMPTY";
  const s = String(val).trim();
  if (s.includes("₹") || s.includes("Cr") || s.includes("sq.ft")) return "CURRENCY";
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return "DATE";
  if (!isNaN(Number(s.replace(/,/g, "")))) return "NUMBER";
  return "TEXT";
}

function selectActiveCell(cellEl, shouldScroll = false) {
  if (!cellEl) return;
  document.querySelectorAll("#fullDatasetRows .cell-active").forEach((el) => el.classList.remove("cell-active"));
  cellEl.classList.add("cell-active");

  const coord = cellEl.dataset.coord || "A1";
  const fieldKey = cellEl.dataset.fieldKey || "";
  const fieldLabel = cellEl.dataset.fieldLabel || humanize(fieldKey);
  const rawValue = cellEl.dataset.rawValue || cellEl.textContent.trim() || "";
  const row = Number(cellEl.dataset.row);
  const col = Number(cellEl.dataset.col);

  state.fullActiveCell = { row, col, key: fieldKey, value: rawValue, coord };

  setText("excelActiveCoord", coord);
  setText("excelActiveField", `${fieldLabel} · ${getTypeName(rawValue)}`);
  const formulaInput = byId("excelFormulaInput");
  if (formulaInput) formulaInput.value = rawValue === "—" ? "" : rawValue;
  setText("excelActiveCellStatus", `Cell: ${coord} (${fieldLabel})`);

  if (shouldScroll) {
    cellEl.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  updateExcelStats();
}

function updateExcelStats(pageItemsOverride = null) {
  const selectedIndices = state.fullSelected;
  const numericValues = [];
  let count = 0;

  if (selectedIndices.size > 0) {
    count = selectedIndices.size;
    for (const item of state.fullRecords) {
      const idx = item.index ?? state.fullRecords.indexOf(item);
      if (selectedIndices.has(idx)) {
        const price = parseNumeric(item?.asking_price ?? item?.asking_price_inr);
        if (price > 0) numericValues.push(price);
      }
    }
  } else if (state.fullActiveCell?.value && state.fullActiveCell.value !== "—") {
    count = 1;
    const num = parseNumeric(state.fullActiveCell.value);
    if (num > 0) numericValues.push(num);
  } else {
    const pageItems = pageItemsOverride || getSortedFilteredRecords();
    count = pageItems.length;
    for (const item of pageItems) {
      const r = item.record || item;
      const price = parseNumeric(r?.asking_price ?? r?.asking_price_inr);
      if (price > 0) numericValues.push(price);
    }
  }

  setText("excelStatCount", String(count));
  if (numericValues.length > 0) {
    const sum = numericValues.reduce((a, b) => a + b, 0);
    const avg = Math.round(sum / numericValues.length);
    const min = Math.min(...numericValues);
    const max = Math.max(...numericValues);
    setText("excelStatSum", formatPriceINR(sum));
    setText("excelStatAvg", formatPriceINR(avg));
    setText("excelStatMin", formatPriceINR(min));
    setText("excelStatMax", formatPriceINR(max));
  } else {
    setText("excelStatSum", "—");
    setText("excelStatAvg", "—");
    setText("excelStatMin", "—");
    setText("excelStatMax", "—");
  }
}

function updateDatasetSummary(records) {
  const list = Array.isArray(records) ? records : [];
  const priced = list.filter((record) =>
    parseNumeric(record?.asking_price ?? record?.asking_price_inr) > 0
  ).length;
  const reraLinked = list.filter((record) => {
    const id = String(record?.rera_id ?? "").trim();
    const status = String(record?.rera_status ?? "").trim();
    return Boolean(id && id !== "—") || /regist|approv|sanction/i.test(status);
  }).length;
  const sources = new Set(
    list.map((record) => String(record?.listing_source ?? record?.source ?? "").trim()).filter(Boolean)
  );

  setText("fullSummaryRecords", formatNumber(list.length));
  setText("fullSummaryPriced", formatNumber(priced));
  setText("fullSummaryRera", formatNumber(reraLinked));
  setText("fullSummarySources", formatNumber(sources.size));
}

function navigateActiveCell(rowDelta, colDelta) {
  const current = state.fullActiveCell;
  if (current.row === null || current.col === null) {
    const first = byId("fullDatasetRows")?.querySelector("td.excel-cell");
    if (first) selectActiveCell(first, true);
    return;
  }
  const targetRow = current.row + rowDelta;
  const targetCol = current.col + colDelta;
  const target = byId("fullDatasetRows")?.querySelector(`td.excel-cell[data-row="${targetRow}"][data-col="${targetCol}"]`);
  if (target) {
    selectActiveCell(target, true);
  }
}

function loadHiddenColumns() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(HIDDEN_COLS_KEY) || "[]");
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

function persistHiddenColumns() {
  try {
    window.localStorage.setItem(HIDDEN_COLS_KEY, JSON.stringify([...state.fullHiddenKeys]));
  } catch {
    // Preference persistence is best-effort; the active view still updates.
  }
}

function setExportEnabled(enabled) {
  const button = byId("fullExportBtn");
  if (button) button.disabled = !enabled;
}

function setExportMenuOpen(open) {
  const menu = byId("fullExportOptions");
  const button = byId("fullExportBtn");
  if (menu) menu.hidden = !open;
  if (button) {
    button.setAttribute("aria-expanded", open ? "true" : "false");
    button.classList.toggle("menu-open", open);
  }
}

function setColumnMenuOpen(open) {
  const menu = byId("fullColumnOptions");
  const button = byId("fullColumnsBtn");
  if (menu) menu.hidden = !open;
  if (button) {
    button.setAttribute("aria-expanded", open ? "true" : "false");
    button.classList.toggle("menu-open", open);
  }
}

function syncFormatButtons() {
  document.querySelectorAll("#fullExportFormats button").forEach((button) => {
    button.classList.toggle("active", button.dataset.format === state.fullExportFormat);
  });
}

function syncFilterRowButton() {
  const button = byId("fullFilterRowBtn");
  if (!button) return;
  button.classList.toggle("active", state.fullFilterRowOpen);
  button.setAttribute("aria-pressed", state.fullFilterRowOpen ? "true" : "false");
}

function allColumns() {
  const columns = [];
  const schemaKeys = new Set();
  for (const group of FIELD_GROUPS) {
    for (const field of group.fields) {
      columns.push({ key: field.key, label: field.label, group: group.label });
      schemaKeys.add(field.key);
    }
  }
  const extras = new Map();
  for (const record of state.fullRecords) {
    for (const key of Object.keys(record || {})) {
      if (schemaKeys.has(key) || HIDDEN_KEYS.has(key) || extras.has(key)) continue;
      extras.set(key, humanize(key));
    }
  }
  for (const [key, label] of extras) columns.push({ key, label, group: "Additional fields" });
  return columns;
}

function visibleColumns() {
  return allColumns().filter((column) => !state.fullHiddenKeys.has(column.key));
}

function renderColumnMenu() {
  const menu = byId("fullColumnOptions");
  if (!menu) return;

  const columns = allColumns();
  const grouped = new Map();
  for (const column of columns) {
    if (!grouped.has(column.group)) grouped.set(column.group, []);
    grouped.get(column.group).push(column);
  }

  const sections = [];
  for (const [groupLabel, items] of grouped) {
    const section = document.createElement("div");
    section.className = "column-menu-group";
    const heading = document.createElement("strong");
    heading.textContent = groupLabel;
    section.appendChild(heading);
    for (const column of items) {
      const option = document.createElement("label");
      option.className = "column-option";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.dataset.columnKey = column.key;
      checkbox.checked = !state.fullHiddenKeys.has(column.key);
      const label = document.createElement("span");
      label.textContent = column.label;
      option.append(checkbox, label);
      section.appendChild(option);
    }
    sections.push(section);
  }
  menu.replaceChildren(...sections);
  setText(
    "fullColumnCount",
    `${columns.length - state.fullHiddenKeys.size}/${columns.length}`,
    "—"
  );
}

function updateSelectionStatus() {
  const count = state.fullSelected.size;
  setText("fullSelectionStatus", count ? `${count} selected` : "No rows selected", "No rows selected");
  const copyButton = byId("fullCopySelected");
  const clearButton = byId("fullClearSelection");
  if (copyButton) copyButton.disabled = count === 0;
  if (clearButton) clearButton.disabled = count === 0;
}

export function closeFullDataset() {
  state.fullCardExpanded = false;
  syncExpandButton();
  setExportMenuOpen(false);
  setColumnMenuOpen(false);
  setOpen("datasetFullView", false);
}

/** Comparable value: numbers stay numeric, text is lowercased, blanks sort last. */
function sortValue(value) {
  if (value === null || value === undefined || value === "" || value === "—") return null;
  const numeric = parseNumeric(value);
  const text = String(value).trim();
  if (numeric !== 0 || /^[+\-−]?\d/.test(text)) return numeric;
  return text.toLowerCase();
}

function compareValues(a, b, direction) {
  const left = sortValue(a);
  const right = sortValue(b);
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  const result = typeof left === "number" && typeof right === "number"
    ? left - right
    : String(left).localeCompare(String(right));
  return result * direction;
}

/** Returns indexed records so selection stays tied to the original dataset. */
function getFilteredRecords() {
  const query = (byId("fullViewSearch")?.value || "").toLowerCase().trim();
  const market = (state.fullActiveMarket || "all").toLowerCase();
  const filters = Object.entries(state.fullColumnFilters)
    .filter(([key, value]) => !state.fullHiddenKeys.has(key) && String(value).trim())
    .map(([key, value]) => [key, String(value).toLowerCase().trim()]);

  return state.fullRecords
    .map((record, index) => ({ record, index }))
    .filter(({ record }) => {
      if (market !== "all") {
        const locality = String(record?.locality ?? "").toLowerCase();
        const project = String(record?.project_name ?? "").toLowerCase();
        const city = String(record?.city ?? "").toLowerCase();
        if (!locality.includes(market) && !project.includes(market) && !city.includes(market)) {
          return false;
        }
      }
      if (query && !Object.values(record || {}).join(" ").toLowerCase().includes(query)) {
        return false;
      }
      for (const [key, value] of filters) {
        if (!String(record?.[key] ?? "").toLowerCase().includes(value)) return false;
      }
      return true;
    });
}

function getSortedFilteredRecords() {
  const list = getFilteredRecords();
  const { key, dir } = state.fullSort;
  if (!key) return list;
  const direction = dir === "desc" ? -1 : 1;
  return [...list].sort((a, b) => compareValues(a.record?.[key], b.record?.[key], direction));
}

/** Renders the paginated slice and updates pagination/selection status. */
export function applyFullFilter(options = {}) {
  const filtered = getSortedFilteredRecords();
  const pageSize = state.fullPageSize === "all" ? Infinity : Number(state.fullPageSize) || 25;
  const totalRecords = filtered.length;
  const totalPages = pageSize === Infinity ? 1 : Math.max(1, Math.ceil(totalRecords / pageSize));

  if (state.fullPage > totalPages) state.fullPage = totalPages;
  if (state.fullPage < 1) state.fullPage = 1;

  const startOffset = pageSize === Infinity ? 0 : (state.fullPage - 1) * pageSize;
  const pageItems = pageSize === Infinity
    ? filtered
    : filtered.slice(startOffset, startOffset + pageSize);
  state.fullPageIndices = new Set(pageItems.map((item) => item.index));

  renderTableInto(
    FULL_TABLE,
    pageItems.map((item) => item.record),
    "No records match this filter or search.",
    startOffset,
    {
      hiddenKeys: state.fullHiddenKeys,
      sort: state.fullSort,
      selectable: true,
      selected: state.fullSelected,
      recordIndices: pageItems.map((item) => item.index),
      filterRow: state.fullFilterRowOpen,
      filters: state.fullColumnFilters,
      skipHeader: Boolean(options.skipHeader),
    }
  );

  const table = byId("fullDatasetTable");
  if (table) {
    table.classList.remove("density-compact", "density-standard", "density-comfortable");
    table.classList.add(`density-${state.fullDensity || "standard"}`);
  }
  const wrap = byId("fullViewTableWrap");
  if (wrap) {
    wrap.classList.toggle("freeze-active", Boolean(state.fullFreezePanes));
  }

  updateSelectionStatus();
  updateExcelStats(pageItems);

  const from = totalRecords === 0 ? 0 : startOffset + 1;
  const to = pageSize === Infinity ? totalRecords : Math.min(startOffset + pageSize, totalRecords);
  const filterCount = Object.keys(state.fullColumnFilters).length;
  const countMessage = `Showing ${from}–${to} of ${formatNumber(totalRecords)} records`;

  setText("fullViewStatus", countMessage);
  setText(
    "fullPaginationInfo",
    `${countMessage} ${fullTotal > totalRecords ? `(filtered from ${formatNumber(fullTotal)} total)` : ""}`
  );
  setText("fullPageCurrent", `Page ${state.fullPage} of ${totalPages}`);
  setText(
    "fullViewFilterInfo",
    filterCount ? `${filterCount} column ${filterCount === 1 ? "filter" : "filters"} active` : "No column filters",
    "No column filters"
  );

  const firstBtn = byId("fullPageFirst");
  const prevBtn = byId("fullPagePrev");
  const nextBtn = byId("fullPageNext");
  const lastBtn = byId("fullPageLast");
  if (firstBtn) firstBtn.disabled = state.fullPage <= 1;
  if (prevBtn) prevBtn.disabled = state.fullPage <= 1;
  if (nextBtn) nextBtn.disabled = state.fullPage >= totalPages;
  if (lastBtn) lastBtn.disabled = state.fullPage >= totalPages;
}

export async function openFullDataset(index = state.activeDatasetIndex) {
  const dataset = state.datasets[index];
  if (!dataset) {
    showToast("Select a dataset before opening the full dataset.");
    return;
  }

  state.activeDatasetIndex = index;
  state.fullRecords = [];
  state.fullRecordsSlug = null;
  fullTotal = 0;
  state.fullPage = 1;
  state.fullCardExpanded = false;
  state.fullActiveMarket = "all";
  state.fullSort = { key: null, dir: "asc" };
  state.fullColumnFilters = {};
  state.fullSelected.clear();
  state.fullPageIndices.clear();
  state.fullFilterRowOpen = false;
  syncFilterRowButton();
  syncExpandButton();
  setExportMenuOpen(false);
  setColumnMenuOpen(false);
  syncFormatButtons();

  document.querySelectorAll("#fullMarketPills .market-pill").forEach((pill) => {
    pill.classList.toggle("active", pill.dataset.market === "all");
  });

  const rowsSelect = byId("fullRowsPerPage");
  if (rowsSelect) rowsSelect.value = String(state.fullPageSize || 25);

  setText("fullViewTitle", dataset.title);
  setText("fullViewTableTitle", dataset.title);
  setText("fullViewDescription", dataset.description);
  setText("fullViewRecords", formatNumber(dataset.recordCount));
  setText(
    "fullViewFields",
    dataset.fieldsCount === null || dataset.fieldsCount === undefined
      ? "—"
      : formatNumber(dataset.fieldsCount)
  );
  updateDatasetSummary([]);
  setText("fullViewStatus", "Loading full dataset…");
  setText("fullViewResult", "Loading full dataset…", "—");

  const search = byId("fullViewSearch");
  if (search) search.value = "";
  setExportEnabled(false);
  renderTableInto(FULL_TABLE, [], "Loading full dataset…", 0, {
    hiddenKeys: state.fullHiddenKeys,
    selectable: true,
  });
  renderColumnMenu();
  setOpen("datasetDrawer", false);
  setOpen("detailsDrawer", false);
  setOpen("checkoutModal", false);
  setOpen("datasetFullView", true);

  // Automatically record access in browser ledger so it appears in "Your Databases"
  try {
    saveAccessRecord({
      datasetSlug: dataset.slug,
      title: dataset.title,
      category: dataset.category,
      recordCount: dataset.recordCount,
      format: "csv",
      status: "active",
      orderId: `ACC-${Date.now().toString(36).toUpperCase()}`,
      email: "direct-access@datz.in",
    });
  } catch {
    // best-effort
  }

  try {
    const token = await getSessionToken().catch(() => null);
    const result = await fetchDatasetRecords(dataset.slug, token);
    if (state.activeDatasetIndex !== index) return;
    if (byId("datasetFullView")?.getAttribute("aria-hidden") === "true") return;

    const records = Array.isArray(result?.records) ? result.records : [];
    state.fullRecords = records;
    state.fullRecordsSlug = dataset.slug;
    fullTotal = Number.isFinite(Number(result?.total)) ? Number(result.total) : records.length;
    setText("fullViewRecords", formatNumber(fullTotal));
    updateDatasetSummary(records);
    renderColumnMenu();
    applyFullFilter();
    setText("fullViewResult", "Sort, filter, or copy rows. Select Export to download.", "—");
    setExportEnabled(records.length > 0);
  } catch (error) {
    if (state.activeDatasetIndex !== index) return;
    state.fullRecords = [];
    state.fullRecordsSlug = null;
    fullTotal = 0;
    updateDatasetSummary([]);
    renderTableInto(FULL_TABLE, [], "Full dataset is unavailable right now.");
    setText("fullViewStatus", "Full dataset unavailable");
    setText("fullViewResult", `Unable to load full dataset: ${error?.message || "server error"}`, "—");
    setExportEnabled(false);
  }
}

function handleSort(key) {
  if (!key) return;
  if (state.fullSort.key !== key) {
    state.fullSort = { key, dir: "asc" };
  } else if (state.fullSort.dir === "asc") {
    state.fullSort = { key, dir: "desc" };
  } else {
    state.fullSort = { key: null, dir: "asc" };
  }
  state.fullPage = 1;
  applyFullFilter();
}

function handleTableChange(event) {
  const target = event.target;
  if (target?.id === "fullSelectAll") {
    const checked = target.checked;
    if (checked) {
      for (const index of state.fullPageIndices) state.fullSelected.add(index);
    } else {
      for (const index of state.fullPageIndices) state.fullSelected.delete(index);
    }
    document.querySelectorAll("#fullDatasetRows tr").forEach((tr) => {
      tr.classList.toggle("row-selected", checked);
      const box = tr.querySelector("input[data-select-index]");
      if (box) box.checked = checked;
    });
    updateSelectionStatus();
    updateExcelStats();
    return;
  }
  const index = target?.dataset?.selectIndex;
  if (index === undefined) return;
  const numericIndex = Number(index);
  if (!Number.isInteger(numericIndex)) return;
  if (target.checked) state.fullSelected.add(numericIndex);
  else state.fullSelected.delete(numericIndex);
  const tr = target.closest("tr");
  if (tr) tr.classList.toggle("row-selected", target.checked);
  updateSelectionStatus();
  updateExcelStats();
}

function handleTableInput(event) {
  const input = event.target?.closest?.("input[data-filter-key]");
  if (!input) return;
  const key = input.dataset.filterKey;
  const value = input.value.trim();
  if (value) state.fullColumnFilters[key] = value;
  else delete state.fullColumnFilters[key];
  state.fullPage = 1;
  applyFullFilter({ skipHeader: true });
}

function handleTableClick(event) {
  const head = event.target?.closest?.("th[data-field-key]");
  if (head) {
    handleSort(head.dataset.fieldKey);
    return;
  }
  const cell = event.target?.closest?.("td.excel-cell");
  if (cell) {
    selectActiveCell(cell);
    return;
  }
  const rowNumCell = event.target?.closest?.("td.row-num-cell");
  if (rowNumCell) {
    const rIdx = Number(rowNumCell.dataset.rowIndex);
    if (Number.isInteger(rIdx)) {
      if (state.fullSelected.has(rIdx)) state.fullSelected.delete(rIdx);
      else state.fullSelected.add(rIdx);
      const checkbox = document.querySelector(`#fullDatasetRows input[data-select-index="${rIdx}"]`);
      if (checkbox) checkbox.checked = state.fullSelected.has(rIdx);
      const tr = rowNumCell.closest("tr");
      if (tr) tr.classList.toggle("row-selected", state.fullSelected.has(rIdx));
      updateSelectionStatus();
      updateExcelStats();
    }
  }
}

function cellText(value) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\t/g, " ").replace(/\r?\n/g, " ").trim();
}

function buildTsv(items) {
  const columns = visibleColumns();
  const lines = [["#", ...columns.map((column) => column.label)].join("\t")];
  for (const { record, index } of items) {
    lines.push([String(index + 1), ...columns.map((column) => cellText(record?.[column.key]))].join("\t"));
  }
  return lines.join("\n");
}

async function copyText(text, message) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const area = document.createElement("textarea");
      area.value = text;
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      const copied = document.execCommand("copy");
      area.remove();
      if (!copied) throw new Error("clipboard unavailable");
    }
    showToast(message);
    setText("fullViewResult", message, "—");
  } catch (error) {
    const message = `Copy failed: ${error?.message || "clipboard unavailable"}`;
    showToast(message);
    setText("fullViewResult", message, "—");
  }
}

function selectedItems() {
  return state.fullRecords
    .map((record, index) => ({ record, index }))
    .filter((item) => state.fullSelected.has(item.index));
}

function syncExpandButton() {
  const expanded = state.fullCardExpanded === true;

  const iconBtn = byId("fullExpandBtn");
  if (iconBtn) {
    iconBtn.setAttribute("aria-pressed", expanded ? "true" : "false");
    iconBtn.title = expanded ? "Collapse dataset card" : "Expand dataset card";
    iconBtn.classList.toggle("active", expanded);
  }

  const headerBtn = byId("fullExpandHeaderBtn");
  if (headerBtn) {
    headerBtn.setAttribute("aria-pressed", expanded ? "true" : "false");
    headerBtn.classList.toggle("active", expanded);
    headerBtn.title = expanded ? "Exit full screen (Esc)" : "Expand to fullscreen";
    const iconSpan = headerBtn.querySelector(".expand-icon") || headerBtn.querySelector("span");
    if (iconSpan) {
      iconSpan.innerHTML = expanded
        ? `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/></svg>`
        : `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>`;
    }
  }

  const closeBtn = byId("fullExpandedClose");
  if (closeBtn) closeBtn.hidden = !expanded;

  const wrap = byId("fullViewTableWrap");
  const card = byId("fullViewTableCard");
  if (wrap) wrap.classList.toggle("expanded", expanded);
  if (card) card.classList.toggle("card-expanded", expanded);
  document.body.classList.toggle("dataset-expanded", expanded);
}

function toggleFullCard() {
  state.fullCardExpanded = !state.fullCardExpanded;
  syncExpandButton();
  showToast(state.fullCardExpanded ? "Dataset expanded to full screen" : "Dataset collapsed");
}

/** Collapse the immersive table card without closing the full dataset view. */
export function collapseFullCard() {
  if (!state.fullCardExpanded) return;
  state.fullCardExpanded = false;
  syncExpandButton();
}

function resetTableView() {
  state.fullSort = { key: null, dir: "asc" };
  state.fullColumnFilters = {};
  state.fullHiddenKeys.clear();
  persistHiddenColumns();
  state.fullSelected.clear();
  state.fullPageIndices.clear();
  state.fullFilterRowOpen = false;
  state.fullPage = 1;
  state.fullActiveMarket = "all";
  const search = byId("fullViewSearch");
  if (search) search.value = "";
  document.querySelectorAll("#fullMarketPills .market-pill").forEach((pill) => {
    pill.classList.toggle("active", pill.dataset.market === "all");
  });
  syncFilterRowButton();
  renderColumnMenu();
  applyFullFilter();
  showToast("Table view reset.");
}

function handleExportClick() {
  if (!state.fullRecords.length) {
    showToast("Open a dataset with records before exporting.");
    return;
  }
  setColumnMenuOpen(false);
  const menu = byId("fullExportOptions");
  const willOpen = menu ? menu.hidden : true;
  setExportMenuOpen(willOpen);
  if (willOpen) setText("fullViewResult", "Choose a format to download the full dataset.", "—");
}

async function downloadWithFormat(format) {
  const dataset = currentDataset();
  if (!dataset || !state.fullRecords.length) {
    showToast("Open a dataset with records before exporting.");
    return;
  }
  if (!FORMATS.has(format)) return;

  setExportMenuOpen(false);
  const button = byId("fullExportBtn");
  if (button) button.disabled = true;
  setText("fullViewResult", `Generating ${format.toUpperCase()} export…`, "—");

  try {
    const token = await getSessionToken();
    const blob = await downloadFullExport({ datasetSlug: dataset.slug, format }, token);
    const safeSlug = String(dataset.slug || "dataset").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
    const url = URL.createObjectURL(blob);
    try {
      const link = document.createElement("a");
      link.href = url;
      link.download = `${safeSlug}.${format}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
    } finally {
      URL.revokeObjectURL(url);
    }

    const message = `Full dataset exported as ${format.toUpperCase()} (${state.fullRecords.length} records)`;
    setText("fullViewResult", message, "—");
    showToast(message);
  } catch (error) {
    const message = `Full export failed: ${error?.message || "please try again."}`;
    setText("fullViewResult", message, "—");
    showToast(message);
  } finally {
    setExportEnabled(true);
  }
}

export function bindFullDataset() {
  state.fullHiddenKeys = loadHiddenColumns();
  syncFilterRowButton();
  syncExpandButton();

  byId("closeFullView")?.addEventListener("click", closeFullDataset);
  byId("fullViewBackdrop")?.addEventListener("click", closeFullDataset);

  byId("fullViewSearch")?.addEventListener("input", () => {
    state.fullPage = 1;
    applyFullFilter();
  });

  // Spreadsheet interactions on the table: sort headers, filter inputs, row selection.
  byId("fullDatasetTable")?.addEventListener("click", handleTableClick);
  byId("fullDatasetTable")?.addEventListener("input", handleTableInput);
  byId("fullDatasetTable")?.addEventListener("change", handleTableChange);

  byId("fullFilterRowBtn")?.addEventListener("click", () => {
    state.fullFilterRowOpen = !state.fullFilterRowOpen;
    syncFilterRowButton();
    applyFullFilter();
  });

  byId("fullExpandBtn")?.addEventListener("click", toggleFullCard);
  byId("fullExpandHeaderBtn")?.addEventListener("click", toggleFullCard);
  byId("fullCardExitBtn")?.addEventListener("click", () => {
    state.fullCardExpanded = false;
    syncExpandButton();
    showToast("Exited fullscreen mode");
  });
  byId("fullExpandedClose")?.addEventListener("click", () => {
    state.fullCardExpanded = false;
    syncExpandButton();
    closeFullDataset();
  });

  byId("fullColumnsBtn")?.addEventListener("click", () => {
    setExportMenuOpen(false);
    const menu = byId("fullColumnOptions");
    setColumnMenuOpen(menu ? menu.hidden : true);
  });

  byId("fullColumnOptions")?.addEventListener("change", (event) => {
    const checkbox = event.target?.closest?.("input[data-column-key]");
    if (!checkbox) return;
    const key = checkbox.dataset.columnKey;
    if (checkbox.checked) state.fullHiddenKeys.delete(key);
    else state.fullHiddenKeys.add(key);
    delete state.fullColumnFilters[key];
    persistHiddenColumns();
    renderColumnMenu();
    applyFullFilter();
  });

  byId("fullShowAllColumns")?.addEventListener("click", () => {
    state.fullHiddenKeys.clear();
    persistHiddenColumns();
    renderColumnMenu();
    applyFullFilter();
  });

  byId("fullCopySelected")?.addEventListener("click", () => {
    const items = selectedItems();
    if (!items.length) {
      showToast("Select at least one row to copy.");
      return;
    }
    void copyText(buildTsv(items), `Copied ${items.length} selected rows as TSV.`);
  });

  byId("fullCopyFiltered")?.addEventListener("click", () => {
    const items = getSortedFilteredRecords();
    if (!items.length) {
      showToast("There are no filtered rows to copy.");
      return;
    }
    void copyText(buildTsv(items), `Copied ${items.length} filtered rows as TSV.`);
  });

  byId("fullClearSelection")?.addEventListener("click", () => {
    state.fullSelected.clear();
    document.querySelectorAll("#fullDatasetRows input[data-select-index]").forEach((box) => {
      box.checked = false;
    });
    const selectAll = byId("fullSelectAll");
    if (selectAll) selectAll.checked = false;
    updateSelectionStatus();
  });

  byId("fullResetViewBtn")?.addEventListener("click", resetTableView);

  // Density toggle
  byId("fullDensitySelect")?.addEventListener("change", (event) => {
    state.fullDensity = event.target.value;
    const table = byId("fullDatasetTable");
    if (table) {
      table.classList.remove("density-compact", "density-standard", "density-comfortable");
      table.classList.add(`density-${state.fullDensity}`);
    }
    const modeName = state.fullDensity.charAt(0).toUpperCase() + state.fullDensity.slice(1);
    setText("excelStatusMode", `${modeName} view · 100%`);
  });

  // Freeze panes toggle
  byId("fullFreezeBtn")?.addEventListener("click", () => {
    state.fullFreezePanes = !state.fullFreezePanes;
    const wrap = byId("fullViewTableWrap");
    if (wrap) wrap.classList.toggle("freeze-active", state.fullFreezePanes);
    const btn = byId("fullFreezeBtn");
    if (btn) {
      btn.classList.toggle("active", state.fullFreezePanes);
      btn.setAttribute("aria-pressed", state.fullFreezePanes ? "true" : "false");
      btn.textContent = state.fullFreezePanes ? "Freeze: On" : "Freeze: Off";
    }
    showToast(state.fullFreezePanes ? "Freeze panes enabled" : "Freeze panes disabled");
  });

  // Select all rows on active page
  byId("fullSelectAllBtn")?.addEventListener("click", () => {
    for (const index of state.fullPageIndices) state.fullSelected.add(index);
    document.querySelectorAll("#fullDatasetRows tr").forEach((tr) => {
      tr.classList.add("row-selected");
      const box = tr.querySelector("input[data-select-index]");
      if (box) box.checked = true;
    });
    const selectAllBox = byId("fullSelectAll");
    if (selectAllBox) selectAllBox.checked = true;
    updateSelectionStatus();
    updateExcelStats();
    showToast(`Selected all ${state.fullPageIndices.size} rows on this page.`);
  });

  // Copy active cell value
  byId("excelCopyCellBtn")?.addEventListener("click", () => {
    const val = state.fullActiveCell.value;
    if (!val || val === "—") {
      showToast("Selected cell has no value to copy.");
      return;
    }
    void copyText(val, `Copied cell ${state.fullActiveCell.coord} (${val}) to clipboard.`);
  });

  // Export dropdown
  byId("fullExportBtn")?.addEventListener("click", handleExportClick);

  document.querySelectorAll("#fullExportFormats button").forEach((button) => {
    button.addEventListener("click", () => {
      const format = button.dataset.format;
      if (!FORMATS.has(format)) return;
      state.fullExportFormat = format;
      syncFormatButtons();
      void downloadWithFormat(format);
    });
  });

  // Locality / Market Filter Pills
  document.querySelectorAll("#fullMarketPills .market-pill").forEach((pill) => {
    pill.addEventListener("click", () => {
      document.querySelectorAll("#fullMarketPills .market-pill").forEach((p) => p.classList.remove("active"));
      pill.classList.add("active");
      state.fullActiveMarket = pill.dataset.market || "all";
      state.fullPage = 1;
      applyFullFilter();
    });
  });

  byId("fullRowsPerPage")?.addEventListener("change", (event) => {
    state.fullPageSize = event.target.value;
    state.fullPage = 1;
    applyFullFilter();
  });

  byId("fullPageFirst")?.addEventListener("click", () => {
    state.fullPage = 1;
    applyFullFilter();
  });

  byId("fullPagePrev")?.addEventListener("click", () => {
    state.fullPage = Math.max(1, state.fullPage - 1);
    applyFullFilter();
  });

  byId("fullPageNext")?.addEventListener("click", () => {
    state.fullPage += 1;
    applyFullFilter();
  });

  byId("fullPageLast")?.addEventListener("click", () => {
    const filtered = getFilteredRecords();
    const pageSize = state.fullPageSize === "all" ? Infinity : Number(state.fullPageSize) || 25;
    state.fullPage = pageSize === Infinity ? 1 : Math.max(1, Math.ceil(filtered.length / pageSize));
    applyFullFilter();
  });

  byId("scrollLeftBtn")?.addEventListener("click", () => {
    byId("fullViewTableWrap")?.scrollBy({ left: -360, behavior: "smooth" });
  });

  byId("scrollRightBtn")?.addEventListener("click", () => {
    byId("fullViewTableWrap")?.scrollBy({ left: 360, behavior: "smooth" });
  });

  document.addEventListener("click", (event) => {
    if (!event.target?.closest?.(".full-view-export")) setExportMenuOpen(false);
    if (!event.target?.closest?.(".full-columns-control")) setColumnMenuOpen(false);
  });

  document.addEventListener("keydown", (event) => {
    if (byId("datasetFullView")?.getAttribute("aria-hidden") !== "false") return;
    const targetTag = event.target?.tagName?.toLowerCase();
    const isTyping = targetTag === "input" || targetTag === "select" || targetTag === "textarea";

    // Escape handling
    if (event.key === "Escape") {
      if (!byId("fullExportOptions")?.hidden) {
        setExportMenuOpen(false);
        return;
      }
      if (!byId("fullColumnOptions")?.hidden) {
        setColumnMenuOpen(false);
        return;
      }
      if (state.fullCardExpanded) {
        state.fullCardExpanded = false;
        syncExpandButton();
        showToast("Dataset collapsed");
        return;
      }
      closeFullDataset();
      return;
    }

    // Ctrl+C / Cmd+C for Excel copy
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c" && !isTyping) {
      if (state.fullSelected.size > 0) {
        const items = selectedItems();
        if (items.length) {
          event.preventDefault();
          void copyText(buildTsv(items), `Copied ${items.length} selected rows as TSV.`);
          return;
        }
      } else if (state.fullActiveCell.value) {
        event.preventDefault();
        void copyText(state.fullActiveCell.value, `Copied cell ${state.fullActiveCell.coord} (${state.fullActiveCell.value})`);
        return;
      }
    }

    // Ctrl+A / Cmd+A for Excel select all on page
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a" && !isTyping) {
      event.preventDefault();
      byId("fullSelectAllBtn")?.click();
      return;
    }

    // Arrow keys & Tab & Enter for Excel grid navigation
    if (!isTyping && state.fullActiveCell.row !== null) {
      if (event.key === "ArrowUp") {
        event.preventDefault();
        navigateActiveCell(-1, 0);
      } else if (event.key === "ArrowDown" || (event.key === "Enter" && !event.shiftKey)) {
        event.preventDefault();
        navigateActiveCell(1, 0);
      } else if (event.key === "Enter" && event.shiftKey) {
        event.preventDefault();
        navigateActiveCell(-1, 0);
      } else if (event.key === "ArrowLeft" || (event.key === "Tab" && event.shiftKey)) {
        event.preventDefault();
        navigateActiveCell(0, -1);
      } else if (event.key === "ArrowRight" || (event.key === "Tab" && !event.shiftKey)) {
        event.preventDefault();
        navigateActiveCell(0, 1);
      }
    }
  });

  syncFormatButtons();
  updateSelectionStatus();
}
