// Checkout & custom requests.
// Checkout only records an order: payment is simulated for testing and no
// payment is collected. Once recorded, the full in-app dataset view opens.
// All order data is displayed verbatim from the API.

import { state, currentDataset, markSelectedCard } from "./state.js";
import { byId, setText, formatNumber, formatCurrency, setOpen, showToast } from "./dom.js";
import { getSessionToken, createCheckout, submitCustomRequest } from "./api.js";
import { openFullDataset } from "./fullDataset.js";
import { saveAccessRecord } from "./ownedDatabases.js";
import { authState, startGoogleAuth } from "./auth.js";

const FORMATS = new Set(["csv", "xlsx", "parquet"]);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PENDING_MESSAGE = "Payment integration pending; this order is not fulfilled.";
const PENDING_ACCESS_KEY = "datz_pending_access_index";

function resetPanels() {
  const standard = byId("checkoutStandard");
  const status = byId("checkoutOrderStatus");
  const custom = byId("checkoutCustom");
  const planOptions = document.querySelector(".plan-options");

  if (standard) standard.hidden = false;
  if (status) status.hidden = true;
  if (custom) custom.hidden = true;
  if (planOptions) planOptions.style.display = "grid";
  document.querySelectorAll(".plan-card").forEach((card) => {
    card.classList.toggle("active", card.dataset.plan === "snapshot");
  });
}

export function closeCheckout() {
  setOpen("checkoutModal", false);
  resetPanels();
}

export function openCheckout(index = state.activeDatasetIndex) {
  const dataset = state.datasets[index];
  if (!dataset) {
    showToast("Select a dataset before starting checkout.");
    return;
  }

  state.activeDatasetIndex = index;
  markSelectedCard(index);

  // Browsing is public; access is not. Preserve the intended dataset so the
  // person returns to this exact access step after completing Google sign-in.
  if (!authState.user) {
    try { window.localStorage.setItem(PENDING_ACCESS_KEY, String(index)); } catch { /* best effort */ }
    showToast("Sign in to continue to dataset access.");
    startGoogleAuth();
    return;
  }

  setText("checkoutTitle", dataset.title);
  setText("checkoutRecords", formatNumber(dataset.recordCount));
  setText("authDatasetName", dataset.title);
  setText("orderId", "—");
  setText("orderStatus", "—");
  setText("orderAmount", "—");
  setText("orderPaymentRequired", "—");
  setText("orderStatusMessage", "—");

  resetPanels();
  // The checkout modal is global (z-index above every drawer). Close the
  // originating drawer so it can never intercept clicks or sit on top.
  setOpen("datasetDrawer", false);
  setOpen("detailsDrawer", false);
  setOpen("datasetFullView", false);
  setOpen("checkoutModal", true);
}

function displayOrderStatus(order, dataset) {
  setText("authDatasetName", dataset.title);
  setText("orderId", order?.orderId ?? "—");
  setText("orderStatus", order?.status ?? "—");
  setText("orderAmount", formatCurrency(order?.amount));

  if (order?.paymentRequired === true) {
    setText("orderPaymentRequired", "Yes — payment has not been collected");
  } else if (order?.paymentRequired === false) {
    setText("orderPaymentRequired", "No");
  } else {
    setText("orderPaymentRequired", "—");
  }

  setText("orderStatusMessage", order?.message || PENDING_MESSAGE, PENDING_MESSAGE);
}

async function handleCheckout() {
  const dataset = currentDataset();
  if (!dataset) {
    showToast("Select a dataset before starting checkout.");
    return;
  }

  const emailInput = byId("checkoutEmail");
  const email = emailInput?.value.trim() || "";
  if (!EMAIL_RE.test(email)) {
    showToast("Enter a valid work email to continue.");
    emailInput?.focus();
    return;
  }

  const button = byId("completePurchase");
  if (button) button.disabled = true;
  showToast("Creating checkout session…");

  try {
    const token = await getSessionToken();
    const result = await createCheckout(
      {
        datasetSlug: dataset.slug,
        customerEmail: email,
        planType: "snapshot",
        format: FORMATS.has(state.checkoutFormat) ? state.checkoutFormat : "csv",
      },
      token
    );
    const order = result && typeof result === "object" ? result : {};
    const format = FORMATS.has(state.checkoutFormat) ? state.checkoutFormat : "csv";

    saveAccessRecord({
      datasetSlug: dataset.slug,
      datasetTitle: dataset.title,
      recordCount: dataset.recordCount,
      format,
      email,
      orderId: order.orderId || "—",
      status: order.status || "pending",
      paymentRequired: order.paymentRequired !== false,
    });

    displayOrderStatus(order, dataset);
    // Temporary beta behaviour: retain the complete access journey while a
    // payment provider is being integrated. This must be removed when payment
    // fulfillment becomes available.
    closeCheckout();
    await openFullDataset(state.activeDatasetIndex);
    showToast("Test access granted — full dataset loaded.");
  } catch (error) {
    showToast(`Checkout failed: ${error?.message || "Please try again."}`);
  } finally {
    if (button) button.disabled = false;
  }
}

async function handleCustomRequest() {
  const email = byId("customEmail")?.value.trim() || "";
  const locations = byId("customLocations")?.value.trim() || "";
  const sources = byId("customSources")?.value.trim() || "";
  const attributes = byId("customAttributes")?.value.trim() || "";

  if (!EMAIL_RE.test(email) || !locations) {
    showToast("Please provide a valid work email and target locations");
    return;
  }

  const button = byId("submitCustom");
  if (button) button.disabled = true;
  showToast("Submitting scraper inquiry…");

  try {
    await submitCustomRequest({
      customerEmail: email,
      targetLocations: locations,
      targetSources: sources || "Not specified",
      requiredAttributes: attributes || "Not specified",
    });
    showToast("Custom scraper request submitted. Our team will contact you.");
    window.setTimeout(closeCheckout, 1500);
  } catch (error) {
    showToast(`Request failed: ${error?.message || "Please try again."}`);
  } finally {
    if (button) button.disabled = false;
  }
}

export function bindCheckout() {
  byId("closeCheckout")?.addEventListener("click", closeCheckout);
  byId("checkoutModal")?.addEventListener("click", (event) => {
    if (event.target === event.currentTarget) closeCheckout();
  });

  document.querySelectorAll(".plan-card").forEach((plan) => {
    plan.addEventListener("click", () => {
      document.querySelectorAll(".plan-card").forEach((card) => card.classList.remove("active"));
      plan.classList.add("active");
      const custom = plan.dataset.plan === "custom";
      if (byId("checkoutStandard")) byId("checkoutStandard").hidden = custom;
      if (byId("checkoutCustom")) byId("checkoutCustom").hidden = !custom;
      if (byId("checkoutOrderStatus")) byId("checkoutOrderStatus").hidden = true;
      const planOptions = document.querySelector(".plan-options");
      if (planOptions) planOptions.style.display = "grid";
    });
  });

  byId("completePurchase")?.addEventListener("click", handleCheckout);
  byId("submitCustom")?.addEventListener("click", handleCustomRequest);

  byId("openFullDatasetBtn")?.addEventListener("click", () => {
    const index = state.activeDatasetIndex;
    closeCheckout();
    openFullDataset(index);
  });

  window.addEventListener("datz:auth-ready", () => {
    let index = null;
    try {
      const raw = window.localStorage.getItem(PENDING_ACCESS_KEY);
      window.localStorage.removeItem(PENDING_ACCESS_KEY);
      index = raw === null ? null : Number(raw);
    } catch { /* ignore unavailable storage */ }
    if (Number.isInteger(index) && state.datasets[index]) openCheckout(index);
  });
}
