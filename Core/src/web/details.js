// Dataset details drawer. All list values are written with textContent.

import { state, markSelectedCard } from "./state.js";
import { byId, setText, formatNumber, setOpen, showToast } from "./dom.js";

function renderTagList(id, values) {
  const container = byId(id);
  if (!container) return;
  if (!values.length) {
    const empty = document.createElement("span");
    empty.textContent = "Not available";
    container.replaceChildren(empty);
    return;
  }
  container.replaceChildren(
    ...values.map((value) => {
      const span = document.createElement("span");
      const icon = document.createElement("i");
      span.append(icon, document.createTextNode(value));
      return span;
    })
  );
}

function renderUseCases(id, values) {
  const container = byId(id);
  if (!container) return;
  if (!values.length) {
    const empty = document.createElement("span");
    empty.textContent = "Not available";
    container.replaceChildren(empty);
    return;
  }
  container.replaceChildren(
    ...values.map((value) => {
      const article = document.createElement("article");
      const icon = document.createElement("i");
      icon.textContent = "✓";
      const label = document.createElement("span");
      label.textContent = value;
      article.append(icon, label);
      return article;
    })
  );
}

export function closeDetails() {
  setOpen("detailsDrawer", false);
}

export function openDetails(index = 0) {
  const dataset = state.datasets[index];
  if (!dataset) {
    showToast("Dataset details are unavailable.");
    return;
  }

  state.activeDatasetIndex = index;
  markSelectedCard(index);

  setText("detailsTitle", dataset.title);
  setText("detailsCode", dataset.code);
  setText("detailsDescription", dataset.description);
  setText("detailsRecords", formatNumber(dataset.recordCount));
  setText("detailsFields", `${formatNumber(dataset.fieldsCount)} fields`);
  setText("detailsCoverage", dataset.coverage);
  setText("detailsFrequency", dataset.frequency);
  setText("detailsFreshness", `Updated ${dataset.updatedTag}`);

  renderTagList("detailsAttributes", dataset.attributes);
  renderUseCases("detailsUseCases", dataset.useCases);
  renderTagList("detailsSources", dataset.sources);

  setOpen("detailsDrawer", true);
}

export function bindDetails() {
  byId("detailsBackdrop")?.addEventListener("click", closeDetails);
  byId("closeDetails")?.addEventListener("click", closeDetails);
}
