// Browser data adapter backed by Supabase. No service-role credentials are used.

import { HIDDEN_KEYS } from "./preview.js";
import { requireSupabase } from "./supabaseClient.js";

const PAGE_SIZE = 1000;
const PROPERTY_COLUMNS = [
  "external_id", "project_name", "builder_name", "city", "locality", "location", "pin_code",
  "asking_price", "price_per_sqft", "previous_asking_price", "price_change_amount",
  "price_change_percent", "listing_source", "source_url", "rera_status", "rera_id", "status",
  "construction_stage", "possession_date", "listing_timestamp", "scraped_at", "updated_at",
  "listed_by", "days_on_market", "latitude", "longitude",
].join(",");

export class ApiError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

function text(value, fallback = "") {
  return value === null || value === undefined ? fallback : String(value);
}

function textArray(value) {
  return Array.isArray(value) ? value.map((item) => text(item)).filter(Boolean) : [];
}

function assertResult(error, fallback) {
  if (error) throw new ApiError(error.message || fallback);
}

function normalizeDataset(raw) {
  const relation = raw?.properties;
  const relatedCount = Array.isArray(relation) ? relation[0]?.count : relation?.count;
  const canonicalCount = raw?.record_count ?? null;
  const recordCount = (relatedCount !== undefined && relatedCount !== null && relatedCount > 0)
    ? relatedCount
    : (canonicalCount ?? (relatedCount === 0 ? 0 : null));
  return {
    id: text(raw?.id),
    slug: text(raw?.slug),
    code: text(raw?.code, "—"),
    title: text(raw?.title, "Untitled dataset"),
    description: text(raw?.description, "No description available."),
    category: text(raw?.category),
    geography: text(raw?.geography),
    frequency: text(raw?.frequency),
    coverage: text(raw?.coverage, "—"),
    recordCount,
    fieldsCount: raw?.fields_count ?? null,
    snapshotPrice: Number(raw?.snapshot_price || 0),
    monthlyPrice: Number(raw?.monthly_price || 0),
    addedTag: text(raw?.added_tag) || "—",
    updatedTag: text(raw?.updated_tag) || "—",
    attributes: textArray(raw?.attributes),
    useCases: textArray(raw?.use_cases),
    sources: textArray(raw?.sources),
  };
}

const DASH = "—";

function number(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function display(value) {
  return value === null || value === undefined || value === "" ? DASH : String(value);
}

function displayPrice(value) {
  const parsed = number(value);
  if (parsed === null) return DASH;
  if (parsed >= 10_000_000) return `₹${(parsed / 10_000_000).toFixed(2)} Cr`;
  if (parsed >= 100_000) return `₹${(parsed / 100_000).toFixed(1)} L`;
  return `₹${parsed.toLocaleString("en-IN")}`;
}

function displayRate(value) {
  const parsed = number(value);
  return parsed === null ? DASH : `₹${parsed.toLocaleString("en-IN")}`;
}

function formatDate(value) {
  if (!value) return DASH;
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? DASH
    : date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function normalizeRecord(raw, index = 0) {
  const record = {
    property_id: display(raw?.external_id),
    project_name: display(raw?.project_name),
    project_location: `${display(raw?.project_name)} / ${display(raw?.locality ?? raw?.city)}`,
    builder: display(raw?.builder_name),
    asking_price: displayPrice(raw?.asking_price),
    price_per_sqft: displayRate(raw?.price_per_sqft),
    previous_asking_price: displayPrice(raw?.previous_asking_price),
    price_change_amount: displayPrice(raw?.price_change_amount),
    rera_status: display(raw?.rera_status),
    status: display(raw?.status),
    listing_date: formatDate(raw?.listing_timestamp),
    days_on_market: number(raw?.days_on_market) === null ? DASH : `${number(raw.days_on_market)}d`,
    city: display(raw?.city),
    locality: display(raw?.locality),
    pin_code: display(raw?.pin_code),
    row_index: index + 1,
    rera_id: display(raw?.rera_id),
    builder_name: display(raw?.builder_name),
    asking_price_inr: displayPrice(raw?.asking_price),
    price_per_sqft_inr: displayRate(raw?.price_per_sqft),
    previous_asking_price_inr: displayPrice(raw?.previous_asking_price),
    price_change_amount_inr: displayPrice(raw?.price_change_amount),
    price_change_percent: number(raw?.price_change_percent) === null ? DASH : `${number(raw.price_change_percent)}%`,
    construction_stage: display(raw?.construction_stage),
    possession_date: display(raw?.possession_date),
    listed_by: display(raw?.listed_by),
    listing_source: display(raw?.listing_source),
    source_url: display(raw?.source_url),
    latitude: number(raw?.latitude),
    longitude: number(raw?.longitude),
  };
  for (const key of HIDDEN_KEYS) delete record[key];
  return record;
}

async function datasetBySlug(slug) {
  const client = requireSupabase();
  const { data, error } = await client
    .from("datasets")
    .select("*")
    .eq("slug", slug)
    .eq("is_published", true)
    .single();
  assertResult(error, "Could not load the dataset.");
  return data;
}

async function fetchPropertyRows(datasetId, limit) {
  const client = requireSupabase();
  const rows = [];
  let offset = 0;
  while (limit === undefined || rows.length < limit) {
    const pageSize = limit === undefined ? PAGE_SIZE : Math.min(PAGE_SIZE, limit - rows.length);
    const { data, error } = await client
      .from("properties")
      .select(PROPERTY_COLUMNS)
      .eq("dataset_id", datasetId)
      .order("listing_timestamp", { ascending: false })
      .range(offset, offset + pageSize - 1);
    assertResult(error, "Could not load property records.");
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < pageSize) break;
    offset += data.length;
  }
  return rows;
}

function metricsFor(dataset, rows) {
  const prices = rows.map((row) => number(row.asking_price)).filter((value) => value > 0);
  const statusCounts = rows.reduce((counts, row) => {
    const label = display(row.status);
    counts[label] = (counts[label] || 0) + 1;
    return counts;
  }, {});
  const entries = Object.entries(statusCounts).slice(0, 3);
  let bars = new Array(7).fill(0);
  let priceBrackets = [];
  if (prices.length >= 2) {
    const { min, max } = prices.reduce(
      (bounds, price) => ({ min: Math.min(bounds.min, price), max: Math.max(bounds.max, price) }),
      { min: prices[0], max: prices[0] }
    );
    const bucketSize = (max - min) / 7 || 1;
    const buckets = new Array(7).fill(0);
    prices.forEach((price) => buckets[Math.min(6, Math.floor((price - min) / bucketSize))]++);
    const largest = Math.max(1, ...buckets);
    bars = buckets.map((count) => Math.max(25, Math.round((count / largest) * 92)));
    priceBrackets = [displayPrice(min), displayPrice(min + (max - min) / 2), displayPrice(max)];
  }
  return {
    title: dataset.geography || dataset.title,
    totalRecords: rows.length,
    bars,
    priceBrackets,
    statusTitle: "Listing status",
    legend: entries.map(([label]) => label),
    values: entries.map(([, count]) => `${Math.round((count / Math.max(1, rows.length)) * 100)}%`),
    colors: ["#62a3ff", "#c9ff35", "#7f8797"],
  };
}

export async function fetchDatasets() {
  const client = requireSupabase();
  let result = await client
    .from("datasets")
    .select("*, properties(count)")
    .eq("is_published", true)
    .order("created_at", { ascending: true });
  if (result.error) {
    result = await client.from("datasets").select("*").eq("is_published", true).order("created_at");
  }
  assertResult(result.error, "Could not load datasets.");
  return (result.data || []).map(normalizeDataset).filter((dataset) => dataset.slug);
}

export async function fetchPreview(slug) {
  const rawDataset = await datasetBySlug(slug);
  const dataset = normalizeDataset(rawDataset);
  const rows = await fetchPropertyRows(rawDataset.id, 50);
  return {
    records: rows.map(normalizeRecord),
    metrics: metricsFor(dataset, rows),
  };
}

export async function fetchDatasetRecords(slug, token) {
  const dataset = await datasetBySlug(slug);
  const rows = await fetchPropertyRows(dataset.id);
  return { records: rows.map(normalizeRecord), total: rows.length };
}

export async function fetchTelemetry() {
  const client = requireSupabase();
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  const { data, error } = await client
    .from("properties")
    .select("city, locality, scraped_at")
    .gte("scraped_at", since.toISOString())
    .order("scraped_at", { ascending: false })
    .limit(1000);
  assertResult(error, "Could not load telemetry.");
  const rows = data || [];
  const newest = rows[0]?.scraped_at ? Date.parse(rows[0].scraped_at) : NaN;
  return {
    propertiesUpdatedToday: rows.length,
    activeRegions: new Set(rows.map((row) => row.locality || row.city).filter(Boolean)).size,
    lastScrapeSecondsAgo: Number.isFinite(newest) ? Math.max(0, (Date.now() - newest) / 1000) : null,
    pipelineUptime: null,
  };
}

export async function getSessionToken() {
  const client = requireSupabase();
  const { data, error } = await client.auth.getSession();
  assertResult(error, "Could not read the Supabase session.");
  if (!data?.session?.access_token) throw new ApiError("Sign in to continue.", 401);
  return data.session.access_token;
}

export async function createCheckout(payload, token) {
  if (!token) throw new ApiError("Sign in to continue.", 401);
  const client = requireSupabase();
  const { data: userData, error: userError } = await client.auth.getUser(token);
  assertResult(userError, "Could not verify your session.");
  const dataset = await datasetBySlug(payload.datasetSlug);
  const { data, error } = await client
    .from("download_orders")
    .insert({
      dataset_id: dataset.id,
      user_id: userData.user.id,
      customer_email: payload.customerEmail,
      format: payload.format || "csv",
      amount_paid: 0,
      payment_provider: "pending",
      status: "pending",
      payment_status: "unpaid",
    })
    .select("id,status,amount_paid,payment_status")
    .single();
  assertResult(error, "Could not create the access request.");
  return {
    orderId: data.id,
    status: data.status,
    amount: Number(data.amount_paid || 0),
    paymentRequired: data.payment_status !== "paid",
    message: "Access request recorded. Payment integration is pending.",
  };
}

export async function submitCustomRequest(payload) {
  const client = requireSupabase();
  const { error } = await client.from("custom_scraper_requests").insert({
    customer_email: payload.customerEmail,
    target_locations: payload.targetLocations,
    target_sources: payload.targetSources,
    required_attributes: payload.requiredAttributes,
  });
  assertResult(error, "Could not submit the request.");
  return { success: true };
}

function csvBlob(records) {
  const keys = [...new Set(records.flatMap((record) => Object.keys(record)))];
  const escape = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const csv = [keys.map(escape).join(","), ...records.map((record) => keys.map((key) => escape(record[key])).join(","))]
    .join("\r\n");
  return new Blob([csv], { type: "text/csv;charset=utf-8" });
}

export async function downloadSample({ datasetSlug, format }) {
  if (format !== "csv") {
    throw new ApiError("Browser exports currently support CSV. XLSX and Parquet require a server-side export function.");
  }
  const dataset = await datasetBySlug(datasetSlug);
  const rows = await fetchPropertyRows(dataset.id, 50);
  return csvBlob(rows.map(normalizeRecord));
}

export async function downloadFullExport({ datasetSlug, format }, token) {
  if (!token) throw new ApiError("Sign in to export the full dataset.", 401);
  if (format !== "csv") {
    throw new ApiError("Browser exports currently support CSV. XLSX and Parquet require a server-side export function.");
  }
  const { records } = await fetchDatasetRecords(datasetSlug, token);
  return csvBlob(records);
}
