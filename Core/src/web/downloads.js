// Public sample export only. Authenticated full-dataset exports live in api.js
// and are triggered from the full dataset view.

import { downloadSample } from "./api.js";
import { showToast } from "./dom.js";

const FORMATS = new Set(["csv", "xlsx", "parquet"]);

export async function requestSampleExport(datasetSlug, format, resultEl) {
  const safeFormat = FORMATS.has(format) ? format : "csv";
  const setResult = (message) => {
    if (resultEl) resultEl.textContent = message;
  };

  if (!datasetSlug) {
    showToast("Select a dataset before requesting a sample export.");
    return;
  }

  setResult("Preparing sample export (23-column schema, up to 50 rows)…");

  try {
    const blob = await downloadSample({ datasetSlug, format: safeFormat });
    const safeSlug = String(datasetSlug).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `sample-${safeSlug}.${safeFormat}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);

    setResult("Downloaded: 23-column schema, up to 50 rows. Get access to explore every record in-app.");
    showToast("Sample export (23 columns, up to 50 rows) downloaded.");
  } catch (error) {
    const message = error?.message || "Sample export failed.";
    setResult(`Sample export failed: ${message}`);
    showToast(`Sample export failed: ${message}`);
  }
}
