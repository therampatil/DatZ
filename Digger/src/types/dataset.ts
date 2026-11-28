export interface DatasetModel {
  id: string;
  slug: string;
  code: string;
  title: string;
  description: string;
  category: string;
  geography: string;
  fields_count: number;
  coverage: string;
  snapshot_price: number;
  monthly_price?: number;
  frequency: string;
  record_count: number;
  added_tag: string;
  updated_tag: string;
  attributes: string[];
  use_cases: string[];
  sources: string[];
  is_published: boolean;
  created_at: string;
  updated_at: string;
}

/** Values accepted by the `properties.listed_by` CHECK constraint. */
export type ListedBy = "owner" | "builder" | "broker" | "agent" | "unknown";

/**
 * A raw property row as stored in the Supabase `properties` table.
 * Exports use these numeric values directly instead of display-formatted strings.
 */
export interface PropertyDataRow {
  id?: string;
  dataset_id?: string;
  external_id: string;
  project_name: string | null;
  builder_name: string | null;
  city: string | null;
  locality: string | null;
  location: string | null;
  pin_code: string | null;
  carpet_area_sqft: number | null;
  asking_price: number | null;
  price_per_sqft: number | null;
  /** Fields added by migration 003 for the single Pune Real Estate dataset. */
  built_up_area_sqft: number | null;
  super_built_up_area_sqft: number | null;
  configuration: string | null;
  property_type: string | null;
  property_sub_type: string | null;
  floor_number: number | null;
  total_floors: number | null;
  facing: string | null;
  parking_count: number | null;
  furnishing_status: string | null;
  previous_asking_price: number | null;
  price_change_amount: number | null;
  price_change_percent: number | null;
  construction_stage: string | null;
  /** Date-only ISO string (YYYY-MM-DD), matching the DB DATE column. */
  possession_date: string | null;
  listed_by: ListedBy;
  source_url: string | null;
  latitude: number | null;
  longitude: number | null;
  /** Timestamp of the last write, maintained by the DB trigger. */
  updated_at: string;
  listing_source: string | null;
  rera_status: string | null;
  rera_id: string | null;
  status: string | null;
  listing_timestamp: string | null;
  days_on_market: number | null;
  raw_payload?: Record<string, unknown>;
  data_quality_score?: number | null;
  is_verified?: boolean;
  is_public_preview?: boolean;
  content_hash?: string | null;
}

/** Optional filters shared by previews and snapshot exports. */
export interface DatasetRecordFilters {
  city?: string;
  from?: string;
  to?: string;
}

export interface PropertyRecord {
  property_id: string;
  project_name?: string;
  project_location: string;
  builder?: string;
  carpet_area: string;
  asking_price: string;
  price_per_sqft: string;
  rera_status: string;
  status?: string;
  listing_date: string;
  days_on_market: number | string;
  city?: string;
  locality?: string;
  pin_code?: string;
}

export interface VisualDatasetMetrics {
  title: string;
  total_records: number;
  bars: number[];
  price_brackets: string[];
  status_title: string;
  legend: string[];
  values: string[];
  colors: string[];
}

export interface DownloadOrderInput {
  datasetSlug: string;
  format: "csv" | "xlsx" | "parquet";
  city?: string;
  from?: string;
  to?: string;
  customerEmail?: string;
}

export interface CustomScraperInput {
  customerEmail: string;
  targetLocations: string;
  targetSources: string;
  requiredAttributes: string;
  budgetEstimate?: string;
}

export interface PlatformTelemetry {
  propertiesUpdatedToday: number;
  lastScrapeSecondsAgo: number;
  lastScrapeTimestamp: string;
  pipelineUptime: string;
  activeRegions: number;
  totalDatasets: number;
}
