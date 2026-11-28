import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Force offline mode before any Supabase-backed module is dynamically imported.
process.env.SUPABASE_URL = "";
process.env.SUPABASE_SERVICE_ROLE_KEY = "";
process.env.SUPABASE_ANON_KEY = "";
process.env.DATZ_FIXTURE_MODE = "true";

const ORIGINAL_ENV = {
  DATZ_FIXTURE_MODE: process.env.DATZ_FIXTURE_MODE,
  DATZ_LISTING_SOURCES: process.env.DATZ_LISTING_SOURCES,
  DATZ_LISTING_MAX_PAGES: process.env.DATZ_LISTING_MAX_PAGES,
  MAHARERA_SEARCH_TERMS: process.env.MAHARERA_SEARCH_TERMS,
};

after(() => {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

const RERA_HTML = `
<div class="project-card">
  <p class="p-0"># P50500004427</p>
  <h4 class="title4"><strong>Godrej Anandam </strong></h4>
  <p class="darkBlue bold ">Godrej Properties Limited</p>
  <a href="/project-details/P50500004427">View filing</a>
  <a href="https://www.google.com/maps?output=embed&amp;query=21.1484602,79.0955723">Map</a>
  <div class="greyColor">Pincode</div><p>440018</p>
  <div class="greyColor">District</div><p>Nagpur</p>
  <div class="greyColor">Taluka</div><p>Nagpur</p>
  <div class="greyColor">Locality</div><p>Magarpatta City</p>
  <div class="greyColor">Last Modified</div><p>2017-08-09</p>
  <div class="greyColor">Built Up Area</div><p>1,182 sq ft</p>
  <div class="greyColor">Super Built Up Area</div><p>1,395 sq ft</p>
  <div class="greyColor">Configuration</div><p>2 BHK</p>
  <div class="greyColor">Property Type</div><p>Residential</p>
  <div class="greyColor">Property Sub Type</div><p>Apartment</p>
  <div class="greyColor">Floor</div><p>6 of 14</p>
  <div class="greyColor">Facing</div><p>East</p>
  <div class="greyColor">Parking</div><p>1 covered</p>
  <div class="greyColor">Furnishing</div><p>Semi-Furnished</p>
  <div class="greyColor">Previous Asking Price</div><p>₹1.53 Cr</p>
  <div class="greyColor">Estimated Cost</div><p>₹1.48 Cr</p>
  <div class="greyColor">Construction Stage</div><p>Ready to Move</p>
  <div class="greyColor">Possession Date</div><p>2026-12-31</p>
</div>`;

const SQUAREYARDS_URL =
  "https://www.squareyards.com/resale-2-bhk-1160-sq-ft-apartment-in-kolte-patil-margosa-heights/10707136";

const SQUAREYARDS_HTML = `
  <article class="listing-card single-box-conversion" propertyid="10707136">
    <div class="favorite-btn" data-price="11000000" data-city="Pune"
      data-sublocalityname="Mohammadwadi" data-locality="Mohammadwadi, Pune"
      data-unittype="2 BHK" data-url="${SQUAREYARDS_URL}" data-type="resale"
      data-propstatus="Ready To Move" data-propertytype="Apartment"
      data-user-type="Owner"></div>
    <div class="listing-body">
      <span class="project-name">Kolte Patil Margosa Heights</span>
      <h2 class="heading"><span data-url="${SQUAREYARDS_URL}">2 BHK Flat for Sale in Mohammadwadi, Pune</span>
        <small class="map-cta" data-lat="18.4722439095689" data-long="73.9237586892774"></small>
      </h2>
      <p class="listing-price"><strong>₹ 1.1 Cr</strong></p>
      <dl class="listing-attributes">
        <div class="attribute-item"><dt><em></em>Config</dt><dd>2 BHK + 2 Bath</dd></div>
        <div class="attribute-item"><dt><em></em>Area</dt><dd><div class="unit-value avail-area" data-area="1160">1160 Sq.Ft.</div></dd></div>
        <div class="attribute-item"><dt><em></em>Facing</dt><dd>East Facing</dd></div>
        <div class="attribute-item"><dt><em></em>Floor</dt><dd>7th of 7 Floors</dd></div>
      </dl>
    </div>
  </article>`;

test("MahaRERA parser reads real search-card fields including map coordinates", async () => {
  const { MahaRERAScraper } = await import("../scrapers/mahareraScraper.js");
  const [project] = MahaRERAScraper.parseSearchResults(
    RERA_HTML,
    "https://www.maharera.maharashtra.gov.in/projects-search-result?project_name=Godrej&project_state=27"
  );

  assert.ok(project, "a project card should be parsed");
  assert.equal(project.reraId, "P50500004427");
  assert.equal(project.projectName, "Godrej Anandam");
  assert.equal(project.promoterName, "Godrej Properties Limited");
  assert.equal(project.district, "Nagpur");
  assert.equal(project.locality, "Magarpatta City");
  assert.equal(project.pinCode, "440018");
  assert.equal(project.approvalDate, "2017-08-09");
  assert.equal(project.listingTimestamp, "2017-08-09T00:00:00.000Z");
  assert.match(project.sourceFilingUrl, /P50500004427/);
  assert.equal(project.sourceUrl, project.sourceFilingUrl);
  assert.equal(project.listedBy, "builder");

  assert.equal(project.builtUpAreaSqft, 1182);
  assert.equal(project.superBuiltUpAreaSqft, 1395);
  assert.equal(project.configuration, "2 BHK");
  assert.equal(project.propertyType, "Residential");
  assert.equal(project.propertySubType, "Apartment");
  assert.equal(project.floorNumber, 6);
  assert.equal(project.totalFloors, 14);
  assert.equal(project.facing, "East");
  assert.equal(project.parkingCount, 1);
  assert.equal(project.furnishingStatus, "Semi-Furnished");
  assert.equal(project.previousAskingPrice, 15_300_000);
  assert.equal(project.priceChangeAmount, -500_000);
  assert.equal(project.priceChangePercent, -3.27);
  assert.equal(project.constructionStage, "Ready to Move");
  assert.equal(project.possessionDate, "2026-12-31");
  assert.equal(project.latitude, 21.1484602);
  assert.equal(project.longitude, 79.0955723);

  const minimal = MahaRERAScraper.parseSearchResults(`
    <div class="project-card">
      <h4 class="title4">Minimal Project</h4>
      <p># P50500009999</p>
    </div>`);
  assert.equal(minimal.length, 1);
  assert.equal(minimal[0].builtUpAreaSqft, null);
  assert.equal(minimal[0].latitude, null);
  assert.equal(minimal[0].longitude, null);
  assert.equal(minimal[0].sourceUrl, "");
  assert.equal(MahaRERAScraper.parseSearchResults("<html><body>unrelated</body></html>").length, 0);
});

test("fixture mode scrapers are deterministic and populate the new fields", async () => {
  process.env.DATZ_FIXTURE_MODE = "true";
  const { MahaRERAScraper } = await import("../scrapers/mahareraScraper.js");
  const { PropertyListingsScraper } = await import("../scrapers/propertyListingsScraper.js");

  const first = await MahaRERAScraper.scrapeCommercialProjects();
  const second = await MahaRERAScraper.scrapeCommercialProjects();
  assert.ok(first.length > 0);
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.equal(first[0].listingTimestamp, new Date(first[0].approvalDate).toISOString());
  assert.equal(first[0].listedBy, "builder");
  assert.ok(first[0].builtUpAreaSqft !== null && first[0].builtUpAreaSqft > 0);
  assert.ok(first[0].latitude !== null && first[0].longitude !== null);

  const listingsA = await PropertyListingsScraper.scrapeResidentialListings();
  const listingsB = await PropertyListingsScraper.scrapeResidentialListings();
  assert.ok(listingsA.length > 0);
  assert.equal(JSON.stringify(listingsA), JSON.stringify(listingsB));
  assert.ok(listingsA.every((listing) => listing.city === "Pune"));
  assert.ok(listingsA.every((listing) => listing.builtUpAreaSqft !== null));
  assert.ok(listingsA.every((listing) => listing.latitude !== null && listing.longitude !== null));
});

test("live listing scraper uses the built-in SquareYards feed when no sources are configured", async () => {
  delete process.env.DATZ_FIXTURE_MODE;
  process.env.DATZ_LISTING_SOURCES = "";
  process.env.DATZ_LISTING_MAX_PAGES = "1";
  const { PropertyListingsScraper } = await import("../scrapers/propertyListingsScraper.js");

  const originalFetch = globalThis.fetch;
  const originalLog = console.log;
  const logs: string[] = [];
  globalThis.fetch = (async () => new Response(SQUAREYARDS_HTML, { status: 200 })) as typeof fetch;
  console.log = (...args: unknown[]) => { logs.push(args.join(" ")); };
  try {
    const rows = await PropertyListingsScraper.scrapeResidentialListings();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].externalId, "10707136");
    assert.equal(rows[0].locality, "Mohammadwadi");
    assert.ok(logs.some((message) => message.includes("SquareYards")), "built-in feed should be logged");
  } finally {
    globalThis.fetch = originalFetch;
    console.log = originalLog;
    delete process.env.DATZ_LISTING_MAX_PAGES;
  }
});

test("configured listing HTML is parsed into normalized rows", async () => {
  process.env.DATZ_FIXTURE_MODE = "true";
  const { PropertyListingsScraper } = await import("../scrapers/propertyListingsScraper.js");
  const source = {
    slug: "owner-direct",
    url: "https://example.com/listings",
    dataset: "pune-real-estate-data",
    selectors: {
      card: ".listing",
      title: ".title",
      price: ".price",
      area: ".area",
      location: ".loc",
      built_up: ".builtup",
      super_built_up: ".superbuiltup",
      configuration: ".config",
      property_type: ".ptype",
      property_sub_type: ".subtype",
      floor: ".floor",
      facing: ".facing",
      parking: ".parking",
      furnishing: ".furnishing",
      previous_price: ".prevprice",
      construction_stage: ".stage",
      possession_date: ".possession",
      listed_by: ".listedby",
      source_url: ".detail",
      latitude: ".lat",
      longitude: ".lng",
    },
  };
  const html = `
    <div class="listing" data-id="L-1">
      <h3 class="title">Godrej Horizon</h3>
      <span class="price">₹1.48 Cr</span>
      <span class="area">1,182 sq ft</span>
      <span class="loc">Baner, Pune 411045</span>
      <span class="builtup">1,395 sq ft</span>
      <span class="superbuiltup">1,596 sq ft</span>
      <span class="config">2 BHK</span>
      <span class="ptype">Residential</span>
      <span class="subtype">Apartment</span>
      <span class="floor">6 of 14</span>
      <span class="facing">East</span>
      <span class="parking">1 covered</span>
      <span class="furnishing">Semi-Furnished</span>
      <span class="prevprice">₹1.53 Cr</span>
      <span class="stage">Ready to Move</span>
      <span class="possession">2026-12-31</span>
      <span class="listedby">Builder</span>
      <a class="detail" href="/property/l-1">Details</a>
      <a href="https://www.google.com/maps?query=18.5590,73.7868">Map</a>
      <span class="lat">18.5590</span>
      <span class="lng">73.7868</span>
    </div>
    <div class="listing" data-id="L-2">
      <h3 class="title">Minimal Listing</h3>
      <span class="price">₹85 L</span>
      <span class="area">900 sq ft</span>
      <span class="loc">Wakad, Pune 411057</span>
    </div>`;
  const [listing, minimal] = PropertyListingsScraper.parseListingHtml(html, source);

  assert.ok(listing);
  assert.equal(listing.externalId, "L-1");
  assert.equal(listing.askingPrice, 14_800_000);
  assert.equal(listing.carpetAreaSqft, 1182);
  assert.equal(listing.pricePerSqft, 12_521);
  assert.equal(listing.city, "Pune");
  assert.equal(listing.pinCode, "411045");
  assert.equal(listing.builtUpAreaSqft, 1395);
  assert.equal(listing.superBuiltUpAreaSqft, 1596);
  assert.equal(listing.configuration, "2 BHK");
  assert.equal(listing.propertyType, "Residential");
  assert.equal(listing.propertySubType, "Apartment");
  assert.equal(listing.floorNumber, 6);
  assert.equal(listing.totalFloors, 14);
  assert.equal(listing.facing, "East");
  assert.equal(listing.parkingCount, 1);
  assert.equal(listing.furnishingStatus, "Semi-Furnished");
  assert.equal(listing.previousAskingPrice, 15_300_000);
  assert.equal(listing.priceChangeAmount, -500_000);
  assert.equal(listing.priceChangePercent, -3.27);
  assert.equal(listing.constructionStage, "Ready to Move");
  assert.equal(listing.possessionDate, "2026-12-31");
  assert.equal(listing.listedBy, "builder");
  assert.equal(listing.sourceUrl, "https://example.com/property/l-1");
  assert.equal(listing.latitude, 18.5590);
  assert.equal(listing.longitude, 73.7868);

  assert.ok(minimal);
  assert.equal(minimal.builtUpAreaSqft, null);
  assert.equal(minimal.listedBy, null);
  assert.equal(minimal.sourceUrl, null);
  assert.equal(minimal.latitude, null);
  assert.equal(minimal.longitude, null);
});

test("MahaRERA parser keeps fields from sibling columns in the live markup", async () => {
  const { MahaRERAScraper } = await import("../scrapers/mahareraScraper.js");
  const [project] = MahaRERAScraper.parseSearchResults(`
    <div class="row shadow p-3 mb-5 bg-body rounded">
      <div class="col-xl-4">
        <p class="p-0"># P52100000985</p>
        <h4 class="title4"><strong>Godrej Greens</strong></h4>
        <p class="darkBlue bold ">DREAM WORLD LANDMARKS LLP</p>
        <a href="https://maharerait.maharashtra.gov.in/public/project/view/4597">View Details</a>
      </div>
      <div class="col-xl-6">
        <div class="greyColor">Pincode</div><p>412207</p>
        <div class="greyColor">District</div><p>Pune</p>
        <div class="greyColor">Last Modified</div><p>2026-02-05</p>
      </div>
    </div>`);

  assert.ok(project, "the full result row should be parsed, not just the name column");
  assert.equal(project.reraId, "P52100000985");
  assert.equal(project.projectName, "Godrej Greens");
  assert.equal(project.district, "Pune");
  assert.equal(project.pinCode, "412207");
  assert.equal(project.approvalDate, "2026-02-05");
  assert.match(project.sourceFilingUrl, /\/public\/project\/view\/4597$/);
  assert.equal(project.sourceUrl, project.sourceFilingUrl);
});

test("SquareYards parser reads server-rendered listing cards", async () => {
  const { PropertyListingsScraper } = await import("../scrapers/propertyListingsScraper.js");
  const sourceUrl = SQUAREYARDS_URL;
  const [listing] = PropertyListingsScraper.parseSquareYardsHtml(SQUAREYARDS_HTML);

  assert.ok(listing);
  assert.equal(listing.externalId, "10707136");
  assert.equal(listing.projectName, "Kolte Patil Margosa Heights");
  assert.equal(listing.city, "Pune");
  assert.equal(listing.locality, "Mohammadwadi");
  assert.equal(listing.location, "Mohammadwadi, Pune");
  assert.equal(listing.askingPrice, 11_000_000);
  assert.equal(listing.carpetAreaSqft, 1160);
  assert.equal(listing.pricePerSqft, 9483);
  assert.equal(listing.configuration, "2 BHK + 2 Bath");
  assert.equal(listing.propertyType, "Apartment");
  assert.equal(listing.propertySubType, "Resale");
  assert.equal(listing.constructionStage, "Ready To Move");
  assert.equal(listing.facing, "East Facing");
  assert.equal(listing.floorNumber, 7);
  assert.equal(listing.totalFloors, 7);
  assert.equal(listing.listedBy, "owner");
  assert.equal(listing.sourceUrl, sourceUrl);
  assert.equal(listing.latitude, 18.4722439095689);
  assert.equal(listing.longitude, 73.9237586892774);
  assert.equal(listing.reraStatus, "Listed");
});

test("quality gate maps new fields, computes price changes and rewards completeness", async () => {
  const { evaluatePropertyQuality, computeContentHash, normalizeAndDeduplicate } =
    await import("../scrapers/pipelineOrchestrator.js");

  const base = {
    externalId: "X-1",
    projectName: "Godrej Anandam",
    builderName: "Godrej Properties Limited",
    city: "Pune",
    locality: "Baner",
    pinCode: "411045",
    carpetAreaSqft: 1000,
    askingPrice: 10_000_000,
    pricePerSqft: 10_000,
    listingSource: "MahaRERA Official Filing",
    reraId: "P50500004427",
    listingTimestamp: "2026-01-01T00:00:00.000Z",
  };
  const newFields = {
    builtUpAreaSqft: 1180,
    superBuiltUpAreaSqft: 1350,
    configuration: "2 BHK",
    propertyType: "Residential",
    propertySubType: "Apartment",
    floorNumber: 6,
    totalFloors: 14,
    facing: "East",
    parkingCount: 1,
    furnishingStatus: "Semi-Furnished",
    previousAskingPrice: 11_000_000,
    constructionStage: "Ready to Move",
    possessionDate: "2026-12-31",
    listedBy: "builder" as const,
    sourceUrl: "https://maharera.maharashtra.gov.in/project/P50500004427",
    latitude: 18.5590,
    longitude: 73.7868,
  };

  const legacy = evaluatePropertyQuality(base, "dataset-1");
  assert.equal(legacy.accepted, true);
  assert.ok(legacy.row);
  assert.equal(legacy.score, 70);
  assert.equal(legacy.row.is_verified, true);
  assert.equal(legacy.row.is_public_preview, false, "legacy-only rows must not be public previews");

  const full = evaluatePropertyQuality({ ...base, ...newFields, priceChangeAmount: 123 }, "dataset-1");
  assert.equal(full.accepted, true);
  assert.ok(full.row);
  assert.equal(full.score, 100);
  assert.equal(full.row.data_quality_score, 100);
  assert.equal(full.row.is_verified, true);
  assert.equal(full.row.is_public_preview, true);
  assert.match(full.row.content_hash, /^[a-f0-9]{64}$/);

  // Price changes are always recomputed: supplied values are never trusted.
  assert.equal(full.row.previous_asking_price, 11_000_000);
  assert.equal(full.row.price_change_amount, -1_000_000);
  assert.equal(full.row.price_change_percent, -9.09);
  assert.equal(full.row.built_up_area_sqft, 1180);
  assert.equal(full.row.listed_by, "builder");
  assert.equal(full.row.source_url, newFields.sourceUrl);
  assert.equal(full.row.possession_date, "2026-12-31");
  assert.equal(full.row.latitude, 18.5590);
  assert.equal(full.row.longitude, 73.7868);
  assert.ok(full.row.updated_at);

  const noPrevious = evaluatePropertyQuality({ ...base, ...newFields, previousAskingPrice: null }, "dataset-1");
  assert.equal(noPrevious.row?.price_change_amount, null);
  assert.equal(noPrevious.row?.price_change_percent, null);

  for (const bad of [
    { carpetAreaSqft: 0 },
    { askingPrice: -1 },
    { pricePerSqft: 0 },
    { builtUpAreaSqft: 0 },
    { previousAskingPrice: 0 },
    { latitude: 120 },
    { longitude: -200 },
  ]) {
    const result = evaluatePropertyQuality({ ...base, ...bad }, "dataset-1");
    assert.equal(result.accepted, false, `rejected invalid value ${JSON.stringify(bad)}`);
    assert.ok(result.reasons.length > 0);
    assert.equal(result.row, null);
  }

  const inconsistent = evaluatePropertyQuality({ ...base, pricePerSqft: 5_000 }, "dataset-1");
  assert.equal(inconsistent.accepted, true);
  assert.equal(inconsistent.row?.price_per_sqft, 10_000);
  assert.ok(inconsistent.score < legacy.score);
  assert.ok(inconsistent.reasons.some((reason) => reason.includes("inconsistent")));

  const unofficial = evaluatePropertyQuality({ ...base, ...newFields, listingSource: "Direct Owner" }, "dataset-1");
  assert.equal(unofficial.row?.is_verified, false);
  assert.equal(unofficial.row?.is_public_preview, false);

  assert.equal(computeContentHash("dataset-1", base), computeContentHash("dataset-1", base));
  assert.notEqual(computeContentHash("dataset-1", base), computeContentHash("dataset-2", base));
  const batch = normalizeAndDeduplicate([base, base], "dataset-1");
  assert.equal(batch.rows.length, 1);
  assert.equal(batch.duplicates, 1);
});

test("pipeline and seed target only the single Pune dataset", () => {
  const pipelineSource = readFileSync(new URL("../scrapers/pipelineOrchestrator.ts", import.meta.url), "utf8");
  const seedSource = readFileSync(new URL("../db/seed.ts", import.meta.url), "utf8");
  assert.match(pipelineSource, /TARGET_DATASET_SLUG = "pune-real-estate-data"/);
  assert.match(seedSource, /slug: "pune-real-estate-data"/);
  assert.match(seedSource, /title: "Pune Real Estate Data"/);
  assert.match(seedSource, /fields_count: 23/);
  assert.match(seedSource, /id: "d1010000-0000-0000-0000-000000000001"/);
  assert.equal((seedSource.match(/\.from\("datasets"\)\s*\.upsert/g) || []).length, 1);
  assert.equal(seedSource.includes("DEFAULT_DATASETS"), false);
  assert.equal((seedSource.match(/base_url: "https:\/\/maharera\.maharashtra\.gov\.in"/g) || []).length, 1);
});

test("owned ingestion files contain no references to retired dataset slugs", () => {
  // Split literals so this test file does not itself contain the retired slugs.
  const retiredSlugs = [
    "pune-" + "mumbai-owner-listings",
    "rera-" + "commercial-projects",
    "bengaluru-" + "rental-yield",
    "hyderabad-" + "price-drops",
    "ncr-" + "owner-leads",
    "retail-" + "commercial-feed",
  ];
  const ownedFiles = [
    "../types/dataset.ts",
    "../scrapers/mahareraScraper.ts",
    "../scrapers/propertyListingsScraper.ts",
    "../scrapers/pipelineOrchestrator.ts",
    "../db/seed.ts",
  ];
  for (const file of ownedFiles) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    for (const slug of retiredSlugs) {
      assert.equal(source.includes(slug), false, `${file} must not reference retired slug ${slug}`);
    }
  }
});

test("dataset service and telemetry report only real data offline", async () => {
  const { DatasetService } = await import("../services/datasetService.js");
  const { TelemetryService } = await import("../services/telemetryService.js");
  const { PipelineOrchestrator } = await import("../scrapers/pipelineOrchestrator.js");

  const datasets = await DatasetService.getDatasets({});
  assert.ok(datasets.length > 0);
  assert.ok(datasets.every((dataset) => dataset.record_count === 0), "no fabricated record counts");

  const preview = await DatasetService.getDatasetPreview(datasets[0].slug);
  assert.ok(preview);
  assert.equal(preview.metrics.total_records, preview.preview.length);

  const source = readFileSync(new URL("../services/datasetService.ts", import.meta.url), "utf8");
  for (const fabricated of ["84520", "116200", "28940", "67810", "43675", "19320"]) {
    assert.equal(source.includes(fabricated), false, `fabricated count ${fabricated} must not remain`);
  }

  const telemetry = await TelemetryService.getTelemetry();
  assert.equal(telemetry.propertiesUpdatedToday, 0);
  assert.equal(telemetry.activeRegions, 0);
  assert.equal(telemetry.totalDatasets, 0);
  assert.equal(telemetry.pipelineUptime, "n/a");
  assert.equal(telemetry.lastScrapeTimestamp, "n/a");
  assert.equal(typeof telemetry.lastScrapeSecondsAgo, "number");

  const pipeline = await PipelineOrchestrator.runFullPipeline();
  assert.equal(pipeline.status, "skipped");
  assert.equal(pipeline.totalIngested, 0);
  assert.equal(pipeline.snapshotsCreated, 0);
});
