// Small in-memory application state shared by the browser modules.

export const state = {
  datasets: [],
  activeDatasetIndex: 0,
  previewRecords: [],
  activeTableMarket: "all",
  selectedFormat: "csv",
  checkoutFormat: "csv",
  fullRecords: [],
  fullRecordsSlug: null,
  fullExportFormat: "csv",
  fullPage: 1,
  fullPageSize: 25,
  fullActiveMarket: "all",
  // Spreadsheet-style controls for the full dataset table.
  fullSort: { key: null, dir: "asc" },
  fullHiddenKeys: new Set(),
  fullColumnFilters: {},
  fullSelected: new Set(),
  fullPageIndices: new Set(),
  fullFilterRowOpen: false,
  fullActiveCell: { row: null, col: null, key: null, value: "", coord: "—" },
  fullDensity: "standard",
  fullFreezePanes: true,
  fullCardExpanded: false,
  vizActiveCategory: "all",
  // Dedicated "Your Databases" page controls.
  ownedQuery: "",
  ownedStatus: "all",
  ownedSort: "newest",
  ownedPage: 1,
  ownedPageSize: 10,
};

export function currentDataset() {
  return state.datasets[state.activeDatasetIndex] || null;
}

export function markSelectedCard(index) {
  document.querySelectorAll(".dataset-card").forEach((card) => {
    card.classList.toggle("selected", Number(card.dataset.index) === index);
  });
}
