import crypto from "node:crypto";
import type { ListedBy } from "../types/dataset.js";
import { supabase } from "../db/supabase.js";
import { MahaRERAScraper, NormalizedReraProject } from "./mahareraScraper.js";
import { NormalizedPropertyListing, PropertyListingsScraper } from "./propertyListingsScraper.js";
import { SnapshotBuilder } from "./snapshotBuilder.js";
import { TelemetryService } from "../services/telemetryService.js";
import { DatasetService } from "../services/datasetService.js";

const BATCH_SIZE = 200;
const WRITE_CONCURRENCY = 3;
const PRICE_PER_SQFT_TOLERANCE = 0.05;
const VERIFIED_QUALITY_THRESHOLD = 70;
const PUBLIC_PREVIEW_QUALITY_THRESHOLD = 85;
const TARGET_DATASET_SLUG = "pune-real-estate-data";
const RERA_SOURCE_NAME = "MahaRERA Official Registry";
const LISTING_SOURCE_NAME = "SquareYards Pune Sale Feed";

/** Row shape written to the `properties` table by the ingestion pipeline. */
export interface PropertyWriteRow {
  dataset_id: string;
  external_id: string;
  project_name: string | null;
  builder_name: string | null;
  city: string;
  locality: string;
  location: string | null;
  pin_code: string | null;
  carpet_area_sqft: number | null;
  asking_price: number | null;
  price_per_sqft: number | null;
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
  possession_date: string | null;
  listed_by: ListedBy;
  source_url: string | null;
  latitude: number | null;
  longitude: number | null;
  updated_at: string;
  listing_source: string;
  rera_status: string | null;
  rera_id: string | null;
  status: string;
  listing_timestamp: string;
  days_on_market: number;
  raw_payload: Record<string, unknown>;
  data_quality_score: number;
  is_verified: boolean;
  is_public_preview: boolean;
  content_hash: string;
}

/** Pre-validation input shared by both scraper adapters. */
export interface PropertyQualityInput {
  externalId: string;
  projectName?: string | null;
  builderName?: string | null;
  city?: string | null;
  locality?: string | null;
  location?: string | null;
  pinCode?: string | null;
  carpetAreaSqft?: number | null;
  askingPrice?: number | null;
  pricePerSqft?: number | null;
  builtUpAreaSqft?: number | null;
  superBuiltUpAreaSqft?: number | null;
  configuration?: string | null;
  propertyType?: string | null;
  propertySubType?: string | null;
  floorNumber?: number | null;
  totalFloors?: number | null;
  facing?: string | null;
  parkingCount?: number | null;
  furnishingStatus?: string | null;
  previousAskingPrice?: number | null;
  priceChangeAmount?: number | null;
  priceChangePercent?: number | null;
  constructionStage?: string | null;
  possessionDate?: string | null;
  listedBy?: ListedBy | null;
  sourceUrl?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  listingSource?: string | null;
  reraStatus?: string | null;
  reraId?: string | null;
  status?: string | null;
  listingTimestamp?: string | null;
  daysOnMarket?: number | null;
  rawPayload?: Record<string, unknown>;
  sourceFilingUrl?: string | null;
}

export interface QualityEvaluation {
  accepted: boolean;
  reasons: string[];
  score: number;
  row: PropertyWriteRow | null;
}

function positiveOrNull(value: number | null | undefined): { value: number | null; invalid: boolean } {
  if (value === null || value === undefined) return { value: null, invalid: false };
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return { value: null, invalid: true };
  if (parsed <= 0) return { value: null, invalid: true };
  return { value: Math.round(parsed * 100) / 100, invalid: false };
}

function integerOrNull(
  value: number | null | undefined,
  min = 0
): { value: number | null; invalid: boolean } {
  if (value === null || value === undefined) return { value: null, invalid: false };
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < min) {
    return { value: null, invalid: true };
  }
  return { value: parsed, invalid: false };
}

function coordinateOrNull(
  value: number | null | undefined,
  min: number,
  max: number
): { value: number | null; invalid: boolean } {
  if (value === null || value === undefined) return { value: null, invalid: false };
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return { value: null, invalid: true };
  return { value: parsed, invalid: false };
}

function isOfficialSource(source: string): boolean {
  return /maharera|rera|official|government|statutory|regulatory/i.test(source);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function computePriceChangeValues(askingPrice: number | null, previousPrice: number | null): {
  amount: number | null;
  percent: number | null;
} {
  if (askingPrice === null || previousPrice === null || previousPrice <= 0) {
    return { amount: null, percent: null };
  }
  const amount = round2(askingPrice - previousPrice);
  return { amount, percent: round2((amount / previousPrice) * 100) };
}

function normalizePossessionDate(value: string | null | undefined): string | null {
  const raw = clean(value);
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

/** Stable hash of the natural key plus the values that make up the snapshot. */
export function computeContentHash(datasetId: string, input: PropertyQualityInput): string {
  const naturalKey = {
    datasetId,
    externalId: input.externalId,
  };
  const snapshot = {
    projectName: input.projectName || null,
    builderName: input.builderName || null,
    city: input.city || null,
    locality: input.locality || null,
    pinCode: input.pinCode || null,
    carpetAreaSqft: input.carpetAreaSqft ?? null,
    askingPrice: input.askingPrice ?? null,
    pricePerSqft: input.pricePerSqft ?? null,
    builtUpAreaSqft: input.builtUpAreaSqft ?? null,
    superBuiltUpAreaSqft: input.superBuiltUpAreaSqft ?? null,
    configuration: input.configuration || null,
    propertyType: input.propertyType || null,
    propertySubType: input.propertySubType || null,
    floorNumber: input.floorNumber ?? null,
    totalFloors: input.totalFloors ?? null,
    facing: input.facing || null,
    parkingCount: input.parkingCount ?? null,
    furnishingStatus: input.furnishingStatus || null,
    previousAskingPrice: input.previousAskingPrice ?? null,
    priceChangeAmount: input.priceChangeAmount ?? null,
    priceChangePercent: input.priceChangePercent ?? null,
    constructionStage: input.constructionStage || null,
    possessionDate: input.possessionDate || null,
    listedBy: input.listedBy || "unknown",
    sourceUrl: input.sourceUrl || null,
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
    listingSource: input.listingSource || null,
    status: input.status || null,
    listingDate: input.listingTimestamp ? String(input.listingTimestamp).slice(0, 10) : null,
  };
  return crypto
    .createHash("sha256")
    .update(JSON.stringify({ naturalKey, snapshot }))
    .digest("hex");
}

/**
 * Validates and normalizes one scraped row. Non-positive numbers are rejected
 * outright so no write can violate the database CHECK constraints. Missing
 * numbers become null (allowed by the schema) and reduce the quality score.
 */
export function evaluatePropertyQuality(
  input: PropertyQualityInput,
  datasetId: string
): QualityEvaluation {
  const reasons: string[] = [];
  if (!input.externalId || !String(input.externalId).trim()) {
    return { accepted: false, reasons: ["missing external_id"], score: 0, row: null };
  }

  const area = positiveOrNull(input.carpetAreaSqft);
  const price = positiveOrNull(input.askingPrice);
  const suppliedPpsf = positiveOrNull(input.pricePerSqft);
  const builtUp = positiveOrNull(input.builtUpAreaSqft);
  const superBuiltUp = positiveOrNull(input.superBuiltUpAreaSqft);
  const previousPrice = positiveOrNull(input.previousAskingPrice);
  const floor = integerOrNull(input.floorNumber);
  const totalFloors = integerOrNull(input.totalFloors, 1);
  const parking = integerOrNull(input.parkingCount);
  const latitude = coordinateOrNull(input.latitude, -90, 90);
  const longitude = coordinateOrNull(input.longitude, -180, 180);

  if (area.invalid) reasons.push("non-positive or invalid carpet area");
  if (price.invalid) reasons.push("non-positive or invalid asking price");
  if (suppliedPpsf.invalid) reasons.push("non-positive or invalid price per sqft");
  if (builtUp.invalid) reasons.push("non-positive or invalid built-up area");
  if (superBuiltUp.invalid) reasons.push("non-positive or invalid super built-up area");
  if (previousPrice.invalid) reasons.push("non-positive or invalid previous asking price");
  if (floor.invalid) reasons.push("invalid floor number");
  if (totalFloors.invalid) reasons.push("invalid total floors");
  if (parking.invalid) reasons.push("invalid parking count");
  if (latitude.invalid) reasons.push("latitude out of range");
  if (longitude.invalid) reasons.push("longitude out of range");
  if (reasons.length > 0) {
    return { accepted: false, reasons, score: 0, row: null };
  }

  let pricePerSqft = suppliedPpsf.value;
  let ppsfConsistent = false;
  if (area.value !== null && price.value !== null) {
    const expected = round2(price.value / area.value);
    if (pricePerSqft === null) {
      // Derive from carpet area whenever the source did not supply a value.
      pricePerSqft = expected;
      ppsfConsistent = true;
    } else {
      const difference = Math.abs(pricePerSqft - expected) / expected;
      if (difference <= PRICE_PER_SQFT_TOLERANCE) {
        ppsfConsistent = true;
      } else {
        reasons.push(`price_per_sqft ${pricePerSqft} inconsistent with ${price.value}/${area.value}; corrected to ${expected}`);
        pricePerSqft = expected;
      }
    }
  } else if (pricePerSqft !== null) {
    // A ppsf without either area or price cannot be verified. Keep it out of
    // the database rather than storing an uncheckable number.
    reasons.push("price_per_sqft omitted because area or price is unavailable");
    pricePerSqft = null;
  }

  const priceChange = computePriceChangeValues(price.value, previousPrice.value);
  const timestamp = input.listingTimestamp && !Number.isNaN(new Date(input.listingTimestamp).getTime())
    ? new Date(input.listingTimestamp).toISOString()
    : new Date().toISOString();
  if (!input.listingTimestamp) reasons.push("listing timestamp defaulted to ingestion time");

  const listingSource = clean(input.listingSource) || "Configured Listing Feed";
  const city = clean(input.city) || "Pune";
  const locality = clean(input.locality) || city;
  const listedBy: ListedBy = input.listedBy && input.listedBy !== "unknown" ? input.listedBy : "unknown";
  const possessionDate = normalizePossessionDate(input.possessionDate);

  // Core fields carry 55 points, the migration-003 fields 30 points and price
  // consistency 15 points. A row with only legacy fields tops out at 70, so it
  // can be verified when official but never reaches public-preview quality.
  const coreFields = [
    input.projectName,
    input.builderName,
    input.city,
    input.locality,
    input.pinCode,
    area.value,
    price.value,
    pricePerSqft,
    input.reraId,
    input.listingTimestamp,
    input.listingSource,
  ];
  const newFields = [
    builtUp.value,
    superBuiltUp.value,
    input.configuration,
    input.propertyType,
    input.propertySubType,
    floor.value,
    totalFloors.value,
    input.facing,
    parking.value,
    input.furnishingStatus,
    previousPrice.value,
    priceChange.amount,
    priceChange.percent,
    input.constructionStage,
    possessionDate,
    input.listedBy && input.listedBy !== "unknown" ? input.listedBy : null,
    input.sourceUrl,
    latitude.value,
    longitude.value,
  ];
  const isPresent = (value: unknown) => value !== null && value !== undefined && value !== "";
  const corePresent = coreFields.filter(isPresent).length;
  const newPresent = newFields.filter(isPresent).length;
  const completenessScore = Math.round((corePresent / coreFields.length) * 55)
    + Math.round((newPresent / newFields.length) * 30);
  const consistencyScore = ppsfConsistent ? 15 : pricePerSqft === null ? 5 : 0;
  const score = Math.max(0, Math.min(100, completenessScore + consistencyScore));

  const isVerified = isOfficialSource(listingSource) && score >= VERIFIED_QUALITY_THRESHOLD;
  const isPublicPreview = isVerified && score >= PUBLIC_PREVIEW_QUALITY_THRESHOLD;
  const contentHash = computeContentHash(datasetId, {
    ...input,
    carpetAreaSqft: area.value,
    askingPrice: price.value,
    pricePerSqft,
    builtUpAreaSqft: builtUp.value,
    superBuiltUpAreaSqft: superBuiltUp.value,
    floorNumber: floor.value,
    totalFloors: totalFloors.value,
    parkingCount: parking.value,
    previousAskingPrice: previousPrice.value,
    priceChangeAmount: priceChange.amount,
    priceChangePercent: priceChange.percent,
    possessionDate,
    listedBy,
    latitude: latitude.value,
    longitude: longitude.value,
    listingTimestamp: timestamp,
  });

  const row: PropertyWriteRow = {
    dataset_id: datasetId,
    external_id: String(input.externalId).trim(),
    project_name: clean(input.projectName) || null,
    builder_name: clean(input.builderName) || null,
    city,
    locality,
    location: clean(input.location) || (locality ? `${locality}, ${city}` : null),
    pin_code: clean(input.pinCode) || null,
    carpet_area_sqft: area.value,
    asking_price: price.value,
    price_per_sqft: pricePerSqft,
    built_up_area_sqft: builtUp.value,
    super_built_up_area_sqft: superBuiltUp.value,
    configuration: clean(input.configuration) || null,
    property_type: clean(input.propertyType) || null,
    property_sub_type: clean(input.propertySubType) || null,
    floor_number: floor.value,
    total_floors: totalFloors.value,
    facing: clean(input.facing) || null,
    parking_count: parking.value,
    furnishing_status: clean(input.furnishingStatus) || null,
    previous_asking_price: previousPrice.value,
    price_change_amount: priceChange.amount,
    price_change_percent: priceChange.percent,
    construction_stage: clean(input.constructionStage) || null,
    possession_date: possessionDate,
    listed_by: listedBy,
    source_url: clean(input.sourceUrl) || null,
    latitude: latitude.value,
    longitude: longitude.value,
    updated_at: new Date().toISOString(),
    listing_source: listingSource,
    rera_status: clean(input.reraStatus) || null,
    rera_id: clean(input.reraId) || null,
    status: clean(input.status) || "Active",
    listing_timestamp: timestamp,
    days_on_market: Math.max(0, Math.floor(Number(input.daysOnMarket) || 0)),
    raw_payload: {
      ...(input.rawPayload || {}),
      ...(input.sourceFilingUrl ? { source_filing_url: input.sourceFilingUrl } : {}),
      data_quality: {
        score,
        reasons,
        coreFieldsPresent: corePresent,
        newFieldsPresent: newPresent,
        verified: isVerified,
        public_preview: isPublicPreview,
        content_hash: contentHash,
      },
    },
    data_quality_score: score,
    is_verified: isVerified,
    is_public_preview: isPublicPreview,
    content_hash: contentHash,
  };

  return { accepted: true, reasons, score, row };
}

function clean(value: string | null | undefined): string {
  return (value || "").replace(/\s+/g, " ").trim();
}

/** Validates, scores and deduplicates a batch before any database write. */
export function normalizeAndDeduplicate(
  inputs: PropertyQualityInput[],
  datasetId: string
): { rows: PropertyWriteRow[]; rejected: string[]; duplicates: number } {
  const rows: PropertyWriteRow[] = [];
  const rejected: string[] = [];
  const seenIds = new Set<string>();
  const seenHashes = new Set<string>();
  let duplicates = 0;

  for (const input of inputs) {
    const evaluation = evaluatePropertyQuality(input, datasetId);
    if (!evaluation.accepted || !evaluation.row) {
      rejected.push(`${input.externalId || "<missing id>"}: ${evaluation.reasons.join("; ") || "failed validation"}`);
      continue;
    }
    if (seenIds.has(evaluation.row.external_id) || seenHashes.has(evaluation.row.content_hash)) {
      duplicates++;
      continue;
    }
    seenIds.add(evaluation.row.external_id);
    seenHashes.add(evaluation.row.content_hash);
    rows.push(evaluation.row);
  }

  return { rows, rejected, duplicates };
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size));
  return result;
}

function toReraInput(r: NormalizedReraProject): PropertyQualityInput {
  const approval = new Date(r.listingTimestamp);
  const daysOnMarket = Number.isNaN(approval.getTime())
    ? 0
    : Math.max(0, Math.floor((Date.now() - approval.getTime()) / 86_400_000));
  return {
    externalId: r.reraId,
    projectName: r.projectName,
    builderName: r.promoterName,
    city: r.district,
    locality: r.locality || r.taluka || r.district,
    location: r.location || [r.taluka, r.district].filter(Boolean).join(", "),
    pinCode: r.pinCode,
    carpetAreaSqft: r.commercialAreaSqft,
    askingPrice: r.estimatedCostInr,
    pricePerSqft: null,
    builtUpAreaSqft: r.builtUpAreaSqft,
    superBuiltUpAreaSqft: r.superBuiltUpAreaSqft,
    configuration: r.configuration,
    propertyType: r.propertyType,
    propertySubType: r.propertySubType,
    floorNumber: r.floorNumber,
    totalFloors: r.totalFloors,
    facing: r.facing,
    parkingCount: r.parkingCount,
    furnishingStatus: r.furnishingStatus,
    previousAskingPrice: r.previousAskingPrice,
    priceChangeAmount: r.priceChangeAmount,
    priceChangePercent: r.priceChangePercent,
    constructionStage: r.constructionStage,
    possessionDate: r.possessionDate,
    listedBy: r.listedBy,
    sourceUrl: r.sourceUrl || r.sourceFilingUrl || null,
    latitude: r.latitude,
    longitude: r.longitude,
    listingSource: RERA_SOURCE_NAME,
    reraStatus: r.status,
    reraId: r.reraId,
    status: r.status,
    listingTimestamp: r.listingTimestamp,
    daysOnMarket,
    rawPayload: { ...r.rawPayload, projectType: r.projectType },
    sourceFilingUrl: r.sourceFilingUrl,
  };
}

function toListingInput(r: NormalizedPropertyListing): PropertyQualityInput {
  return {
    externalId: r.externalId,
    projectName: r.projectName,
    builderName: r.builderName,
    city: r.city,
    locality: r.locality,
    location: r.location,
    pinCode: r.pinCode,
    carpetAreaSqft: r.carpetAreaSqft,
    askingPrice: r.askingPrice,
    pricePerSqft: r.pricePerSqft,
    builtUpAreaSqft: r.builtUpAreaSqft,
    superBuiltUpAreaSqft: r.superBuiltUpAreaSqft,
    configuration: r.configuration,
    propertyType: r.propertyType,
    propertySubType: r.propertySubType,
    floorNumber: r.floorNumber,
    totalFloors: r.totalFloors,
    facing: r.facing,
    parkingCount: r.parkingCount,
    furnishingStatus: r.furnishingStatus,
    previousAskingPrice: r.previousAskingPrice,
    priceChangeAmount: r.priceChangeAmount,
    priceChangePercent: r.priceChangePercent,
    constructionStage: r.constructionStage,
    possessionDate: r.possessionDate,
    listedBy: r.listedBy,
    sourceUrl: r.sourceUrl,
    latitude: r.latitude,
    longitude: r.longitude,
    listingSource: r.listingSource,
    reraStatus: r.reraStatus,
    reraId: r.reraId,
    status: r.status,
    listingTimestamp: r.listingTimestamp,
    daysOnMarket: r.daysOnMarket,
    rawPayload: r.rawPayload,
  };
}

async function upsertBatches(
  client: any,
  datasetId: string,
  rows: PropertyWriteRow[]
): Promise<{ added: number; updated: number }> {
  // Pre-flight lookup lets us distinguish real inserts from updates instead of
  // claiming every upsert was a new record.
  const existingIds = new Set<string>();
  let lookupOk = true;
  for (const idChunk of chunks(rows.map((row) => row.external_id), BATCH_SIZE)) {
    const { data, error } = await client
      .from("properties")
      .select("external_id")
      .eq("dataset_id", datasetId)
      .in("external_id", idChunk);
    if (error) {
      lookupOk = false;
      console.warn("Could not look up existing property ids; all upserts will be reported as added:", error.message);
      break;
    }
    for (const row of data || []) existingIds.add(row.external_id);
  }

  let added = 0;
  let updated = 0;
  const batches = chunks(rows, BATCH_SIZE);
  await mapWithConcurrency(batches, WRITE_CONCURRENCY, async (batch) => {
    const { error } = await client
      .from("properties")
      .upsert(batch, { onConflict: "dataset_id,external_id" });
    if (error) {
      throw new Error(`Property upsert failed for dataset ${datasetId}: ${error.message}`);
    }
    for (const row of batch) {
      if (lookupOk && existingIds.has(row.external_id)) updated++;
      else added++;
    }
  });

  if (!lookupOk) {
    console.warn("records_updated is reported as 0 because the existing-id lookup failed; records_added includes every upserted row.");
  }
  return { added, updated };
}

export interface DatasetPipelineTask {
  datasetSlug: string;
  sourceName: string;
  scrape: () => Promise<any[]>;
  toInput: (row: any) => PropertyQualityInput;
}

export interface PipelineSourceResult {
  source: string;
  status: "completed" | "failed";
  rows: number;
  added: number;
  updated: number;
  rejected: number;
  duplicates: number;
}

export interface PipelineResult {
  status: string;
  totalIngested: number;
  datasetsUpdated: number;
  snapshotsCreated: number;
  durationMs: number;
  sources: PipelineSourceResult[];
}

export interface PipelineDependencies {
  /** Injected Supabase-compatible client. Defaults to the service-role client. */
  client?: any;
  /** Dataset rows to target. Defaults to the live catalog. */
  datasets?: Array<{ slug: string; id: string }>;
  /** Scraper tasks. Defaults to the built-in MahaRERA + SquareYards feeds. */
  tasks?: DatasetPipelineTask[];
  /** Snapshot builder. Defaults to the Supabase Storage uploader. */
  buildSnapshots?: () => Promise<{ processedDatasets: number; totalSnapshotsCreated: number }>;
  /** Telemetry hook. Defaults to TelemetryService.recordScrapeActivity. */
  recordScrapeActivity?: (records: number) => void;
}

function defaultPipelineTasks(): DatasetPipelineTask[] {
  return [
    {
      datasetSlug: TARGET_DATASET_SLUG,
      sourceName: RERA_SOURCE_NAME,
      scrape: () => MahaRERAScraper.scrapeCommercialProjects(),
      toInput: (row) => toReraInput(row),
    },
    {
      datasetSlug: TARGET_DATASET_SLUG,
      sourceName: LISTING_SOURCE_NAME,
      scrape: () => PropertyListingsScraper.scrapePuneRealEstateListings(),
      toInput: (row) => toListingInput(row),
    },
  ];
}

export class PipelineOrchestrator {
  /**
   * Executes the full ingestion & compilation pipeline with batched writes,
   * quality gates and per-source scraper run logging. Errors are propagated.
   *
   * Dependencies are injectable so the pipeline can be integration-tested with
   * a fake Supabase client and fake scrapers, without network access.
   */
  static async runFullPipeline(deps: PipelineDependencies = {}): Promise<PipelineResult> {
    const startTime = Date.now();
    console.log("🚀 Starting DatZ data ingestion pipeline...");

    const client: any = deps.client ?? supabase;
    if (!client) {
      console.warn(
        "Supabase is not configured (SUPABASE_URL / service key missing). Pipeline skipped: no scrapes, writes or telemetry counts."
      );
      TelemetryService.recordScrapeActivity(0);
      return {
        status: "skipped",
        totalIngested: 0,
        datasetsUpdated: 0,
        snapshotsCreated: 0,
        durationMs: Date.now() - startTime,
        sources: [],
      };
    }

    const datasets: Array<{ slug: string; id: string }> =
      deps.datasets ?? (await DatasetService.getDatasets({}));
    const datasetMap = new Map(datasets.map((dataset) => [dataset.slug, dataset.id]));

    const sourceIds = new Map<string, string>();
    const { data: sources, error: sourcesError } = await client
      .from("data_sources")
      .select("id, name");
    if (sourcesError) {
      console.warn("Could not load data_sources; scraper_runs will be logged without source_id:", sourcesError.message);
    } else {
      for (const source of sources || []) sourceIds.set(String(source.name).toLowerCase(), String(source.id));
    }

    const tasks: DatasetPipelineTask[] = deps.tasks ?? defaultPipelineTasks();

    let totalIngested = 0;
    const updatedDatasetIds = new Set<string>();
    const sourceResults: PipelineSourceResult[] = [];

    for (const task of tasks) {
      if (task.datasetSlug !== TARGET_DATASET_SLUG) {
        console.warn(`Unknown dataset slug ${task.datasetSlug}; skipping its scraper.`);
        continue;
      }
      const datasetId = datasetMap.get(TARGET_DATASET_SLUG);
      if (!datasetId) {
        console.warn(`Dataset ${TARGET_DATASET_SLUG} not found; skipping its scraper.`);
        continue;
      }

      const runStartedAt = new Date().toISOString();
      const runInsert = await client
        .from("scraper_runs")
        .insert({
          dataset_id: datasetId,
          source_id: sourceIds.get(task.sourceName.toLowerCase()) || null,
          status: "running",
          records_added: 0,
          records_updated: 0,
          started_at: runStartedAt,
        })
        .select("id")
        .single();
      const runId = runInsert.data?.id as string | undefined;
      if (runInsert.error) {
        console.warn(`Could not create scraper_runs row for ${task.sourceName}:`, runInsert.error.message);
      }

      const finishRun = async (
        status: "completed" | "failed",
        added: number,
        updated: number,
        errorMessage?: string
      ) => {
        if (!runId) return;
        const { error } = await client
          .from("scraper_runs")
          .update({
            status,
            records_added: added,
            records_updated: updated,
            error_message: errorMessage || null,
            completed_at: new Date().toISOString(),
          })
          .eq("id", runId);
        if (error) {
          console.warn(`Could not finish scraper_runs row ${runId}:`, error.message);
        }
      };

      try {
        const scraped = await task.scrape();
        if (!Array.isArray(scraped)) {
          throw new Error(`Scraper for ${task.sourceName} did not return an array.`);
        }
        const { rows, rejected, duplicates } = normalizeAndDeduplicate(
          scraped.map((row) => task.toInput(row)),
          datasetId
        );
        if (rejected.length > 0) {
          console.warn(`Rejected ${rejected.length} invalid row(s) for ${task.sourceName}:`, rejected.slice(0, 5));
        }
        if (duplicates > 0) {
          console.warn(`Deduplicated ${duplicates} row(s) for ${task.sourceName}.`);
        }

        const { added, updated } = await upsertBatches(client, datasetId, rows);
        totalIngested += rows.length;
        if (rows.length > 0) updatedDatasetIds.add(datasetId);
        sourceResults.push({
          source: task.sourceName,
          status: "completed",
          rows: rows.length,
          added,
          updated,
          rejected: rejected.length,
          duplicates,
        });
        await finishRun("completed", added, updated);
        console.log(`✓ ${task.sourceName}: ${rows.length} valid row(s), ${added} added, ${updated} updated.`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        sourceResults.push({
          source: task.sourceName,
          status: "failed",
          rows: 0,
          added: 0,
          updated: 0,
          rejected: 0,
          duplicates: 0,
        });
        await finishRun("failed", 0, 0, message);
        throw new Error(`Pipeline failed while ingesting ${TARGET_DATASET_SLUG} from ${task.sourceName}: ${message}`);
      }
    }

    console.log("⚡ Compiling and caching snapshot packages in Supabase Storage...");
    const snapshotResult = deps.buildSnapshots
      ? await deps.buildSnapshots()
      : await SnapshotBuilder.buildAllSnapshots();

    // Compatibility hook only: it no longer fabricates or stores telemetry counts.
    (deps.recordScrapeActivity ?? TelemetryService.recordScrapeActivity)(totalIngested);

    const durationMs = Date.now() - startTime;
    console.log(`\n🎉 Pipeline completed in ${(durationMs / 1000).toFixed(2)}s`);
    console.log(`   - Valid records ingested: ${totalIngested}`);
    console.log(`   - Snapshots uploaded: ${snapshotResult.totalSnapshotsCreated}`);

    return {
      status: "completed",
      totalIngested,
      datasetsUpdated: updatedDatasetIds.size,
      snapshotsCreated: snapshotResult.totalSnapshotsCreated,
      durationMs,
      sources: sourceResults,
    };
  }
}
