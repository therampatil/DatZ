import "dotenv/config";
import { supabase, isSupabaseConfigured } from "./supabase.js";
import type { DatasetModel, ListedBy } from "../types/dataset.js";

function computePriceChange(askingPrice: number | null, previousAskingPrice: number | null): {
  amount: number | null;
  percent: number | null;
} {
  if (askingPrice === null || previousAskingPrice === null || previousAskingPrice <= 0) {
    return { amount: null, percent: null };
  }
  const amount = Math.round((askingPrice - previousAskingPrice) * 100) / 100;
  const percent = Math.round((amount / previousAskingPrice) * 10_000) / 100;
  return { amount, percent };
}

/** The only catalog entry seeded after migration 003. */
const PUNE_REAL_ESTATE_DATASET: DatasetModel = {
  id: "d1010000-0000-0000-0000-000000000001",
  slug: "pune-real-estate-data",
  code: "PR",
  title: "Pune Real Estate Data",
  description:
    "Verified Pune residential property listings from public RERA filings and configured listing sources.",
  category: "Residential Real Estate",
  geography: "Pune, Maharashtra",
  fields_count: 23,
  coverage: "Pune, Maharashtra",
  snapshot_price: 8500,
  monthly_price: 24000,
  frequency: "Real-Time",
  record_count: 0,
  added_tag: "",
  updated_tag: "",
  attributes: [
    "RERA registration ID",
    "Project & promoter",
    "Locality, district & pin code",
    "Carpet area (sq.ft)",
    "Built-up / super built-up area (sq.ft)",
    "Configuration & property type",
    "Floor number & total floors",
    "Facing & parking count",
    "Furnishing status",
    "Asking price (INR)",
    "Previous asking price & price change",
    "Construction stage & possession date",
    "Listed by (owner / builder / broker / agent)",
    "Source URL & latitude / longitude",
    "Listing status & days on market",
    "Quality score & verification flags",
  ],
  use_cases: [
    "Track Pune asking-price changes and price drops",
    "Compare RERA-registered projects with direct listing inventory",
    "Map property supply by locality, configuration and construction stage",
  ],
  sources: ["MahaRERA public registry", "Configured Pune listing sources"],
  is_published: true,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

interface SeedProperty {
  external_id: string;
  project_name: string;
  builder_name: string;
  city: string;
  locality: string;
  location: string;
  pin_code: string;
  carpet_area_sqft: number;
  built_up_area_sqft: number;
  super_built_up_area_sqft: number;
  configuration: string;
  property_type: string;
  property_sub_type: string;
  floor_number: number;
  total_floors: number;
  facing: string;
  parking_count: number;
  furnishing_status: string;
  asking_price: number;
  previous_asking_price: number;
  construction_stage: string;
  possession_date: string;
  listed_by: ListedBy;
  source_url: string;
  latitude: number;
  longitude: number;
  rera_id: string;
  listing_timestamp: string;
  days_on_market: number;
}

// Every row is explicitly a sample: real-looking Pune values, but IDs and
// project names are prefixed/suffixed so they can never be mistaken for live
// registry records.
const sampleProperties: SeedProperty[] = [
  {
    external_id: "SAMPLE-PUNE-001",
    project_name: "Godrej Horizon (Sample)",
    builder_name: "Godrej Properties",
    city: "Pune",
    locality: "Baner",
    location: "Baner, Pune",
    pin_code: "411045",
    carpet_area_sqft: 1182,
    built_up_area_sqft: 1395,
    super_built_up_area_sqft: 1596,
    configuration: "2 BHK",
    property_type: "Residential",
    property_sub_type: "Apartment",
    floor_number: 6,
    total_floors: 14,
    facing: "East",
    parking_count: 1,
    furnishing_status: "Semi-Furnished",
    asking_price: 14800000,
    previous_asking_price: 15300000,
    construction_stage: "Ready to Move",
    possession_date: "2026-03-31",
    listed_by: "builder",
    source_url: "https://maharera.maharashtra.gov.in/project/P52100048211",
    latitude: 18.5595,
    longitude: 73.7791,
    rera_id: "P52100048211",
    listing_timestamp: "2026-01-06T00:00:00.000Z",
    days_on_market: 12,
  },
  {
    external_id: "SAMPLE-PUNE-002",
    project_name: "Birla Pravaah (Sample)",
    builder_name: "Birla Estates",
    city: "Pune",
    locality: "Balewadi",
    location: "Balewadi, Pune",
    pin_code: "411045",
    carpet_area_sqft: 1420,
    built_up_area_sqft: 1676,
    super_built_up_area_sqft: 1917,
    configuration: "3 BHK",
    property_type: "Residential",
    property_sub_type: "Apartment",
    floor_number: 9,
    total_floors: 18,
    facing: "North",
    parking_count: 2,
    furnishing_status: "Unfurnished",
    asking_price: 18200000,
    previous_asking_price: 19000000,
    construction_stage: "Under Construction",
    possession_date: "2027-06-30",
    listed_by: "builder",
    source_url: "https://maharera.maharashtra.gov.in/project/P52100051907",
    latitude: 18.5512,
    longitude: 73.7638,
    rera_id: "P52100051907",
    listing_timestamp: "2026-01-09T00:00:00.000Z",
    days_on_market: 9,
  },
  {
    external_id: "SAMPLE-PUNE-003",
    project_name: "Kalpataru Jade Residences (Sample)",
    builder_name: "Kalpataru Limited",
    city: "Pune",
    locality: "Wakad",
    location: "Wakad, Pune",
    pin_code: "411057",
    carpet_area_sqft: 986,
    built_up_area_sqft: 1164,
    super_built_up_area_sqft: 1331,
    configuration: "2 BHK",
    property_type: "Residential",
    property_sub_type: "Apartment",
    floor_number: 3,
    total_floors: 12,
    facing: "West",
    parking_count: 1,
    furnishing_status: "Furnished",
    asking_price: 11200000,
    previous_asking_price: 11200000,
    construction_stage: "Near Possession",
    possession_date: "2026-09-30",
    listed_by: "owner",
    source_url: "https://maharera.maharashtra.gov.in/project/P52100049028",
    latitude: 18.5912,
    longitude: 73.7380,
    rera_id: "P52100049028",
    listing_timestamp: "2025-12-15T00:00:00.000Z",
    days_on_market: 34,
  },
  {
    external_id: "SAMPLE-PUNE-004",
    project_name: "Gera World of Joy (Sample)",
    builder_name: "Gera Developments",
    city: "Pune",
    locality: "Baner",
    location: "Baner, Pune",
    pin_code: "411045",
    carpet_area_sqft: 1310,
    built_up_area_sqft: 1546,
    super_built_up_area_sqft: 1769,
    configuration: "3 BHK",
    property_type: "Residential",
    property_sub_type: "Apartment",
    floor_number: 11,
    total_floors: 22,
    facing: "South",
    parking_count: 2,
    furnishing_status: "Semi-Furnished",
    asking_price: 17100000,
    previous_asking_price: 17800000,
    construction_stage: "Ready to Move",
    possession_date: "2026-12-31",
    listed_by: "broker",
    source_url: "https://maharera.maharashtra.gov.in/project/P52100052631",
    latitude: 18.5638,
    longitude: 73.7712,
    rera_id: "P52100052631",
    listing_timestamp: "2025-12-12T00:00:00.000Z",
    days_on_market: 37,
  },
  {
    external_id: "SAMPLE-PUNE-005",
    project_name: "Lodha Bellevue (Sample)",
    builder_name: "Lodha Group",
    city: "Pune",
    locality: "Kharadi",
    location: "Kharadi, Pune",
    pin_code: "411014",
    carpet_area_sqft: 1564,
    built_up_area_sqft: 1846,
    super_built_up_area_sqft: 2111,
    configuration: "3 BHK",
    property_type: "Residential",
    property_sub_type: "Apartment",
    floor_number: 14,
    total_floors: 25,
    facing: "North East",
    parking_count: 2,
    furnishing_status: "Unfurnished",
    asking_price: 20800000,
    previous_asking_price: 21500000,
    construction_stage: "Under Construction",
    possession_date: "2028-03-31",
    listed_by: "agent",
    source_url: "https://maharera.maharashtra.gov.in/project/P52100051380",
    latitude: 18.5362,
    longitude: 73.9521,
    rera_id: "P52100051380",
    listing_timestamp: "2026-01-01T00:00:00.000Z",
    days_on_market: 28,
  },
];

async function seed() {
  if (!isSupabaseConfigured() || !supabase) {
    console.error("Supabase is not configured. Check .env file.");
    process.exit(1);
  }

  console.log(`Connecting to Supabase at: ${process.env.SUPABASE_URL}`);

  const { error: datasetError } = await supabase
    .from("datasets")
    .upsert(PUNE_REAL_ESTATE_DATASET, { onConflict: "slug" });
  if (datasetError) {
    console.error(`Error seeding dataset ${PUNE_REAL_ESTATE_DATASET.slug}:`, datasetError.message);
  } else {
    console.log(`✓ Seeded dataset: ${PUNE_REAL_ESTATE_DATASET.title} (${PUNE_REAL_ESTATE_DATASET.code})`);
  }

  // Seed sample properties with complete Pune real estate fields
  let seededProperties = 0;
  for (const prop of sampleProperties) {
    const priceChange = computePriceChange(prop.asking_price, prop.previous_asking_price);
    const pricePerSqft = prop.carpet_area_sqft > 0 ? Math.round(prop.asking_price / prop.carpet_area_sqft) : null;
    const row = {
      dataset_id: PUNE_REAL_ESTATE_DATASET.id,
      external_id: prop.external_id,
      project_name: prop.project_name,
      builder_name: prop.builder_name,
      city: prop.city,
      locality: prop.locality,
      location: prop.location,
      pin_code: prop.pin_code,
      carpet_area_sqft: prop.carpet_area_sqft,
      asking_price: prop.asking_price,
      price_per_sqft: pricePerSqft,
      built_up_area_sqft: prop.built_up_area_sqft,
      super_built_up_area_sqft: prop.super_built_up_area_sqft,
      configuration: prop.configuration,
      property_type: prop.property_type,
      property_sub_type: prop.property_sub_type,
      floor_number: prop.floor_number,
      total_floors: prop.total_floors,
      facing: prop.facing,
      parking_count: prop.parking_count,
      furnishing_status: prop.furnishing_status,
      previous_asking_price: prop.previous_asking_price,
      price_change_amount: priceChange.amount,
      price_change_percent: priceChange.percent,
      construction_stage: prop.construction_stage,
      possession_date: prop.possession_date,
      listed_by: prop.listed_by,
      source_url: prop.source_url,
      latitude: prop.latitude,
      longitude: prop.longitude,
      listing_source: "MahaRERA Official Registry",
      rera_status: "Registered",
      rera_id: prop.rera_id,
      status: "Active",
      listing_timestamp: prop.listing_timestamp,
      days_on_market: prop.days_on_market,
      quality_score: 95,
      is_verified: true,
      is_public_preview: true,
      raw_payload: { sampleData: true, datasetSlug: PUNE_REAL_ESTATE_DATASET.slug },
      source_filing_url: prop.source_url,
    };

    const { error } = await supabase.from("properties").upsert(row, {
      onConflict: "dataset_id,external_id",
    });
    if (error) {
      console.warn(`Error seeding property ${prop.external_id}:`, error.message);
    } else {
      seededProperties++;
    }
  }
  console.log(`✓ Seeded ${seededProperties} sample properties`);

  // A single official source matches the source name used for scraper_runs.
  const dataSources = [
    { name: "MahaRERA Official Registry", base_url: "https://maharera.maharashtra.gov.in", category: "RERA" },
    {
      name: "SquareYards Pune Sale Feed",
      base_url: "https://www.squareyards.com/sale/property-for-sale-in-pune",
      category: "LISTINGS",
    },
  ];

  for (const source of dataSources) {
    const { error } = await supabase.from("data_sources").upsert(source, { onConflict: "name" });
    if (error) console.warn("Error seeding source:", error.message);
  }
  console.log(`✓ Seeded ${dataSources.length} data source`);

  console.log("\n🚀 Supabase database seeding complete!");
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
