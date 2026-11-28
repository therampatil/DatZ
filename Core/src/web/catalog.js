// Dataset catalog: card rendering, filtering and filter chips.

import { state } from "./state.js";
import { byId, setText, formatNumber, escapeHtml, createEmptyState } from "./dom.js";

export function renderCards(items, message = "No datasets match the selected filters") {
  const grid = byId("datasetGrid");
  if (!grid) return;

  if (!items || items.length === 0) {
    const empty = createEmptyState({
      title: message,
      message: "Try clearing the filters or refining your search.",
      actionLabel: "Reset filters",
      actionId: "resetEmptyFiltersBtn",
    });
    grid.replaceChildren(empty);
    setText("datasetCount", "0 datasets", "0 datasets");
    byId("resetEmptyFiltersBtn")?.addEventListener("click", () => byId("clearFilters")?.click());
    return;
  }

  grid.innerHTML = items
    .map((dataset) => {
      const index = state.datasets.indexOf(dataset);
      const selected = state.datasets[state.activeDatasetIndex]?.slug === dataset.slug ? " selected" : "";
      return `
    <article class="dataset-card${escapeHtml(selected)}" data-slug="${escapeHtml(dataset.slug)}" data-index="${escapeHtml(index)}">
      <div class="card-top">
        <div class="source-icon">${escapeHtml(dataset.code)}</div>
        <div class="card-status"><span>Updated ${escapeHtml(dataset.updatedTag)} • ${escapeHtml(dataset.addedTag)}</span></div>
      </div>
      <h3>${escapeHtml(dataset.title)}</h3>
      <p>${escapeHtml(dataset.description)}</p>
      <div class="card-metrics">
        <div><span>Total rows</span><strong>${escapeHtml(formatNumber(dataset.recordCount))}</strong></div>
        <div><span>Attributes</span><strong>${escapeHtml(formatNumber(dataset.fieldsCount))} fields</strong></div>
        <div><span>Coverage</span><strong>${escapeHtml(dataset.coverage)}</strong></div>
      </div>
      <div class="card-actions">
        <div class="card-buttons">
          <button class="details">Details</button>
          <button class="get-access">Get access</button>
        </div>
      </div>
    </article>`;
    })
    .join("");

  setText("datasetCount", datasetCountLabel(items.length), datasetCountLabel(items.length));
}

function datasetCountLabel(count) {
  return `${count} ${count === 1 ? "dataset" : "datasets"}`;
}

export function applyFilters() {
  const selectedCategory = document.querySelector('input[name="category"]:checked')?.value || "all";
  const subFilters = byId("realEstateSubFilters");
  const active = byId("activeFilters");

  const selectedCity = document.querySelector('input[name="city"]:checked')?.value || "all";
  const puneMarketsGroup = byId("puneMicroMarketsGroup");
  if (puneMarketsGroup) {
    puneMarketsGroup.style.display = (selectedCity === "pune" || selectedCity === "all") ? "block" : "none";
  }

  const selectedLocations = [...document.querySelectorAll('input[name="location"]:checked')].map((x) => x.value);
  const selectedPropTypes = [...document.querySelectorAll('input[name="property_type"]:checked')].map((x) => x.value);
  const selectedFreq = document.querySelector('input[name="frequency"]:checked')?.value || "";

  const term = (byId("searchInput")?.value || "").toLowerCase().trim();
  const filtered = state.datasets.filter((dataset) => {
    const hay = `${dataset.title} ${dataset.category} ${dataset.geography} ${dataset.description} ${(dataset.sources || []).join(" ")}`.toLowerCase();
    if (term && !hay.includes(term)) return false;

    if (selectedCategory !== "all") {
      const catTarget = selectedCategory.toLowerCase();
      const catDataset = (dataset.category || "").toLowerCase();
      const titleDataset = (dataset.title || "").toLowerCase();
      const matchCat = catDataset.includes(catTarget) || catTarget.includes(catDataset) || titleDataset.includes(catTarget);
      if (!matchCat) return false;
    }

    if (selectedCity === "pune") {
      const isPune = hay.includes("pune") || dataset.slug.includes("pune") || dataset.slug === "rera-commercial-projects" || dataset.slug === "retail-commercial-feed";
      if (!isPune) return false;
    } else if (selectedCity === "mumbai") {
      const isMumbai = hay.includes("mumbai") || dataset.slug.includes("mumbai") || dataset.slug === "retail-commercial-feed";
      if (!isMumbai) return false;
    } else if (selectedCity === "bengaluru") {
      if (!hay.includes("bengaluru") && !dataset.slug.includes("bengaluru")) return false;
    } else if (selectedCity === "hyderabad") {
      if (!hay.includes("hyderabad") && !dataset.slug.includes("hyderabad")) return false;
    } else if (selectedCity === "ncr") {
      if (!hay.includes("ncr") && !hay.includes("noida") && !hay.includes("gurugram") && !dataset.slug.includes("ncr")) return false;
    }

    if (selectedLocations.length > 0) {
      const matchesLoc = selectedLocations.some((loc) => {
        const l = loc.toLowerCase();
        return hay.includes(l) || ((dataset.attributes || []).some((a) => a.toLowerCase().includes(l))) || hay.includes("pune");
      });
      if (!matchesLoc) return false;
    }

    if (selectedPropTypes.length > 0) {
      const matchesType = selectedPropTypes.some((t) => dataset.category.toLowerCase().includes(t.toLowerCase()));
      if (!matchesType) return false;
    }

    if (selectedFreq && dataset.frequency !== selectedFreq) return false;

    return true;
  });

  renderCards(filtered);

  if (active) {
    const chips = [];
    if (selectedCategory !== "all") {
      chips.push(`<button class="filter-chip" data-type="category" data-val="${escapeHtml(selectedCategory)}">Category: ${escapeHtml(selectedCategory)}<span>×</span></button>`);
    }
    if (selectedCity !== "all") {
      chips.push(`<button class="filter-chip" data-type="city" data-val="${escapeHtml(selectedCity)}">City: ${escapeHtml(selectedCity.toUpperCase())}<span>×</span></button>`);
    }
    selectedLocations.forEach((loc) => {
      chips.push(`<button class="filter-chip" data-type="location" data-val="${escapeHtml(loc)}">Locality: ${escapeHtml(loc)}<span>×</span></button>`);
    });
    selectedPropTypes.forEach((t) => {
      chips.push(`<button class="filter-chip" data-type="property_type" data-val="${escapeHtml(t)}">${escapeHtml(t)}<span>×</span></button>`);
    });
    if (selectedFreq) {
      chips.push(`<button class="filter-chip" data-type="frequency" data-val="${escapeHtml(selectedFreq)}">${escapeHtml(selectedFreq)}<span>×</span></button>`);
    }
    active.innerHTML = chips.join("");
  }
}

export function clearFilters() {
  const allCat = document.querySelector('input[name="category"][value="all"]');
  if (allCat) allCat.checked = true;

  const puneCity = document.querySelector('input[name="city"][value="all"]');
  if (puneCity) puneCity.checked = true;

  document.querySelectorAll('input[name="location"]').forEach((i) => (i.checked = false));
  document.querySelectorAll('input[name="property_type"]').forEach((i) => (i.checked = false));

  const allFreq = document.querySelector('input[name="frequency"][value=""]');
  if (allFreq) allFreq.checked = true;

  const search = byId("searchInput");
  if (search) search.value = "";
  applyFilters();
}

export function bindFilters() {
  byId("searchInput")?.addEventListener("input", applyFilters);
  document.querySelectorAll(".filters input").forEach((input) => input.addEventListener("change", applyFilters));

  byId("clearFilters")?.addEventListener("click", clearFilters);

  byId("activeFilters")?.addEventListener("click", (event) => {
    const chip = event.target.closest(".filter-chip");
    if (!chip) return;
    const type = chip.dataset.type;
    const val = chip.dataset.val;

    if (type === "category") {
      const allCat = document.querySelector('input[name="category"][value="all"]');
      if (allCat) allCat.checked = true;
    } else if (type === "cat-reset") {
      const catCheck = byId("categoryRealEstate");
      if (catCheck) catCheck.checked = true;
    } else if (type === "city") {
      const allCity = document.querySelector('input[name="city"][value="all"]');
      if (allCity) allCity.checked = true;
    } else if (type === "location") {
      const locInput = document.querySelector(`input[name="location"][value="${val}"]`);
      if (locInput) locInput.checked = false;
    } else if (type === "property_type") {
      const typeInput = document.querySelector(`input[name="property_type"][value="${val}"]`);
      if (typeInput) typeInput.checked = false;
    } else if (type === "frequency") {
      const allFreq = document.querySelector('input[name="frequency"][value=""]');
      if (allFreq) allFreq.checked = true;
    }
    applyFilters();
  });
}
