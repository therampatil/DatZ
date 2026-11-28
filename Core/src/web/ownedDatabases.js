// "Your Databases" — a per-browser ledger of datasets the user has requested
// access to. Payment is simulated for testing, and orders carry no user id, so
// this ledger is the honest per-browser link to those pending orders. Records
// are never invented: each entry comes from a real checkout response.

import { state } from "./state.js";
import { byId, setText, formatNumber, setOpen, showToast } from "./dom.js";
import { openFullDataset } from "./fullDataset.js";
import { openVisualization } from "./visualization.js";

const ACCESS_KEY = "datz_access_records";
const MAX_RECORDS = 50;

function loadRecords() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(ACCESS_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.filter((item) => item && item.datasetSlug) : [];
  } catch {
    return [];
  }
}

function persist(records) {
  try {
    window.localStorage.setItem(ACCESS_KEY, JSON.stringify(records.slice(0, MAX_RECORDS)));
  } catch {
    showToast("Access records could not be saved in this browser.");
  }
}

export function getAccessRecords() {
  return loadRecords();
}

export function saveAccessRecord(record) {
  if (!record || !record.datasetSlug) return;
  const records = loadRecords();
  const duplicateIndex = records.findIndex((item) =>
    (record.orderId && record.orderId !== "—" && item.orderId === record.orderId)
    || (item.datasetSlug === record.datasetSlug && item.email === record.email));

  const entry = { ...record, savedAt: new Date().toISOString() };
  if (duplicateIndex >= 0) records[duplicateIndex] = entry;
  else records.unshift(entry);
  persist(records);
}

function setNavActive(name) {
  document.querySelectorAll(".nav-link").forEach((link) => {
    const active = name === "databases"
      ? link.id === "navDatabasesLink"
      : name === "profile"
        ? link.id === "navProfileLink"
        : link.dataset.section === "marketplace";
    link.classList.toggle("active", active);
  });
}

function closeProfilePanel() {
  setOpen("profileDrawer", false);
  setNavActive("marketplace");
}

export function closeOwnedDatabases() {
  setOpen("ownedDatabasesView", false);
  setNavActive("marketplace");
}

export function openOwnedDatabases() {
  setOpen("profileDrawer", false);
  setOpen("datasetFullView", false);
  setOpen("visualizationView", false);
  state.ownedPage = 1;
  setNavActive("databases");
  setOpen("ownedDatabasesView", true);
  renderOwnedDatabases();
  renderOwnedTable();
}

function openRecord(entry, visualize) {
  if (!entry) return;
  const datasetIndex = state.datasets.findIndex((dataset) => dataset.slug === entry.datasetSlug);
  if (datasetIndex < 0) {
    showToast("This dataset is no longer available in the catalog.");
    return;
  }
  state.activeDatasetIndex = datasetIndex;
  setOpen("ownedDatabasesView", false);
  closeProfilePanel();
  if (visualize) void openVisualization(datasetIndex);
  else void openFullDataset(datasetIndex);
}

export function renderOwnedDatabases() {
  const container = byId("ownedDatabases");
  if (!container) return;

  const records = getAccessRecords();
  setText("ownedCount", `${records.length} ${records.length === 1 ? "database" : "databases"}`, "0 databases");
  container.replaceChildren();

  if (!records.length) {
    const empty = document.createElement("div");
    empty.className = "owned-empty";
    const title = document.createElement("strong");
    title.textContent = "No databases yet";
    const message = document.createElement("p");
    message.textContent = "Get access to a dataset and it will appear here with its order details.";
    const action = document.createElement("button");
    action.className = "secondary-button";
    action.type = "button";
    action.textContent = "Browse datasets";
    action.addEventListener("click", () => {
      closeProfilePanel();
      byId("marketplace")?.scrollIntoView({ behavior: "smooth" });
    });
    empty.append(title, message, action);
    container.append(empty);
    return;
  }

  records.forEach((entry) => {
    const card = document.createElement("article");
    card.className = "purchased-card owned-card";

    const heading = document.createElement("div");
    heading.className = "owned-card-head";
    const name = document.createElement("strong");
    name.textContent = entry.datasetTitle || entry.datasetSlug;
    const status = document.createElement("span");
    status.className = "owned-status";
    status.textContent = entry.paymentRequired === false ? "Fulfilled" : "Access · unpaid order";
    heading.append(name, status);

    const meta = document.createElement("div");
    meta.className = "owned-meta";
    const details = [
      ["Order", entry.orderId || "—"],
      ["Format", String(entry.format || "csv").toUpperCase()],
      ["Records", entry.recordCount ? formatNumber(entry.recordCount) : "—"],
      ["Email", entry.email || "—"],
    ];
    for (const [label, value] of details) {
      const row = document.createElement("div");
      const key = document.createElement("span");
      key.textContent = label;
      const val = document.createElement("b");
      val.textContent = value;
      row.append(key, val);
      meta.append(row);
    }

    const actions = document.createElement("div");
    actions.className = "owned-actions";
    const openBtn = document.createElement("button");
    openBtn.className = "secondary-button";
    openBtn.type = "button";
    openBtn.dataset.ownedAction = "open";
    openBtn.dataset.ownedSlug = entry.datasetSlug;
    openBtn.textContent = "Open dataset";
    const vizBtn = document.createElement("button");
    vizBtn.className = "primary-button small";
    vizBtn.type = "button";
    vizBtn.dataset.ownedAction = "visualize";
    vizBtn.dataset.ownedSlug = entry.datasetSlug;
    vizBtn.textContent = "Visualize";
    actions.append(openBtn, vizBtn);

    card.append(heading, meta, actions);
    container.append(card);
  });
}

function statusOf(entry) {
  return entry.paymentRequired === false ? "fulfilled" : "pending";
}

function requestedAt(entry) {
  const time = Date.parse(entry.savedAt || "");
  return Number.isFinite(time) ? time : 0;
}

function getOwnedRecords() {
  const query = (state.ownedQuery || "").toLowerCase().trim();
  const status = state.ownedStatus || "all";
  const records = getAccessRecords().filter((entry) => {
    if (status !== "all" && statusOf(entry) !== status) return false;
    if (!query) return true;
    return Object.values(entry || {}).join(" ").toLowerCase().includes(query);
  });

  const sorted = [...records];
  switch (state.ownedSort) {
    case "oldest":
      sorted.sort((a, b) => requestedAt(a) - requestedAt(b));
      break;
    case "dataset":
      sorted.sort((a, b) => String(a.datasetTitle || a.datasetSlug).localeCompare(String(b.datasetTitle || b.datasetSlug)));
      break;
    case "format":
      sorted.sort((a, b) => String(a.format || "").localeCompare(String(b.format || "")));
      break;
    case "records":
      sorted.sort((a, b) => Number(b.recordCount || 0) - Number(a.recordCount || 0));
      break;
    default:
      sorted.sort((a, b) => requestedAt(b) - requestedAt(a));
  }
  return sorted;
}

function formatRequested(entry) {
  const time = Date.parse(entry.savedAt || "");
  if (!Number.isFinite(time)) return "—";
  return new Date(time).toLocaleString("en-IN", {
    year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function actionButton(label, action, entry, primary) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = primary ? "primary-button small" : "secondary-button owned-table-btn";
  button.textContent = label;
  button.dataset.ownedAction = action;
  button.dataset.ownedSlug = entry.datasetSlug;
  return button;
}

export function renderOwnedTable() {
  const tbody = byId("ownedRows");
  if (!tbody) return;

  const filtered = getOwnedRecords();
  const pageSize = state.ownedPageSize === "all" ? Infinity : Number(state.ownedPageSize) || 10;
  const totalPages = pageSize === Infinity ? 1 : Math.max(1, Math.ceil(filtered.length / pageSize));
  if (state.ownedPage > totalPages) state.ownedPage = totalPages;
  if (state.ownedPage < 1) state.ownedPage = 1;

  const start = pageSize === Infinity ? 0 : (state.ownedPage - 1) * pageSize;
  const page = pageSize === Infinity ? filtered : filtered.slice(start, start + pageSize);
  tbody.replaceChildren();

  if (!page.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 9;
    cell.className = "owned-empty-row";
    cell.textContent = getAccessRecords().length
      ? "No databases match this search and filter."
      : "No databases yet. Request access to a dataset to see it here.";
    row.append(cell);
    tbody.append(row);
  } else {
    page.forEach((entry, offset) => {
      const row = document.createElement("tr");
      const cells = [
        String(start + offset + 1),
        entry.datasetTitle || entry.datasetSlug,
        entry.orderId || "—",
        String(entry.format || "csv").toUpperCase(),
        entry.recordCount ? formatNumber(entry.recordCount) : "—",
        formatRequested(entry),
        entry.email || "—",
      ];
      cells.forEach((value) => {
        const cell = document.createElement("td");
        cell.textContent = value;
        row.append(cell);
      });

      const statusCell = document.createElement("td");
      const pill = document.createElement("span");
      pill.className = `owned-status ${statusOf(entry) === "fulfilled" ? "fulfilled" : ""}`;
      pill.textContent = statusOf(entry) === "fulfilled" ? "Fulfilled" : "Pending · unpaid";
      statusCell.append(pill);

      const actionCell = document.createElement("td");
      actionCell.className = "owned-actions-cell";
      actionCell.append(
        actionButton("Open", "open", entry, false),
        actionButton("Visualize", "visualize", entry, true)
      );
      row.append(statusCell, actionCell);
      tbody.append(row);
    });
  }

  const from = filtered.length ? start + 1 : 0;
  const to = pageSize === Infinity ? filtered.length : Math.min(start + pageSize, filtered.length);
  const allCount = getAccessRecords().length;
  setText(
    "ownedViewStatus",
    `Showing ${from}–${to} of ${filtered.length} databases${allCount > filtered.length ? ` (filtered from ${allCount})` : ""}`,
    "Showing 0 of 0 databases"
  );
  setText("ownedPaginationInfo", `Showing ${from}–${to} of ${filtered.length} databases`, "Showing 0 of 0 databases");
  setText("ownedPageCurrent", `Page ${state.ownedPage} of ${totalPages}`);
  const first = byId("ownedPageFirst");
  const prev = byId("ownedPagePrev");
  const next = byId("ownedPageNext");
  const last = byId("ownedPageLast");
  if (first) first.disabled = state.ownedPage <= 1;
  if (prev) prev.disabled = state.ownedPage <= 1;
  if (next) next.disabled = state.ownedPage >= totalPages;
  if (last) last.disabled = state.ownedPage >= totalPages;
}

function csvCell(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function exportOwnedCsv() {
  const records = getOwnedRecords();
  if (!records.length) {
    showToast("There are no databases to export.");
    return;
  }
  const lines = [["Database", "Slug", "Order ID", "Format", "Records", "Requested", "Email", "Status"].map(csvCell).join(",")];
  for (const entry of records) {
    lines.push([
      entry.datasetTitle || entry.datasetSlug,
      entry.datasetSlug,
      entry.orderId || "—",
      String(entry.format || "csv").toUpperCase(),
      entry.recordCount || 0,
      formatRequested(entry),
      entry.email || "—",
      statusOf(entry) === "fulfilled" ? "Fulfilled" : "Pending unpaid",
    ].map(csvCell).join(","));
  }
  try {
    const blob = new Blob(["\ufeff", lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "your-databases.csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showToast(`Exported ${records.length} database ${records.length === 1 ? "record" : "records"} as CSV.`);
  } catch (error) {
    showToast(`Export failed: ${error?.message || "please try again."}`);
  }
}

function handleOwnedAction(event) {
  const button = event.target?.closest?.("[data-owned-action]");
  if (!button) return;
  const entry = getAccessRecords().find((item) => item.datasetSlug === button.dataset.ownedSlug);
  openRecord(entry, button.dataset.ownedAction === "visualize");
}

export function bindOwnedDatabases() {
  byId("viewYourDatabasesBtn")?.addEventListener("click", openOwnedDatabases);
  byId("openOwnedFullBtn")?.addEventListener("click", openOwnedDatabases);
  byId("navDatabasesLink")?.addEventListener("click", openOwnedDatabases);
  byId("navYourDatabases")?.addEventListener("click", openOwnedDatabases);
  byId("closeOwnedView")?.addEventListener("click", closeOwnedDatabases);
  byId("ownedBackdrop")?.addEventListener("click", closeOwnedDatabases);

  byId("ownedSearch")?.addEventListener("input", (event) => {
    state.ownedQuery = event.target.value;
    state.ownedPage = 1;
    renderOwnedTable();
  });
  byId("ownedStatusFilter")?.addEventListener("change", (event) => {
    state.ownedStatus = event.target.value;
    state.ownedPage = 1;
    renderOwnedTable();
  });
  byId("ownedSort")?.addEventListener("change", (event) => {
    state.ownedSort = event.target.value;
    state.ownedPage = 1;
    renderOwnedTable();
  });
  byId("ownedPageSize")?.addEventListener("change", (event) => {
    state.ownedPageSize = event.target.value;
    state.ownedPage = 1;
    renderOwnedTable();
  });

  byId("ownedPageFirst")?.addEventListener("click", () => {
    state.ownedPage = 1;
    renderOwnedTable();
  });
  byId("ownedPagePrev")?.addEventListener("click", () => {
    state.ownedPage = Math.max(1, state.ownedPage - 1);
    renderOwnedTable();
  });
  byId("ownedPageNext")?.addEventListener("click", () => {
    state.ownedPage += 1;
    renderOwnedTable();
  });
  byId("ownedPageLast")?.addEventListener("click", () => {
    const filtered = getOwnedRecords();
    const size = state.ownedPageSize === "all" ? Infinity : Number(state.ownedPageSize) || 10;
    state.ownedPage = size === Infinity ? 1 : Math.max(1, Math.ceil(filtered.length / size));
    renderOwnedTable();
  });

  byId("ownedRefresh")?.addEventListener("click", () => {
    renderOwnedDatabases();
    renderOwnedTable();
    showToast("Your Databases refreshed from this browser.");
  });
  byId("ownedExportCsv")?.addEventListener("click", exportOwnedCsv);

  byId("ownedRows")?.addEventListener("click", handleOwnedAction);
  byId("ownedDatabases")?.addEventListener("click", handleOwnedAction);

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (byId("ownedDatabasesView")?.getAttribute("aria-hidden") !== "false") return;
    closeOwnedDatabases();
  });
}
