// Browser entry point. Wires the modules together and loads the live catalog.

import { fetchDatasets } from "./api.js";
import { state } from "./state.js";
import { byId, setText, showToast, createEmptyState, formatNumber } from "./dom.js";
import { renderCards, applyFilters, bindFilters } from "./catalog.js";
import { openDetails, bindDetails } from "./details.js";
import { openDrawer, bindPreview } from "./preview.js";
import { openCheckout, bindCheckout } from "./checkout.js";
import { openFullDataset, bindFullDataset } from "./fullDataset.js";
import { bindVisualization } from "./visualization.js";
import { bindOwnedDatabases, renderOwnedDatabases } from "./ownedDatabases.js";
import { startTelemetry } from "./telemetry.js";
import { initAuth, bindAuthControls } from "./auth.js";
import { initLanding } from "./landing.js";

function bindGlobalControls() {
  byId("exploreButton")?.addEventListener("click", () => {
    byId("marketplace")?.scrollIntoView({ behavior: "smooth" });
  });

  byId("downloadButton")?.addEventListener("click", () => {
    showToast("Preview a dataset to request a sample export");
  });

  const focusSearch = () => {
    byId("marketplace")?.scrollIntoView({ behavior: "smooth" });
    window.setTimeout(() => byId("searchInput")?.focus(), 400);
  };

  byId("headerSearch")?.addEventListener("click", focusSearch);
  byId("headerSearch")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      focusSearch();
    }
  });

  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      focusSearch();
    }
  });

  byId("navMarketplace")?.addEventListener("click", () => {
    byId("navMarketplace")?.classList.add("active");
    byId("navYourDatabases")?.classList.remove("active");
    byId("marketplace")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  document.querySelectorAll(".nav-link").forEach((link) => {
    link.addEventListener("click", () => {
      document.querySelectorAll(".nav-link").forEach((item) => item.classList.remove("active"));
      link.classList.add("active");
      if (link.dataset.section) {
        byId(link.dataset.section)?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  });

  byId("datasetGrid")?.addEventListener("click", (event) => {
    const card = event.target.closest(".dataset-card");
    if (!card) return;
    const index = Number(card.dataset.index);
    if (!Number.isInteger(index) || !state.datasets[index]) return;

    if (event.target.closest(".details")) openDetails(index);
    else if (event.target.closest(".get-access")) openFullDataset(index);
  });
}

async function loadDatasets() {
  const grid = byId("datasetGrid");
  if (grid) {
    grid.replaceChildren(
      createEmptyState({ icon: "⏳", title: "Loading datasets…", message: "Fetching the live catalog from the API." })
    );
  }

  try {
    const datasets = await fetchDatasets();
    state.datasets = datasets;
    state.activeDatasetIndex = 0;

    const countLabel = `${datasets.length} ${datasets.length === 1 ? "dataset" : "datasets"}`;
    setText("welcomeDatasetCount", countLabel, "—");
    setText("filterDatasetCount", countLabel, "—");
    setText("profileDatasetCount", `${datasets.length} live`, "—");

    const featured = datasets[0];
    setText("heroDatasetName", featured?.title, "—");
    setText("heroDatasetDescription", featured?.description, "—");
    setText("heroDatasetRecords", featured ? formatNumber(featured.recordCount) : "—", "—");
    setText(
      "heroDatasetFields",
      featured && featured.fieldsCount !== null && featured.fieldsCount !== undefined
        ? formatNumber(featured.fieldsCount)
        : "—",
      "—"
    );

    if (!datasets.length) {
      renderCards([], "No datasets are available right now.");
      return;
    }
    applyFilters();
  } catch (error) {
    state.datasets = [];
    renderCards([], "Datasets are unavailable right now. Please try again later.");
    setText("welcomeDatasetCount", "—");
    setText("filterDatasetCount", "—");
    setText("profileDatasetCount", "—");
    setText("heroDatasetName", "—");
    setText("heroDatasetDescription", "—");
    setText("heroDatasetRecords", "—");
    setText("heroDatasetFields", "—");
    showToast(`Unable to load datasets: ${error?.message || "server error"}`);
  }
}

bindFilters();
bindDetails();
bindPreview();
bindCheckout();
bindFullDataset();
bindVisualization();
bindOwnedDatabases();
renderOwnedDatabases();
bindGlobalControls();
bindAuthControls();
startTelemetry();
loadDatasets();
initAuth();
initLanding();
