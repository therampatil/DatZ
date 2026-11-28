import ExcelJS from "exceljs";
import parquet from "@dsnp/parquetjs";
import { stringify } from "csv-stringify/sync";
import { supabase, isSupabaseConfigured, createSignedSnapshotUrl, uploadSnapshotToSupabase } from "../db/supabase.js";
import { DatasetService } from "./datasetService.js";
import { PropertyDataRow } from "../types/dataset.js";

export interface GeneratedSnapshot {
  fileName: string;
  contentType: string;
  buffer: Buffer;
  downloadUrl?: string;
  recordCount: number;
  sample: boolean;
}

export interface SnapshotGenerationOptions {
  /** Upload the generated file to Supabase Storage (default: true). */
  uploadToStorage?: boolean;
  /** Insert a pending (unpaid) order row. Never logs a fulfilled order (default: false). */
  logDownloadOrder?: boolean;
  /** Cap the number of exported rows (used for public samples). */
  maxRows?: number;
  /** Mark the export as a sample in its filename and result metadata. */
  sample?: boolean;
}

/** Raw, machine-readable export values. No display formatting (₹, commas, etc.). */
export interface ExportRow {
  row_index: number;
  property_id: string | null;
  rera_id: string | null;
  project_name: string | null;
  builder_name: string | null;
  locality: string | null;
  city: string | null;
  pin_code: string | null;
  asking_price_inr: number | null;
  price_per_sqft_inr: number | null;
  previous_asking_price_inr: number | null;
  price_change_amount_inr: number | null;
  price_change_percent: number | null;
  rera_status: string | null;
  construction_stage: string | null;
  possession_date: string | null;
  status: string | null;
  days_on_market: number | null;
  listed_by: string | null;
  listing_source: string | null;
  source_url: string | null;
  latitude: number | null;
  longitude: number | null;
}

export type ExportRowKey = keyof ExportRow;
export type ExportFieldType = "UTF8" | "INT64" | "DOUBLE";

export interface ExportFieldDefinition {
  key: ExportRowKey;
  header: string;
  parquetType: ExportFieldType;
  width: number;
}

/**
 * The single source of truth for the 23-column export schema. CSV, XLSX and
 * Parquet are all generated from this list so their column order and types
 * cannot drift. Exported so tests can assert the exact header/type contract.
 */
export const EXPORT_FIELDS = [
  { key: "row_index", header: "#", parquetType: "INT64", width: 8 },
  { key: "property_id", header: "Property ID", parquetType: "UTF8", width: 18 },
  { key: "rera_id", header: "RERA ID", parquetType: "UTF8", width: 18 },
  { key: "project_name", header: "Project Name", parquetType: "UTF8", width: 28 },
  { key: "builder_name", header: "Builder / Promoter", parquetType: "UTF8", width: 24 },
  { key: "locality", header: "Locality", parquetType: "UTF8", width: 20 },
  { key: "city", header: "City", parquetType: "UTF8", width: 14 },
  { key: "pin_code", header: "Pin Code", parquetType: "UTF8", width: 12 },
  { key: "asking_price_inr", header: "Asking Price (INR)", parquetType: "DOUBLE", width: 20 },
  { key: "price_per_sqft_inr", header: "Rate / Sq Ft (INR)", parquetType: "DOUBLE", width: 20 },
  { key: "previous_asking_price_inr", header: "Previous Asking Price (INR)", parquetType: "DOUBLE", width: 26 },
  { key: "price_change_amount_inr", header: "Price Change Amount (INR)", parquetType: "DOUBLE", width: 26 },
  { key: "price_change_percent", header: "Price Change (%)", parquetType: "DOUBLE", width: 18 },
  { key: "rera_status", header: "RERA Status", parquetType: "UTF8", width: 22 },
  { key: "construction_stage", header: "Construction Stage", parquetType: "UTF8", width: 20 },
  { key: "possession_date", header: "Possession / Completion Date", parquetType: "UTF8", width: 26 },
  { key: "status", header: "Market Status", parquetType: "UTF8", width: 18 },
  { key: "days_on_market", header: "DOM (Days on Market)", parquetType: "DOUBLE", width: 20 },
  { key: "listed_by", header: "Listed By", parquetType: "UTF8", width: 14 },
  { key: "listing_source", header: "Listing Source", parquetType: "UTF8", width: 24 },
  { key: "source_url", header: "Source URL", parquetType: "UTF8", width: 36 },
  { key: "latitude", header: "Latitude", parquetType: "DOUBLE", width: 14 },
  { key: "longitude", header: "Longitude", parquetType: "DOUBLE", width: 14 },
] as const satisfies readonly ExportFieldDefinition[];

/** Ordered CSV/XLSX header row, exported for header assertions. */
export const EXPORT_HEADERS: readonly string[] = EXPORT_FIELDS.map((field) => field.header);

/** Key -> physical Parquet type, exported for schema assertions. */
export const PARQUET_FIELD_TYPES: Readonly<Record<ExportRowKey, ExportFieldType>> = Object.fromEntries(
  EXPORT_FIELDS.map((field) => [field.key, field.parquetType])
) as Record<ExportRowKey, ExportFieldType>;

/** Minimal writable stream that accumulates Parquet output in memory. */
class InMemoryWriteStream {
  private readonly chunks: Buffer[] = [];

  write(chunk: Buffer, callback: (error?: Error | null) => void): boolean {
    this.chunks.push(Buffer.from(chunk));
    callback(null);
    return true;
  }

  end(callback: (error?: Error | null) => void): void {
    callback(null);
  }

  toBuffer(): Buffer {
    return Buffer.concat(this.chunks);
  }
}

/** Supabase may return NUMERIC columns as numbers or strings. */
function numericOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function textOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value);
  return text.length > 0 ? text : null;
}

/** ISO timestamps/dates pass through unchanged; Date objects are serialised. */
function isoTextOrNull(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

/**
 * Builds a raw export row. Missing database values stay null so consumers can
 * distinguish absent data from fabricated defaults. `row_index` is generated
 * here as a 1-based ordinal and never read from the database.
 */
export function toExportRow(row: PropertyDataRow, index: number): ExportRow {
  // Widened access keeps this compatible while the typed row shape evolves.
  const raw = row as PropertyDataRow & Record<string, unknown>;

  return {
    row_index: index + 1,
    property_id: textOrNull(raw.external_id),
    rera_id: textOrNull(raw.rera_id),
    project_name: textOrNull(raw.project_name),
    builder_name: textOrNull(raw.builder_name),
    locality: textOrNull(raw.locality),
    city: textOrNull(raw.city),
    pin_code: textOrNull(raw.pin_code),
    asking_price_inr: numericOrNull(raw.asking_price),
    price_per_sqft_inr: numericOrNull(raw.price_per_sqft),
    previous_asking_price_inr: numericOrNull(raw.previous_asking_price),
    price_change_amount_inr: numericOrNull(raw.price_change_amount),
    price_change_percent: numericOrNull(raw.price_change_percent),
    rera_status: textOrNull(raw.rera_status),
    construction_stage: textOrNull(raw.construction_stage),
    possession_date: isoTextOrNull(raw.possession_date),
    status: textOrNull(raw.status),
    days_on_market: numericOrNull(raw.days_on_market),
    listed_by: textOrNull(raw.listed_by),
    listing_source: textOrNull(raw.listing_source),
    source_url: textOrNull(raw.source_url),
    latitude: numericOrNull(raw.latitude),
    longitude: numericOrNull(raw.longitude),
  };
}

/** Physical Parquet schema derived from EXPORT_FIELDS. */
export function buildParquetSchema(): parquet.ParquetSchema {
  const definition: Record<string, { type: ExportFieldType; optional: boolean }> = {};
  for (const field of EXPORT_FIELDS) {
    definition[field.key] = {
      type: field.parquetType,
      // Only the generated ordinal is always present; real DB values may be null.
      optional: field.key !== "row_index",
    };
  }
  return new parquet.ParquetSchema(definition);
}

export class DownloadService {
  /**
   * Generates a snapshot file in CSV, XLSX, or Parquet from the full dataset
   * (not just preview rows), applying optional city and date filters.
   */
  static async generateSnapshot(
    input: {
      datasetSlug: string;
      format: "csv" | "xlsx" | "parquet";
      city?: string;
      from?: string;
      to?: string;
      customerEmail?: string;
    },
    options: SnapshotGenerationOptions = {}
  ): Promise<GeneratedSnapshot> {
    const { uploadToStorage = true, logDownloadOrder = false, maxRows, sample = false } = options;

    const dataset = await DatasetService.getDatasetBySlug(input.datasetSlug);
    if (!dataset) {
      throw new Error(`Dataset not found: ${input.datasetSlug}`);
    }

    const allRows = await DatasetService.getDatasetRecords(input.datasetSlug, {
      city: input.city,
      from: input.from,
      to: input.to,
    });
    const rows = typeof maxRows === "number" ? allRows.slice(0, Math.max(0, Math.floor(maxRows))) : allRows;
    const exportRows = rows.map(toExportRow);

    const timestamp = new Date().toISOString().split("T")[0];
    const fileName = `${dataset.slug}-${timestamp}${sample ? "-sample" : ""}.${input.format}`;

    let buffer: Buffer;
    let contentType: string;

    if (input.format === "csv") {
      contentType = "text/csv";
      buffer = Buffer.from(
        stringify(exportRows, {
          header: true,
          columns: EXPORT_FIELDS.map(({ key, header }) => ({ key, header })),
        })
      );
    } else if (input.format === "xlsx") {
      contentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      const workbook = new ExcelJS.Workbook();
      workbook.creator = "DatZ Data Platform";
      workbook.created = new Date();
      const sheet = workbook.addWorksheet(dataset.code || "Snapshot");

      // Numeric fields are written as numbers; numFmt only controls display.
      sheet.columns = EXPORT_FIELDS.map(({ key, header, width, parquetType }) => ({
        header,
        key,
        width,
        numFmt: parquetType === "DOUBLE" ? "0.00" : undefined,
      }));
      sheet.addRows(exportRows);
      sheet.views = [{ state: "frozen", ySplit: 1 }];
      sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
      sheet.getRow(1).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF1E293B" },
      };

      buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    } else {
      contentType = "application/vnd.apache.parquet";
      const schema = buildParquetSchema();

      const collector = new InMemoryWriteStream();
      const writer = await parquet.ParquetWriter.openStream(
        schema,
        collector as unknown as Parameters<typeof parquet.ParquetWriter.openStream>[1]
      );
      for (const row of exportRows) {
        await writer.appendRow(row as unknown as Record<string, unknown>);
      }
      await writer.close();
      buffer = collector.toBuffer();
    }

    let downloadUrl: string | undefined;

    if (isSupabaseConfigured() && supabase) {
      if (uploadToStorage) {
        const storagePath = `snapshots/${dataset.slug}/${fileName}`;
        const uploadResult = await uploadSnapshotToSupabase(storagePath, buffer, contentType);
        if (uploadResult) {
          downloadUrl = (await createSignedSnapshotUrl(storagePath, 3600)) || undefined;
        }
      }

      if (logDownloadOrder) {
        try {
          // Snapshot generation never fulfils an order. Only a pending, unpaid
          // row may be created here; authorization happens in OrderService.
          await supabase.from("download_orders").insert({
            dataset_id: dataset.id,
            customer_email: input.customerEmail || "anonymous@datz.internal",
            format: input.format,
            filters: { city: input.city, from: input.from, to: input.to },
            amount_paid: 0,
            payment_provider: "sandbox",
            status: "pending",
            payment_status: "unpaid",
          });
        } catch (dbErr) {
          console.warn("Could not log order to Supabase DB:", dbErr);
        }
      }
    }

    return {
      fileName,
      contentType,
      buffer,
      downloadUrl,
      recordCount: rows.length,
      sample,
    };
  }
}
