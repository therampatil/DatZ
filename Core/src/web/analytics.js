// Pure, dependency-free analytics for the visualization page.
// Every value is derived from records returned by the API — nothing is invented.

const DASH = "—";

function label(value) {
  if (value === null || value === undefined) return "Unknown";
  const text = String(value).trim();
  return !text || text === DASH ? "Unknown" : text;
}

/**
 * Parses the display strings produced by the API into a finite number.
 * Handles ₹ lakhs/crores, grouped thousands, percentages, durations and negatives.
 */
export function parseNumeric(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (value === null || value === undefined) return 0;
  const raw = String(value).trim();
  if (!raw || raw === DASH) return 0;

  const negative = /^[-−]/.test(raw) || /^\(.*\)$/.test(raw);
  const stripped = raw.replace(/[()]/g, "").replace(/[^0-9.]/g, "");
  const number = parseFloat(stripped);
  if (!Number.isFinite(number)) return 0;

  let amount = number;
  if (/cr(?:ore)?/i.test(raw)) amount *= 10000000;
  else if (/\bl(?:ac|akh)?\b/i.test(raw)) amount *= 100000;
  return negative ? -amount : amount;
}

export function formatPriceINR(value) {
  if (!Number.isFinite(value) || value === 0) return DASH;
  const sign = value < 0 ? "-" : "";
  const amount = Math.abs(value);
  if (amount >= 10000000) return `${sign}₹${(amount / 10000000).toFixed(2)} Cr`;
  if (amount >= 100000) return `${sign}₹${(amount / 100000).toFixed(2)} L`;
  return `${sign}₹${Math.round(amount).toLocaleString("en-IN")}`;
}

export function formatRateINR(value) {
  if (!Number.isFinite(value) || value <= 0) return DASH;
  return `₹${Math.round(value).toLocaleString("en-IN")}`;
}

function increment(map, key) {
  map.set(key, (map.get(key) || 0) + 1);
}

function medianOf(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function bucketsFor(values, bucketCount) {
  if (!values.length) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const step = Math.max(1, (max - min) / bucketCount);
  const buckets = Array.from({ length: bucketCount }, (_, index) => ({
    start: min + index * step,
    end: min + (index + 1) * step,
    count: 0,
  }));
  for (const value of values) {
    const index = Math.min(bucketCount - 1, Math.floor((value - min) / step));
    buckets[index].count += 1;
  }
  return buckets;
}

function topCounts(map, limit) {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key, count]) => ({ label: key, count }));
}

function toSlices(entries, total, extraLabel = "Other") {
  if (!total || !entries.length) return [];
  const slices = entries.map((entry) => ({
    label: entry.label,
    count: entry.count,
    percent: Math.round((entry.count / total) * 100),
  }));
  const covered = entries.reduce((sum, entry) => sum + entry.count, 0);
  if (covered < total) {
    slices.push({
      label: extraLabel,
      count: total - covered,
      percent: Math.round(((total - covered) / total) * 100),
    });
  }
  return slices;
}

/**
 * Builds every chart dataset from the full record array.
 * Returned percentages are based on the number of records with usable values,
 * and each chart reports its own denominator through `basedOn`.
 */
export function computeAnalytics(records) {
  const list = Array.isArray(records) ? records : [];
  const prices = [];
  const rates = [];
  const marketDays = [];
  const changes = [];
  const locality = new Map();
  const status = new Map();
  const rera = new Map();
  const stage = new Map();
  const builder = new Map();
  const source = new Map();
  const scatter = [];

  for (const record of list) {
    const price = parseNumeric(record?.asking_price ?? record?.asking_price_inr);
    const rate = parseNumeric(record?.price_per_sqft ?? record?.price_per_sqft_inr);
    const days = parseNumeric(record?.days_on_market);
    const change = parseNumeric(record?.price_change_percent);

    if (price > 0) prices.push(price);
    if (rate > 0) rates.push(rate);
    if (days > 0) marketDays.push(days);
    if (change !== 0) changes.push(change);

    increment(locality, label(record?.locality || record?.city));
    increment(status, label(record?.status));

    const reraId = label(record?.rera_id);
    const reraStatus = label(record?.rera_status).toLowerCase();
    const isRegistered = (reraId !== "Unknown" && !/^(na|no|not available)$/i.test(reraId))
      || /regist|approved|sanction/i.test(reraStatus);
    increment(rera, isRegistered ? "RERA registered" : "Not registered");

    increment(stage, label(record?.construction_stage));
    increment(builder, label(record?.builder_name || record?.builder));
    increment(source, label(record?.listing_source));

    if (price > 0 && rate > 0) {
      scatter.push({
        x: price,
        y: rate,
        label: label(record?.project_name || record?.property_id),
      });
    }
  }

  const activeCount = list.filter((record) => {
    const value = label(record?.status).toLowerCase();
    return value === "unknown" || /act|avail|live|on sale|forsale|for sale/.test(value);
  }).length;

  const reraRegistered = rera.get("RERA registered") || 0;

  const priceMovement = new Map();
  const increased = changes.filter((value) => value > 0).length;
  const reduced = changes.filter((value) => value < 0).length;
  if (increased) priceMovement.set("Price increased", increased);
  if (reduced) priceMovement.set("Price reduced", reduced);
  const unchanged = list.length - increased - reduced;
  if (unchanged) priceMovement.set("No recorded change", unchanged);

  const totalInventoryValue = prices.reduce((acc, p) => acc + p, 0);

  return {
    total: list.length,
    pricedCount: prices.length,
    totalInventoryValue,
    minPrice: prices.length ? Math.min(...prices) : 0,
    maxPrice: prices.length ? Math.max(...prices) : 0,
    medianPrice: medianOf(prices),
    avgRate: rates.length ? Math.round(rates.reduce((a, b) => a + b, 0) / rates.length) : 0,
    minRate: rates.length ? Math.min(...rates) : 0,
    maxRate: rates.length ? Math.max(...rates) : 0,
    reraPercent: list.length ? Math.round((reraRegistered / list.length) * 100) : 0,
    activeCount,
    priceBuckets: bucketsFor(prices, 7),
    marketDayBuckets: bucketsFor(marketDays, 6),
    localitySlices: toSlices(topCounts(locality, 5), list.length),
    statusSlices: toSlices(topCounts(status, 4), list.length),
    reraSlices: toSlices(topCounts(rera, 2), list.length, "Unspecified"),
    stageSlices: toSlices(topCounts(stage, 4), list.length),
    sourceSlices: toSlices(topCounts(source, 4), list.length),
    priceMovementSlices: toSlices(topCounts(priceMovement, 3), list.length),
    topBuilders: topCounts(builder, 6),
    scatter,
  };
}
