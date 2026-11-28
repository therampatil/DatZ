// DatZ Digger Client Logic

let currentView = "scraper";
let tasks = [];
let databases = [];

// Initialize
document.addEventListener("DOMContentLoaded", () => {
  loadStats();
  loadTasks();
  loadDatabases();

  document.getElementById("newScrapeForm").addEventListener("submit", handleCreateTask);
  document.getElementById("editDatasetForm").addEventListener("submit", handleSaveDatasetEdit);
});

// View Switcher: "scraper" | "databases"
window.switchView = function (view) {
  currentView = view;
  const tabScraper = document.getElementById("tabScraper");
  const tabDatabases = document.getElementById("tabDatabases");
  const viewScraper = document.getElementById("viewScraper");
  const viewDatabases = document.getElementById("viewDatabases");

  if (view === "scraper") {
    tabScraper.classList.add("active");
    tabDatabases.classList.remove("active");
    viewScraper.classList.add("active");
    viewDatabases.classList.remove("active");
    loadTasks();
  } else {
    tabDatabases.classList.add("active");
    tabScraper.classList.remove("active");
    viewDatabases.classList.add("active");
    viewScraper.classList.remove("active");
    loadDatabases();
  }
};

// Telemetry Stats
async function loadStats() {
  try {
    const res = await fetch("/api/stats");
    const { data } = await res.json();
    document.getElementById("telemetryRecords").textContent = Number(data.totalProperties).toLocaleString();
    if (data.geminiConfigured) {
      document.getElementById("telemetryEngine").textContent = "Gemini Flash AI";
    }
  } catch {
    // ignore
  }
}

// ================= PAGE 1: WEB SCRAPING =================

async function loadTasks() {
  const tbody = document.getElementById("tasksTableBody");
  try {
    const res = await fetch("/api/tasks");
    const { data } = await res.json();
    tasks = data || [];
    renderTasks();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-state" style="color:var(--red)">Error loading tasks: ${err.message}</td></tr>`;
  }
}

function renderTasks() {
  const tbody = document.getElementById("tasksTableBody");
  if (tasks.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-state">No scraping tasks configured yet. Enter a task name above to begin!</td></tr>`;
    return;
  }

  tbody.innerHTML = tasks
    .map((task) => {
      const isRunning = task.last_status === "running";
      const statusClass = `status-${task.last_status || "idle"}`;

      return `
        <tr>
          <td><strong style="color:#fff">${escapeHtml(task.name)}</strong></td>
          <td><span style="color:var(--muted)">${escapeHtml(task.category)}</span></td>
          <td><span style="color:var(--lime); font-family:var(--mono); font-size:10px">SquareYards · 99acres · Housing</span></td>
          <td><span style="text-transform:capitalize; font-family:var(--mono); font-size:10px">${escapeHtml(task.frequency || "manual")}</span></td>
          <td><span class="status-pill-small ${statusClass}">${isRunning ? "⏳ Scraping..." : (task.last_status || "idle").toUpperCase()}</span></td>
          <td><strong style="color:#fff; font-family:var(--mono)">${Number(task.extracted_count || 0).toLocaleString()}</strong></td>
          <td style="text-align: right;">
            <div style="display:inline-flex; gap:6px;">
              <button class="primary-button small" onclick="runTask('${task.id}')" ${isRunning ? "disabled" : ""}>
                ${isRunning ? "Running..." : "Run ↗"}
              </button>
              <button class="btn-danger-core" onclick="deleteTask('${task.id}')" title="Delete Task">
                ✕
              </button>
            </div>
          </td>
        </tr>
      `;
    })
    .join("");
}

async function handleCreateTask(e) {
  e.preventDefault();
  const name = document.getElementById("taskName").value.trim();
  const category = document.getElementById("taskCategory").value;
  const frequency = document.getElementById("taskFrequency").value;

  const btn = document.getElementById("saveTaskBtn");
  btn.disabled = true;
  btn.textContent = "Saving...";

  try {
    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, category, frequency }),
    });

    if (!res.ok) throw new Error("Could not save task");

    document.getElementById("newScrapeForm").reset();
    await loadTasks();
  } catch (err) {
    alert("Error: " + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Save Task";
  }
}

window.runTask = async function (id) {
  showScrapingToast("Scraping Multi-Portals...", "Streaming listings across SquareYards, 99acres and housing portals...");
  try {
    const res = await fetch(`/api/tasks/${id}/run`, { method: "POST" });
    const { data } = await res.json();
    showScrapingToast("Scrape Complete! 🎉", `Extracted and upserted ${data.extractedCount} listings to Supabase.`, 4000);
    await loadTasks();
    await loadDatabases();
    await loadStats();
  } catch (err) {
    showScrapingToast("Scrape Failed", err.message, 4000);
  }
};

window.triggerInstantScrape = async function () {
  const name = document.getElementById("taskName").value.trim() || "Live Scrape";
  const category = document.getElementById("taskCategory").value;

  showScrapingToast(`Scraping "${category}"...`, "Scanning property websites automatically...");

  try {
    const res = await fetch("/api/scrape/instant", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, category }),
    });
    const { data } = await res.json();
    showScrapingToast("Scrape Complete! 🎉", `Saved ${data.extractedCount} new records to Supabase.`, 4000);
    await loadTasks();
    await loadDatabases();
    await loadStats();
  } catch (err) {
    showScrapingToast("Scrape Failed", err.message, 4000);
  }
};

window.deleteTask = async function (id) {
  if (!confirm("Are you sure you want to delete this scraping task?")) return;
  try {
    await fetch(`/api/tasks/${id}`, { method: "DELETE" });
    await loadTasks();
  } catch (err) {
    alert("Delete failed: " + err.message);
  }
};

// ================= PAGE 2: DATABASES CREATED =================

async function loadDatabases() {
  const tbody = document.getElementById("databasesTableBody");
  try {
    const res = await fetch("/api/datasets");
    const { data } = await res.json();
    databases = data || [];
    renderDatabases();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-state" style="color:var(--red)">Error loading databases: ${err.message}</td></tr>`;
  }
}

function renderDatabases() {
  const tbody = document.getElementById("databasesTableBody");
  const countBadge = document.getElementById("databaseCount");
  countBadge.textContent = `${databases.length} Dataset${databases.length === 1 ? "" : "s"}`;

  if (databases.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-state">No databases created yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = databases
    .map((db) => {
      const updated = db.updated_at ? new Date(db.updated_at).toLocaleDateString() : "Live";
      return `
        <tr>
          <td>
            <div style="font-weight:700; color:#fff; font-size:12px">${escapeHtml(db.title)}</div>
            <div style="font-size:9px; color:var(--muted); font-family:var(--mono)">ID: ${escapeHtml(db.id)}</div>
          </td>
          <td><span style="color:var(--muted)">${escapeHtml(db.category)}</span></td>
          <td><strong style="color:var(--lime); font-family:var(--mono)">${Number(db.record_count || 0).toLocaleString()}</strong> rows</td>
          <td><span style="color:var(--muted); font-family:var(--mono); font-size:10px">${escapeHtml(db.frequency || "Real-Time")}</span></td>
          <td><span style="color:var(--muted); font-family:var(--mono); font-size:10px">${updated}</span></td>
          <td style="text-align: right;">
            <button class="secondary-button small" onclick="openEditModal('${db.id}', '${escapeJs(db.title)}', '${escapeJs(db.category)}', '${escapeJs(db.frequency || "Real-Time")}')">
              Edit <span>✎</span>
            </button>
          </td>
        </tr>
      `;
    })
    .join("");
}

window.openEditModal = function (id, title, category, frequency) {
  document.getElementById("editDatasetId").value = id;
  document.getElementById("editDatasetTitle").value = title;
  document.getElementById("editDatasetCategory").value = category;
  document.getElementById("editDatasetFrequency").value = frequency;
  document.getElementById("editModal").classList.remove("hidden");
};

window.closeEditModal = function () {
  document.getElementById("editModal").classList.add("hidden");
};

async function handleSaveDatasetEdit(e) {
  e.preventDefault();
  const id = document.getElementById("editDatasetId").value;
  const title = document.getElementById("editDatasetTitle").value.trim();
  const category = document.getElementById("editDatasetCategory").value.trim();
  const frequency = document.getElementById("editDatasetFrequency").value.trim();

  const btn = document.getElementById("saveEditBtn");
  btn.disabled = true;
  btn.textContent = "Saving...";

  try {
    const res = await fetch(`/api/datasets/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, category, frequency }),
    });

    if (!res.ok) throw new Error("Could not update database");

    closeEditModal();
    await loadDatabases();
  } catch (err) {
    alert("Error updating database: " + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Save Changes";
  }
}

function showScrapingToast(title, sub, hideAfterMs) {
  const notice = document.getElementById("scrapingNotice");
  const titleEl = document.getElementById("noticeTitle");
  const subEl = document.getElementById("noticeSub");

  titleEl.textContent = title;
  subEl.textContent = sub;
  notice.classList.remove("hidden");

  if (hideAfterMs) {
    setTimeout(() => {
      notice.classList.add("hidden");
    }, hideAfterMs);
  }
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str).replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
}

function escapeJs(str) {
  if (!str) return "";
  return String(str).replace(/'/g, "\\'");
}
