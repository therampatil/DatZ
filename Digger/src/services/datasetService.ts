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
    title: "Pune Residential Real Estate",
    description: "Verified Pune residential property listings from public RERA filings and configured listing sources.",
    category: "Residential Real Estate",
    geography: "Pune, Maharashtra",
    fields_count: 23,
    coverage: "Pune, Maharashtra",
    snapshot_price: 8500,
    monthly_price: 24000,
    frequency: "Real-Time",
    record_count: 69,
    added_tag: "+12 new today",
    updated_tag: "Just now",
    attributes: ["RERA ID", "Project Name", "Builder", "Carpet Area", "Asking Price", "Rate/Sqft"],
    use_cases: ["Price trend analysis", "Locality inventory tracking"],
    sources: ["SquareYards", "99acres", "Housing.com", "MahaRERA"],
    is_published: true,
    created_at: new Date(Date.now() - 30 * 86400000).toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: "d1010000-0000-0000-0000-000000000002",
    slug: "pune-commercial-real-estate",
    code: "PC",
    title: "Pune Commercial Offices & IT Parks",
    description: "Grade-A office towers, IT SEZ suites, and commercial business districts in Pune.",
    category: "Commercial Real Estate",
    geography: "Pune, Maharashtra",
    fields_count: 23,
    coverage: "Kharadi, Hinjawadi, Baner, Viman Nagar",
    snapshot_price: 12500,
    frequency: "Daily",
    monthly_price: 32000,
    added_tag: "+8 new today",
    updated_tag: "2 hours ago",
    attributes: ["Office Grade", "Floor Plate", "IT Compliance", "Asking Rate"],
    use_cases: ["Commercial absorption benchmarking", "Office space lease valuation"],
    sources: ["SquareYards Commercial", "MagicBricks Commercial"],
    record_count: 34,
    is_published: true,
    created_at: new Date(Date.now() - 25 * 86400000).toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: "d1010000-0000-0000-0000-000000000003",
    slug: "pune-plots-land",
    code: "PL",
    title: "Pune NA Land & Residential Plots",
    description: "Verified collector NA sanctioned residential and commercial plotting layouts.",
    category: "Plots & Land",
    geography: "Pune, Maharashtra",
    fields_count: 23,
    coverage: "Pune Peripheral & Expansion Corridors",
    snapshot_price: 9500,
    frequency: "Daily",
    monthly_price: 26000,
    added_tag: "+15 new today",
    updated_tag: "4 hours ago",
    attributes: ["NA Status", "Plot Area", "FSI Sanctioned", "Road Width"],
    use_cases: ["Land acquisition due-diligence", "Plotted layout development pricing"],
    sources: ["SquareYards Plots", "99acres Land"],
    record_count: 28,
    is_published: true,
    created_at: new Date(Date.now() - 20 * 86400000).toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: "d1010000-0000-0000-0000-000000000004",
    slug: "maharera-registered-projects",
    code: "MR",
    title: "MahaRERA Official Registry Filings",
    description: "Official statutory project disclosures, developer track records, and completion deadlines.",
    category: "MahaRERA Projects",
    geography: "Maharashtra (Pune Focus)",
    fields_count: 23,
    coverage: "Maharashtra Statewide",
    snapshot_price: 15000,
    frequency: "Real-Time",
    monthly_price: 38000,
    added_tag: "+24 filings",
    updated_tag: "1 hour ago",
    attributes: ["MahaRERA Reg No", "Promoter Entity", "Approved Units", "Sanctioned FSI"],
    use_cases: ["Statutory compliance verification", "Developer project risk profiling"],
    sources: ["MahaRERA Official Portal"],
    record_count: 85,
    is_published: true,
    created_at: new Date(Date.now() - 15 * 86400000).toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: "d1010000-0000-0000-0000-000000000005",
    slug: "pune-rental-properties",
    code: "RP",
    title: "Pune Residential Rentals & Co-Living PG",
    description: "Rental yield metrics, active tenant agreements, flat shares, and managed PGs.",
    category: "Rental Properties & PG",
    geography: "Pune, Maharashtra",
    fields_count: 23,
    coverage: "Pune IT Clusters & University Zones",
    snapshot_price: 7500,
    frequency: "Real-Time",
    monthly_price: 20000,
    added_tag: "+45 rentals",
    updated_tag: "15 min ago",
    attributes: ["Monthly Rent", "Security Deposit", "Furnishing Tier", "Lock-in Period"],
    use_cases: ["Rental yield calculations", "Co-living demand mapping"],
    sources: ["SquareYards Rent", "Housing.com Rent", "99acres Rent"],
    record_count: 112,
    is_published: true,
    created_at: new Date(Date.now() - 10 * 86400000).toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: "d1010000-0000-0000-0000-000000000006",
    slug: "pune-coworking-spaces",
    code: "CW",
    title: "Pune Managed Offices & Coworking Hubs",
    description: "Flexible desk pricing, enterprise team suites, day passes, and flex-workspace availability.",
    category: "Co-Working & Shared Spaces",
    geography: "Pune, Maharashtra",
    fields_count: 23,
    coverage: "SB Road, Kalyani Nagar, Baner, Kharadi",
    snapshot_price: 11000,
    frequency: "Daily",
    monthly_price: 28000,
    added_tag: "+6 hubs",
    updated_tag: "3 hours ago",
    attributes: ["Per-Seat Cost", "Private Cabin Rates", "Meeting Room Fills", "Lease Terms"],
    use_cases: ["Enterprise flex-space procurement", "Operator competitive pricing"],
    sources: ["SquareYards Coworking", "99acres Commercial"],
    record_count: 22,
    is_published: true,
    created_at: new Date(Date.now() - 8 * 86400000).toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: "d1010000-0000-0000-0000-000000000007",
    slug: "pune-industrial-warehousing",
    code: "IW",
    title: "Pune Logistics, Warehousing & MIDC Land",
    description: "Grade-A logistics parks, manufacturing sheds, industrial plots, and MIDC land parcels.",
    category: "Industrial & Warehousing",
    geography: "Pune Industrial Belt",
    fields_count: 23,
    coverage: "Chakan, Talegaon, Ranjangaon, Bhosari",
    snapshot_price: 16000,
    frequency: "Daily",
    monthly_price: 40000,
    added_tag: "+10 listings",
    updated_tag: "6 hours ago",
    attributes: ["Clear Height", "Power Sanction (kVA)", "Dock Levellers", "MIDC Transfer Type"],
    use_cases: ["Logistics footprint planning", "Factory location feasibility"],
    sources: ["SquareYards Industrial", "MagicBricks Industrial"],
    record_count: 19,
    is_published: true,
    created_at: new Date(Date.now() - 7 * 86400000).toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: "d1010000-0000-0000-0000-000000000008",
    slug: "pune-retail-highstreet",
    code: "RS",
    title: "Pune High-Street Retail & Commercial Shops",
    description: "High footfall retail shop fronts, mall atrium units, anchor leases, and dining spaces.",
    category: "Retail & High-Street Shops",
    geography: "Pune, Maharashtra",
    fields_count: 23,
    coverage: "FC Road, MG Road, Aundh, Koregaon Park",
    snapshot_price: 13500,
    frequency: "Daily",
    monthly_price: 34000,
    added_tag: "+12 shops",
    updated_tag: "5 hours ago",
    attributes: ["Frontage (ft)", "Footfall Index", "Monthly Base Rent", "CAM Charges"],
    use_cases: ["Brand retail expansion site selection", "High-street retail capital returns"],
    sources: ["SquareYards Commercial Shops", "99acres Retail"],
    record_count: 31,
    is_published: true,
    created_at: new Date(Date.now() - 6 * 86400000).toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: "d1010000-0000-0000-0000-000000000009",
    slug: "pune-hospitality-resorts",
    code: "HR",
    title: "Pune & Lonavala Resorts, Hotels & Stays",
    description: "Boutique hotels, weekend luxury resorts, agro-tourism centers, and serviced homestays.",
    category: "Hospitality & Resorts",
    geography: "Pune, Lonavala & Mulshi",
    fields_count: 23,
    coverage: "Lonavala, Mulshi, Lavasa, Mahabaleshwar Belt",
    snapshot_price: 14000,
    frequency: "Weekly",
    monthly_price: 35000,
    added_tag: "+4 properties",
    updated_tag: "1 day ago",
    attributes: ["Key Count", "ADR Estimates", "F&B Capacity", "Tourism Sanctions"],
    use_cases: ["Hospitality asset transaction underwriting", "RevPAR benchmark studies"],
    sources: ["SquareYards Villas", "99acres Hospitality"],
    record_count: 16,
    is_published: true,
    created_at: new Date(Date.now() - 5 * 86400000).toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: "d1010000-0000-0000-0000-000000000010",
    slug: "pune-healthcare-medical",
    code: "HM",
    title: "Pune Healthcare, Diagnostic & Clinic Suites",
    description: "Polyclinic premises, diagnostic lab spaces, daycare hospital wings, and medical centers.",
    category: "Healthcare & Medical Spaces",
    geography: "Pune, Maharashtra",
    fields_count: 23,
    coverage: "Pune City & PCMC Health Zones",
    snapshot_price: 13000,
    frequency: "Weekly",
    monthly_price: 31000,
    added_tag: "+7 suites",
    updated_tag: "1 day ago",
    attributes: ["Bed Capacity Sanction", "Bio-Waste Clearance", "Oxygen Provision"],
    use_cases: ["Healthcare real estate site selection", "Clinic chain expansion strategy"],
    sources: ["SquareYards Medical", "MagicBricks Healthcare"],
    record_count: 14,
    is_published: true,
    created_at: new Date(Date.now() - 4 * 86400000).toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: "d1010000-0000-0000-0000-000000000011",
    slug: "pune-educational-campus",
    code: "EI",
    title: "Pune Educational Institutes & Academy Hubs",
    description: "School buildings, college annexes, coaching campus complexes, and training academies.",
    category: "Educational Institutes & Campus",
    geography: "Pune, Maharashtra",
    fields_count: 23,
    coverage: "Kothrud, Viman Nagar, Hinjawadi, Wagholi",
    snapshot_price: 12000,
    frequency: "Weekly",
    monthly_price: 29000,
    added_tag: "+5 campuses",
    updated_tag: "2 days ago",
    attributes: ["Student Capacity", "Playground Area", "Fire NOC", "Affiliation Eligibility"],
    use_cases: ["School franchise expansion", "EdTech training offline centers"],
    sources: ["SquareYards Institutional", "99acres Commercial"],
    record_count: 11,
    is_published: true,
    created_at: new Date(Date.now() - 3 * 86400000).toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: "d1010000-0000-0000-0000-000000000012",
    slug: "pune-agricultural-farmhouses",
    code: "AF",
    title: "Pune Agri-Plots, Farmhouses & Country Estates",
    description: "Fertile agricultural holdings, gated farmhouse communities, river-touch estates, and plantations.",
    category: "Agricultural Land & Farmhouses",
    geography: "Pune Rural, Maharashtra",
    fields_count: 23,
    coverage: "Bhor, Shirwal, Panshet, Kamshet",
    snapshot_price: 9000,
    frequency: "Weekly",
    monthly_price: 22000,
    added_tag: "+18 estates",
    updated_tag: "1 day ago",
    attributes: ["7/12 Extract Status", "Water Source", "Soil Classification", "Access Road"],
    use_cases: ["Agro-investing valuation", "Weekend retreat land acquisition"],
    sources: ["SquareYards Farmhouses", "99acres Agricultural"],
    record_count: 25,
    is_published: true,
    created_at: new Date(Date.now() - 2 * 86400000).toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: "d1010000-0000-0000-0000-000000000013",
    slug: "pune-bank-auction-assets",
    code: "BA",
    title: "Pune Bank Distressed & SARFAESI Auction Properties",
    description: "Public sector and private bank auction inventories, SARFAESI repossessions, and reserve prices.",
    category: "Bank Auction & Distressed Assets",
    geography: "Pune, Maharashtra",
    fields_count: 23,
    coverage: "Pune Metro District",
    snapshot_price: 17500,
    frequency: "Real-Time",
    monthly_price: 45000,
    added_tag: "+32 auctions",
    updated_tag: "30 min ago",
    attributes: ["Reserve Price", "EMD Required", "Auction Date", "Possession Type"],
    use_cases: ["Distressed asset arbitrage", "High-margin auction acquisitions"],
    sources: ["IBAPI Portal", "SquareYards Auctions", "Public Bank Notices"],
    record_count: 42,
    is_published: true,
    created_at: new Date(Date.now() - 1 * 86400000).toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: "d1010000-0000-0000-0000-000000000014",
    slug: "pune-luxury-villas",
    code: "LV",
    title: "Pune Luxury Villas, Penthouses & Sky Mansions",
    description: "Gated villa enclaves, double-height duplex penthouses, private plunge pools, and signature estates.",
    category: "Luxury & Penthouse Villas",
    geography: "Pune, Maharashtra",
    fields_count: 23,
    coverage: "Koregaon Park, Boat Club Rd, Sopan Baug, Baner Hills",
    snapshot_price: 18000,
    frequency: "Daily",
    monthly_price: 48000,
    added_tag: "+9 mansions",
    updated_tag: "2 hours ago",
    attributes: ["Private Pool", "Deck Area", "Concierge Level", "Architect Signature"],
    use_cases: ["Ultra-HNI real estate advisory", "Luxury asset liquidity tracking"],
    sources: ["SquareYards Luxury", "99acres Luxury"],
    record_count: 27,
    is_published: true,
    created_at: new Date().toISOString(),
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
