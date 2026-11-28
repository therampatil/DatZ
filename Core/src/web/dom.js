// Shared DOM helpers for the browser client.
// SECURITY: every value derived from an API response that is interpolated into
// an innerHTML template must go through escapeHtml() first. Scalars should be
// written with textContent (see setText) whenever possible.

export const UNKNOWN = "—";

/** Escape the five HTML-significant characters before any innerHTML use. */
export function escapeHtml(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function byId(id) {
  return document.getElementById(id);
}

/** Write a scalar with textContent (no HTML parsing, therefore no injection). */
export function setText(id, value, fallback = UNKNOWN) {
  const el = byId(id);
  if (!el) return;
  const safe = value === null || value === undefined || value === "" ? fallback : value;
  el.textContent = String(safe);
}

export function formatNumber(value, fallback = UNKNOWN) {
  if (value === null || value === undefined || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString("en-IN") : fallback;
}

export function formatCurrency(value, fallback = UNKNOWN) {
  if (value === null || value === undefined || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? `₹${n.toLocaleString("en-IN")}` : String(value);
}

/** Only allow plain hex colours from API metrics into inline CSS. */
export function safeColor(value, fallback = "#7f8797") {
  return typeof value === "string" && /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(value)
    ? value
    : fallback;
}

/** Clamp API-provided percentages into a safe 0–100 range. */
export function safePercent(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : fallback;
}

let toastTimer = 0;
export function showToast(message) {
  const toast = byId("toast");
  if (!toast) return;
  const label = toast.querySelector("span");
  if (label) label.textContent = String(message ?? "");
  toast.classList.add("open");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("open"), 3500);
}

export function setOpen(id, open) {
  const el = byId(id);
  if (!el) return;
  el.classList.toggle("open", open);
  el.setAttribute("aria-hidden", open ? "false" : "true");
}

/**
 * Build the empty/loading state without innerHTML. Inline styles mirror the
 * original design so the visual treatment stays identical.
 */
export function createEmptyState({ icon = "🔍", title = "", message = "", actionLabel = "", actionId = "" } = {}) {
  const wrap = document.createElement("div");
  wrap.setAttribute(
    "style",
    "grid-column: 1/-1; padding: 48px 24px; text-align: center; border: 1px dashed #2f3747; border-radius: 8px; background: #0e1219;"
  );

  if (icon) {
    const iconEl = document.createElement("span");
    iconEl.setAttribute("style", "font-size: 24px; display: block; margin-bottom: 8px;");
    iconEl.textContent = icon;
    wrap.appendChild(iconEl);
  }

  if (title) {
    const strong = document.createElement("strong");
    strong.setAttribute("style", "color: #fff; font-size: 14px;");
    strong.textContent = title;
    wrap.appendChild(strong);
  }

  if (message) {
    const p = document.createElement("p");
    p.setAttribute("style", "color: #858d9d; font-size: 11px; margin: 6px 0 16px;");
    p.textContent = message;
    wrap.appendChild(p);
  }

  if (actionLabel && actionId) {
    const button = document.createElement("button");
    button.className = "secondary-button";
    button.id = actionId;
    button.setAttribute("style", "height: 32px; font-size: 11px;");
    button.textContent = actionLabel;
    wrap.appendChild(button);
  }

  return wrap;
}

/** Replace a table body with a single honest message row (no innerHTML). */
export function renderTableMessage(message, { tableId = "previewTable", tbodyId = "previewRows" } = {}) {
  const tbody = byId(tbodyId);
  if (!tbody) return;
  // The header is generated from the field schema, so span the current columns.
  const columnCount = byId(tableId)?.querySelectorAll("thead tr:last-child th").length || 1;
  const tr = document.createElement("tr");
  const td = document.createElement("td");
  td.colSpan = columnCount;
  td.setAttribute("style", "text-align:center; padding: 32px; color: #7f8999; font-size:11px;");
  td.textContent = message;
  tr.appendChild(td);
  tbody.replaceChildren(tr);
}
