import {
  DatasetModel,
  DatasetRecordFilters,
  PropertyDataRow,
  PropertyRecord,
  VisualDatasetMetrics,
} from "../types/dataset.js";
import { supabase, isSupabaseConfigured } from "../db/supabase.js";

const SUPABASE_PAGE_SIZE = 1000;

// Kept as a widened string so supabase-js' literal type parser does not try to
// parse the embedded count syntax at compile time.
const DATASET_SELECT_WITH_COUNT: string = "*, properties(count)";

const PROPERTY_COLUMNS = [
  "external_id",
  "project_name",
  "builder_name",
  "city",
  "locality",
  "location",
  "pin_code",
  "carpet_area_sqft",
  "built_up_area_sqft",
  "super_built_up_area_sqft",
  "configuration",
  "property_type",
  "property_sub_type",
  "floor_number",
  "total_floors",
  "facing",
  "parking_count",
  "furnishing_status",
  "asking_price",
  "price_per_sqft",
  "previous_asking_price",
  "price_change_amount",
  "price_change_percent",
  "listing_source",
  "source_url",
  "rera_status",
  "rera_id",
  "status",
  "construction_stage",
  "possession_date",
  "listing_timestamp",
  "scraped_at",
  "updated_at",
  "listed_by",
  "days_on_market",
  "latitude",
  "longitude",
  "raw_payload",
].join(", ");

/**
 * Catalog metadata only. record_count is always 0 here: only real property rows
 * in Supabase may produce a count, and the migration trigger keeps the cached
 * column in sync. Promotional estimates are never used as fallbacks.
 */
export const DEFAULT_DATASETS: DatasetModel[] = [
  {
    id: "d1010000-0000-0000-0000-000000000001",
    slug: "pune-real-estate-data",
    code: "PR",
    title: "Pune Real Estate Data",
    description:
      "Verified Pune residential property listings from public RERA filings and configured listing sources.",
    category: "Residential Real Estate",
    geography: "Pune",
    fields_count: 23,
    coverage: "Pune, Maharashtra",
    snapshot_price: 8500,
    monthly_price: 24000,
    frequency: "Real-Time",
    record_count: 0,
    added_tag: "",
    updated_tag: "",
    attributes: [
      "Property ID",
      "RERA ID",
      "Project Name",
      "Builder / Promoter",
      "Locality",
      "City",
      "Pin Code",
      "Asking Price (INR)",
      "Rate / Sq Ft (INR)",
      "Previous Asking Price (INR)",
      "Price Change Amount (INR)",
      "Price Change (%)",
      "RERA Status",
      "Construction Stage",
      "Possession / Completion Date",
      "Market Status",
      "DOM (Days on Market)",
      "Listed By",
      "Listing Source",
      "Source URL",
      "Latitude",
      "Longitude",
    ],
    use_cases: [
      "Analyse Pune residential asking prices and rates per sq ft",
      "Track listing price changes and days on market",
      "Compare configurations, floors, facing and furnishing across localities",
    ],
    sources: ["Public RERA filings", "Configured property listing sources"],
    is_published: true,
    created_at: new Date(Date.now() - 30 * 86400000).toISOString(),
    updated_at: new Date().toISOString(),
  },
];

function formatPriceINR(amount: number): string {
  if (amount >= 10000000) return `₹${(amount / 10000000).toFixed(2)} Cr`;
  if (amount >= 100000) return `₹${(amount / 100000).toFixed(1)} L`;
  return `₹${Number(amount).toLocaleString("en-IN")}`;
}

function formatListingDate(isoString: string | null | undefined): string {
  if (!isoString) return "—";
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return "—";
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value);
  return text.length > 0 ? text : null;
}

function toIsoText(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

const DASH = "—";

function displayText(value: unknown): string {
  return toText(value) ?? DASH;
}

function displayIso(value: unknown): string {
  return toIsoText(value) ?? DASH;
}

function displayNumber(value: unknown): string {
  const parsed = toNumber(value);
  return parsed === null ? DASH : String(parsed);
}

function displayPrice(value: unknown): string {
  const parsed = toNumber(value);
  return parsed === null ? DASH : formatPriceINR(parsed);
}

function displayRate(value: unknown): string {
  const parsed = toNumber(value);
  return parsed === null ? DASH : `₹${parsed.toLocaleString("en-IN")}`;
}

function displayPercent(value: unknown): string {
  const parsed = toNumber(value);
  return parsed === null ? DASH : `${parsed}%`;
}

/**
 * PostgREST uses commas and parentheses as filter syntax. Strip them from
 * user-supplied search terms so a search cannot alter the query expression.
 */
function sanitizeSearchTerm(term: string): string {
  return term.replace(/[,()\\"]/g, " ").trim();
}

/** Date-only inputs get explicit day boundaries so `to` includes the whole day. */
function normalizeDateInput(value: string | undefined, boundary: "start" | "end"): string | null {
  if (!value) return null;
  let raw = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    raw = `${raw}T${boundary === "start" ? "00:00:00.000" : "23:59:59.999"}Z`;
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/** Supabase can return the related count as an embedded `properties(count)` resource. */
function normalizeDatasetRow(row: Record<string, unknown>): DatasetModel {
  const relation = row.properties as Array<{ count: number }> | { count: number } | undefined;
  const embeddedCount = Array.isArray(relation) ? relation[0]?.count : relation?.count;
  return {
    ...(row as unknown as DatasetModel),
    record_count: toNumber(embeddedCount) ?? toNumber(row.record_count) ?? 0,
  };
}

/**
 * Preview records keep the legacy display keys used by the web UI and also
 * expose every export-schema field so previews reflect the full 23-column row.
 * The declined area/configuration and raw timestamp columns are not emitted;
 * `listing_date` is derived from `listing_timestamp` for display only.
 * Missing values are shown as an em dash, never invented.
 */
function toPreviewRecord(row: PropertyDataRow, index: number): PropertyRecord {
  // Widened access keeps this compatible while the typed row shape evolves.
  const raw = row as PropertyDataRow & Record<string, unknown>;

  const record: Record<string, unknown> = {
    // Legacy display keys.
    property_id: displayText(raw.external_id),
    project_name: displayText(raw.project_name),
    project_location: `${displayText(raw.project_name)} / ${displayText(raw.locality ?? raw.city)}`,
    builder: displayText(raw.builder_name),
    asking_price: displayPrice(raw.asking_price),
    price_per_sqft: displayRate(raw.price_per_sqft),
    previous_asking_price: displayPrice(raw.previous_asking_price),
    price_change_amount: displayPrice(raw.price_change_amount),
    rera_status: displayText(raw.rera_status),
    status: displayText(raw.status),
    listing_date: formatListingDate(toIsoText(raw.listing_timestamp)),
    days_on_market: displayNumber(raw.days_on_market) === DASH ? DASH : `${displayNumber(raw.days_on_market)}d`,
    city: displayText(raw.city),
    locality: displayText(raw.locality),
    pin_code: displayText(raw.pin_code),

    // Full export schema (23 fields, in export order).
    row_index: index + 1,
    rera_id: displayText(raw.rera_id),
    builder_name: displayText(raw.builder_name),
    asking_price_inr: displayPrice(raw.asking_price),
    price_per_sqft_inr: displayRate(raw.price_per_sqft),
    previous_asking_price_inr: displayPrice(raw.previous_asking_price),
    price_change_amount_inr: displayPrice(raw.price_change_amount),
    price_change_percent: displayPercent(raw.price_change_percent),
    construction_stage: displayText(raw.construction_stage),
    possession_date: displayIso(raw.possession_date),
    listed_by: displayText(raw.listed_by),
    listing_source: displayText(raw.listing_source),
    source_url: displayText(raw.source_url),
    latitude: toNumber(raw.latitude),
    longitude: toNumber(raw.longitude),
  };

  // Extra keys are intentional: shaped records carry more keys than the legacy
  // PropertyRecord interface declares (which still has retired display keys).
  return record as unknown as PropertyRecord;
}

/** The one shaping path shared by the preview and full-record endpoints. */
function toPreviewRecords(rows: PropertyDataRow[]): PropertyRecord[] {
  return rows.map((row, index) => toPreviewRecord(row, index));
}

export class DatasetService {
  /**
   * Fetches datasets matching filters from Supabase or memory.
   */
  static async getDatasets(filters: {
    search?: string;
    category?: string;
    geography?: string;
    frequency?: string;
  }): Promise<DatasetModel[]> {
    if (isSupabaseConfigured() && supabase) {
      const client = supabase;
      try {
        const search = filters.search ? sanitizeSearchTerm(filters.search) : "";
        const buildQuery = (withCount: boolean) => {
          let query = client
            .from("datasets")
            .select(withCount ? DATASET_SELECT_WITH_COUNT : "*")
            .eq("is_published", true)
            .order("created_at", { ascending: true });

          if (search) {
            query = query.or(`title.ilike.%${search}%,description.ilike.%${search}%`);
          }
          if (filters.category) {
            query = query.ilike("category", `%${sanitizeSearchTerm(filters.category)}%`);
          }
          if (filters.geography) {
            query = query.ilike("geography", `%${sanitizeSearchTerm(filters.geography)}%`);
          }
          if (filters.frequency) {
            query = query.eq("frequency", filters.frequency);
          }
          return query;
        };

        let result = await buildQuery(true);
        if (result.error) {
          // Schemas without an exposed properties relationship still work, just without a live count.
          result = await buildQuery(false);
        }

        const { data, error } = result;
        if (!error && data && data.length > 0) {
          return data.map((row) => normalizeDatasetRow(row as unknown as Record<string, unknown>));
        }
      } catch (err) {
        console.warn("Supabase dataset fetch error, fallback to local:", err);
      }
    }

    return DEFAULT_DATASETS.filter((d) => {
      const term = filters.search?.toLowerCase();
      const hay = `${d.title} ${d.category} ${d.geography} ${d.description}`.toLowerCase();
      if (term && !hay.includes(term)) return false;
      if (filters.category && !d.category.toLowerCase().includes(filters.category.toLowerCase())) return false;
      if (filters.geography && !d.geography.toLowerCase().includes(filters.geography.toLowerCase())) return false;
      if (filters.frequency && d.frequency !== filters.frequency) return false;
      return true;
    });
  }

  /**
   * Fetches single dataset by slug.
   */
  static async getDatasetBySlug(slug: string): Promise<DatasetModel | null> {
    if (isSupabaseConfigured() && supabase) {
      const client = supabase;
      try {
        let result = await client
          .from("datasets")
          .select(DATASET_SELECT_WITH_COUNT)
          .eq("slug", slug)
          .single();
        if (result.error) {
          result = await client.from("datasets").select("*").eq("slug", slug).single();
        }
        if (!result.error && result.data) {
          return normalizeDatasetRow(result.data as unknown as Record<string, unknown>);
        }
      } catch (err) {
        console.warn("Supabase getDatasetBySlug error:", err);
      }
    }
    return DEFAULT_DATASETS.find((d) => d.slug === slug) || null;
  }

  /**
   * Fetches every row for a dataset with optional city/date filters.
   * Results are paged so exports are not capped by Supabase's 1,000-row default.
   */
  static async getDatasetRecords(
    slug: string,
    filters: DatasetRecordFilters = {},
    limit?: number
  ): Promise<PropertyDataRow[]> {
    const dataset = await this.getDatasetBySlug(slug);
    return dataset ? this.fetchPropertyRows(dataset.id, filters, limit) : [];
  }

  /**
   * Every row for a dataset, shaped exactly like preview rows. Used by the
   * in-app full-dataset view (GET /api/v1/datasets/:slug/records).
   */
  static async getFullRecords(slug: string): Promise<PropertyRecord[]> {
    const dataset = await this.getDatasetBySlug(slug);
    if (!dataset) return [];
    return toPreviewRecords(await this.fetchPropertyRows(dataset.id, {}));
  }

  private static async fetchPropertyRows(
    datasetId: string,
    filters: DatasetRecordFilters,
    limit?: number
  ): Promise<PropertyDataRow[]> {
    if (!isSupabaseConfigured() || !supabase) return [];

    const from = normalizeDateInput(filters.from, "start");
    const to = normalizeDateInput(filters.to, "end");
    const city = filters.city ? sanitizeSearchTerm(filters.city) : "";
    const rows: PropertyDataRow[] = [];
    let offset = 0;

    while (true) {
      const pageSize = limit === undefined
        ? SUPABASE_PAGE_SIZE
        : Math.min(SUPABASE_PAGE_SIZE, Math.max(1, limit - rows.length));
      let query = supabase
        .from("properties")
        .select(PROPERTY_COLUMNS, { count: "exact" })
        .eq("dataset_id", datasetId)
        .order("listing_timestamp", { ascending: false })
        .range(offset, offset + pageSize - 1);

      if (city && city.toLowerCase() !== "all") {
        query = query.or(
          `city.ilike.%${city}%,locality.ilike.%${city}%,location.ilike.%${city}%,pin_code.ilike.%${city}%`
        );
      }
      if (from) query = query.gte("listing_timestamp", from);
      if (to) query = query.lte("listing_timestamp", to);

      const { data, error, count } = await query;
      if (error) {
        console.warn("Supabase property fetch error:", error.message);
        break;
      }
      if (!data || data.length === 0) break;

      rows.push(...(data as unknown as PropertyDataRow[]));
      if (limit !== undefined && rows.length >= limit) {
        return rows.slice(0, limit);
      }
      if (count === null ? data.length < SUPABASE_PAGE_SIZE : offset + data.length >= count) break;
      offset += data.length;
    }

    return rows;
  }

  /**
   * Fetches live preview records & calculates dynamic statistical visual metrics
   * directly from the Supabase database.
   */
  static async getDatasetPreview(slug: string): Promise<{
    dataset: DatasetModel;
    preview: PropertyRecord[];
    metrics: VisualDatasetMetrics;
  } | null> {
    const dataset = await this.getDatasetBySlug(slug);
    if (!dataset) return null;

    const rows = await this.fetchPropertyRows(dataset.id, {});
    // Same shaping path as getFullRecords, so both endpoints expose identical keys.
    const preview: PropertyRecord[] = toPreviewRecords(rows);

    // Dynamic Visual Metrics Calculation
    const statusCounts: Record<string, number> = {};
    const prices: number[] = [];

    for (const row of rows) {
      const status = toText(row.status) ?? "Unknown";
      statusCounts[status] = (statusCounts[status] || 0) + 1;
      const price = toNumber(row.asking_price);
      if (price !== null && price > 0) {
        prices.push(price);
      }
    }

    // Pie chart slices & percentages
    const statusEntries = Object.entries(statusCounts);
    const totalCount = rows.length || 1;
    let legend: string[] = [];
    let values: string[] = [];

    if (statusEntries.length > 0) {
      legend = statusEntries.slice(0, 3).map(([label]) => label);
      values = statusEntries.slice(0, 3).map(([, count]) => `${Math.round((count / totalCount) * 100)}%`);
    }

    const statusTitle = "Listing status";

    // Dynamic 7-bar distribution calculation from real prices
    let bars = new Array<number>(7).fill(0);
    let priceBrackets: string[] = [];

    if (prices.length >= 2) {
      // Reduce instead of Math.min(...prices) to stay safe for large datasets.
      const { min: minP, max: maxP } = prices.reduce(
        (bounds, price) => ({ min: Math.min(bounds.min, price), max: Math.max(bounds.max, price) }),
        { min: prices[0], max: prices[0] }
      );
      const bucketSize = (maxP - minP) / 7 || 1;
      const buckets = new Array(7).fill(0);

      for (const p of prices) {
        const idx = Math.min(6, Math.floor((p - minP) / bucketSize));
        buckets[idx]++;
      }

      const maxBucket = Math.max(1, ...buckets);
      bars = buckets.map((count) => Math.max(25, Math.round((count / maxBucket) * 92)));
      const medianP = minP + (maxP - minP) / 2;
      priceBrackets = [formatPriceINR(minP), formatPriceINR(medianP), formatPriceINR(maxP)];
    }

    const metrics: VisualDatasetMetrics = {
      title: dataset.geography || dataset.title,
      // Always the real number of fetched rows; never the cached catalog count.
      total_records: rows.length,
      bars,
      price_brackets: priceBrackets,
      status_title: statusTitle,
      legend,
      values,
      colors: ["#62a3ff", "#c9ff35", "#7f8797"],
    };

    return {
      dataset,
      preview,
      metrics,
    };
  }
}
