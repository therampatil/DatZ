import { test } from "node:test";
import assert from "node:assert/strict";

test("snapshot exports are machine-readable in all formats", async () => {
  // Force offline mode before loading the Supabase-backed modules.
  process.env.SUPABASE_URL = "";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "";
  process.env.SUPABASE_ANON_KEY = "";

  const { default: parquet } = await import("@dsnp/parquetjs");
  const {
    DownloadService,
    EXPORT_FIELDS,
    EXPORT_HEADERS,
    PARQUET_FIELD_TYPES,
  } = await import("../services/downloadService.js");
  const { DEFAULT_DATASETS, DatasetService } = await import("../services/datasetService.js");

  const request = { datasetSlug: "pune-real-estate-data", format: "csv" } as const;
  const options = { uploadToStorage: false, logDownloadOrder: false };

  for (const format of ["csv", "xlsx", "parquet"] as const) {
    const snapshot = await DownloadService.generateSnapshot({ ...request, format }, options);
    assert.ok(snapshot.buffer.length > 0, `${format} snapshot should contain bytes`);
  }

  const csv = await DownloadService.generateSnapshot(request, options);
  const csvText = csv.buffer.toString("utf8");
  const header = csvText.split(/\r?\n/)[0];
  const columns = header.split(",");

  assert.equal(EXPORT_FIELDS.length, 23);
  assert.deepEqual(columns, [...EXPORT_HEADERS]);
  assert.equal(columns.length, 23);
  assert.equal(columns[0], "#");
  for (const expected of [
    "#",
    "Rate / Sq Ft (INR)",
    "Price Change (%)",
    "Source URL",
    "Latitude",
    "Longitude",
  ]) {
    assert.ok(columns.includes(expected), `CSV header must include ${expected}`);
  }
  for (const removed of [
    "Carpet Area (sq ft)",
    "Built-Up Area (sq ft)",
    "Super Built-Up Area (sq ft)",
    "Configuration (BHK)",
    "Property Type",
    "Property Sub-Type",
    "Floor Number",
    "Total Floors",
    "Facing",
    "Parking Count",
    "Furnishing Status",
    "Listing Date",
    "Last Scraped / Updated At",
  ]) {
    assert.equal(columns.includes(removed), false, `CSV header must not include ${removed}`);
  }
  assert.doesNotMatch(csvText, /₹/, "export values must be raw numbers, not formatted strings");

  const expectedKeys = [
    "row_index", "property_id", "rera_id", "project_name", "builder_name", "locality", "city", "pin_code",
    "asking_price_inr", "price_per_sqft_inr", "previous_asking_price_inr", "price_change_amount_inr",
    "price_change_percent", "rera_status", "construction_stage", "possession_date", "status",
    "days_on_market", "listed_by", "listing_source", "source_url", "latitude", "longitude",
  ];
  assert.deepEqual(EXPORT_FIELDS.map((field) => field.key), expectedKeys);

  const parquetSnapshot = await DownloadService.generateSnapshot({ ...request, format: "parquet" }, options);
  assert.equal(parquetSnapshot.buffer.subarray(0, 4).toString("ascii"), "PAR1");

  const reader = await parquet.ParquetReader.openBuffer(parquetSnapshot.buffer);
  try {
    const schemaFields = reader.getSchema().fields;
    assert.equal(Object.keys(schemaFields).length, 23);
    for (const field of EXPORT_FIELDS) {
      if (field.parquetType === "INT64" || field.parquetType === "DOUBLE") {
        assert.equal(schemaFields[field.key]?.primitiveType, field.parquetType, `${field.key} parquet type`);
      }
      assert.equal(PARQUET_FIELD_TYPES[field.key], field.parquetType);
    }
    assert.equal(schemaFields.row_index?.primitiveType, "INT64");
    assert.equal(schemaFields.asking_price_inr?.primitiveType, "DOUBLE");
  } finally {
    await reader.close();
  }

  assert.equal(DEFAULT_DATASETS.length, 1);
  assert.equal(DEFAULT_DATASETS[0].slug, "pune-real-estate-data");
  assert.equal(DEFAULT_DATASETS[0].title, "Pune Real Estate Data");
  assert.equal(DEFAULT_DATASETS[0].fields_count, 23);
  assert.equal(DEFAULT_DATASETS[0].record_count, 0);

  const previewData = await DatasetService.getDatasetPreview("pune-real-estate-data");
  assert.ok(previewData);
  assert.equal(previewData.metrics.total_records, previewData.preview.length);
});
