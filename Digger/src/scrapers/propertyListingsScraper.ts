import crypto from "node:crypto";
import * as cheerio from "cheerio";
import type { ListedBy } from "../types/dataset.js";

/** The only dataset this repository ingests after migration 003. */
export const PUNE_DATASET_SLUG = "pune-real-estate-data";

/**
 * Fixture records are anchored to a fixed date. Using Date.now() here made
 * listing timestamps drift forward on every 15-minute ingestion run, which
 * corrupted time-series history and made repeat runs non-idempotent.
 */
const FIXTURE_ANCHOR_UTC = Date.UTC(2026, 0, 1);
const FIXTURE_INGESTED_AT = new Date(FIXTURE_ANCHOR_UTC).toISOString();
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS = 2;
const USER_AGENT =
  "DatZ-Ingestion/1.0 (+https://datz.example.com/bot; contact: ingestion@datz.example.com)";

/**
 * Built-in live listing feed. SquareYards renders its Pune sale page on the
 * server with one `article.listing-card` per property and exposes the exact
 * price/area/locality/coordinates as data attributes, so no headless browser
 * is required. robots.txt allows `/sale/` and we fetch at most two pages.
 */
export const SQUAREYARDS_SOURCE_SLUG = "squareyards-pune-sale";
export const SQUAREYARDS_SOURCE_URL = "https://www.squareyards.com/sale/property-for-sale-in-pune";
const SQUAREYARDS_DEFAULT_MAX_PAGES = 2;
const SQUAREYARDS_MAX_PAGES_LIMIT = 5;
const SQUAREYARDS_PAGE_DELAY_MS = 900;

function squareYardsMaxPages(): number {
  const configured = Number(process.env.DATZ_LISTING_MAX_PAGES);
  if (!Number.isFinite(configured) || configured <= 0) return SQUAREYARDS_DEFAULT_MAX_PAGES;
  return Math.min(SQUAREYARDS_MAX_PAGES_LIMIT, Math.max(1, Math.floor(configured)));
}

/** Fields that predate the Pune Real Estate field expansion. */
interface BasePropertyListing {
  externalId: string;
  projectName: string;
  builderName: string;
  city: string;
  locality: string;
  location: string;
  pinCode: string;
  /** null when the source page does not publish a value (never 0). */
  carpetAreaSqft: number | null;
  askingPrice: number | null;
  pricePerSqft: number | null;
  listingSource: string;
  reraStatus: string;
  reraId?: string;
  status: string;
  listingTimestamp: string;
  daysOnMarket: number;
  rawPayload: Record<string, any>;
}

/** Normalized shape consumed by the pipeline and the properties table. */
export interface NormalizedPropertyListing extends BasePropertyListing {
  builtUpAreaSqft: number | null;
  superBuiltUpAreaSqft: number | null;
  configuration: string | null;
  propertyType: string | null;
  propertySubType: string | null;
  floorNumber: number | null;
  totalFloors: number | null;
  facing: string | null;
  parkingCount: number | null;
  furnishingStatus: string | null;
  previousAskingPrice: number | null;
  priceChangeAmount: number | null;
  priceChangePercent: number | null;
  constructionStage: string | null;
  possessionDate: string | null;
  listedBy: ListedBy | null;
  sourceUrl: string | null;
  latitude: number | null;
  longitude: number | null;
}

export interface ListingSelectors {
  card: string;
  title: string;
  price?: string;
  area?: string;
  location?: string;
  /** Optional selectors for every field introduced by migration 003. */
  built_up?: string;
  super_built_up?: string;
  configuration?: string;
  property_type?: string;
  property_sub_type?: string;
  floor?: string;
  total_floors?: string;
  facing?: string;
  parking?: string;
  furnishing?: string;
  previous_price?: string;
  construction_stage?: string;
  possession_date?: string;
  listed_by?: string;
  source_url?: string;
  latitude?: string;
  longitude?: string;
}

export interface ListingSourceConfig {
  slug: string;
  url: string;
  dataset: string;
  selectors: ListingSelectors;
}

function fixtureListingTimestamp(daysOnMarket: number): string {
  return new Date(FIXTURE_ANCHOR_UTC - daysOnMarket * 86_400_000).toISOString();
}

function isFixtureMode(): boolean {
  return process.env.DATZ_FIXTURE_MODE === "true";
}

function cleanText(value: string | undefined | null): string {
  return (value || "").replace(/\s+/g, " ").trim();
}

function parseNumber(value: string): number | null {
  const raw = cleanText(value);
  if (!raw) return null;
  const match = raw.replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseInteger(value: string, allowZero = true): number | null {
  const parsed = parseNumber(value);
  if (parsed === null || !Number.isInteger(parsed)) return null;
  if (parsed < 0 || (!allowZero && parsed === 0)) return null;
  return parsed;
}

/** Handles Indian shorthand such as ₹1.2 Cr / ₹85 L / ₹72000. */
export function parseInrAmount(value: string): number | null {
  const raw = cleanText(value).replace(/[₹,]/g, "");
  const match = raw.match(/(\d+(?:\.\d+)?)\s*(crore|cr|lakhs?|l|k)?/i);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return null;
  const unit = (match[2] || "").toLowerCase();
  const multiplier = unit.startsWith("cr") ? 10_000_000 : unit.startsWith("l") ? 100_000 : unit === "k" ? 1_000 : 1;
  const result = amount * multiplier;
  return result > 0 ? result : null;
}

function normalizeDate(value: string): string | null {
  const raw = cleanText(value);
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function normalizeListedBy(value: string): ListedBy | null {
  const text = cleanText(value).toLowerCase();
  if (!text) return null;
  if (/owner|direct|self|landlord/.test(text)) return "owner";
  if (/builder|promoter|developer|rera/.test(text)) return "builder";
  if (/broker|channel partner|retail desk|lease desk/.test(text)) return "broker";
  if (/agent|realtor|consultant/.test(text)) return "agent";
  return "unknown";
}

export function parseFloor(value: string): { floorNumber: number | null; totalFloors: number | null } {
  const raw = cleanText(value);
  if (!raw) return { floorNumber: null, totalFloors: null };
  if (/^(ground|g)\b/i.test(raw)) return { floorNumber: 0, totalFloors: null };
  const split = raw.match(/(-?\d{1,3})\s*(?:st|nd|rd|th)?\s*(?:of|out\s+of|\/|,)\s*(\d{1,4})/i);
  if (split) {
    const floorNumber = parseInteger(split[1], false);
    const totalFloors = parseInteger(split[2], false);
    if (floorNumber !== null && totalFloors !== null) return { floorNumber, totalFloors };
  }
  return { floorNumber: parseInteger(raw, true), totalFloors: null };
}

/** Reads latitude/longitude from Google Maps (or explicit lat/lng) text. */
export function extractLatLon(raw: string): { latitude: number | null; longitude: number | null } {
  const text = (raw || "")
    .replace(/&amp;/gi, "&")
    .replace(/&comma;/gi, ",")
    .replace(/%2C/gi, ",")
    .replace(/\\u0026/gi, "&");

  const pairs = [
    /[?&](?:query|q|ll|center|marker)=(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)/i,
    /maps[^@]*@(-?\d{1,2}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)/i,
    /\b(?:lat(?:itude)?|lng|lon|long(?:itude)?)\s*[:=]\s*(-?\d{1,2}(?:\.\d+)?)\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)/i,
  ];
  for (const pattern of pairs) {
    const match = text.match(pattern);
    if (!match) continue;
    const latitude = Number(match[1]);
    const longitude = Number(match[2]);
    if (Number.isFinite(latitude) && Number.isFinite(longitude)
      && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180) {
      return { latitude, longitude };
    }
  }

  const latMatch = text.match(/\b(?:lat|latitude)\s*[:=]\s*(-?\d{1,2}(?:\.\d+)?)/i);
  const lonMatch = text.match(/\b(?:lng|lon|long|longitude)\s*[:=]\s*(-?\d{1,3}(?:\.\d+)?)/i);
  const latitude = latMatch ? Number(latMatch[1]) : null;
  const longitude = lonMatch ? Number(lonMatch[1]) : null;
  return {
    latitude: latitude !== null && Math.abs(latitude) <= 90 ? latitude : null,
    longitude: longitude !== null && Math.abs(longitude) <= 180 ? longitude : null,
  };
}

function coordinateOrNull(value: string, max: number): number | null {
  const parsed = parseNumber(value);
  return parsed !== null && Math.abs(parsed) <= max ? parsed : null;
}

export function computePriceChange(askingPrice: number | null, previousAskingPrice: number | null): {
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

function inferCity(location: string, dataset: string): string {
  const knownCities = ["Pune", "Mumbai", "Bengaluru", "Hyderabad", "Gurugram", "Noida", "Faridabad"];
  for (const city of knownCities) {
    if (new RegExp(`\\b${city}\\b`, "i").test(location)) return city;
  }
  if (/pune|real estate/i.test(dataset)) return "Pune";
  return "";
}

async function fetchHtml(url: string): Promise<string> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml" },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < MAX_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
      }
    }
  }
  const detail = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`Listing source request failed after ${MAX_ATTEMPTS} attempts for ${url}: ${detail}`);
}

/** Reads and validates DATZ_LISTING_SOURCES. Returns [] when not configured. */
export function getConfiguredListingSources(): ListingSourceConfig[] {
  const raw = process.env.DATZ_LISTING_SOURCES;
  if (!raw || !raw.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`DATZ_LISTING_SOURCES is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error("DATZ_LISTING_SOURCES must be a JSON array of source configurations.");
  }
  return parsed.map((entry, index) => {
    const source = entry as Partial<ListingSourceConfig>;
    if (!source || typeof source.slug !== "string" || typeof source.url !== "string" || typeof source.dataset !== "string") {
      throw new Error(`DATZ_LISTING_SOURCES[${index}] must include slug, url and dataset strings.`);
    }
    const selectors = source.selectors || ({} as ListingSelectors);
    if (!selectors.card || !selectors.title) {
      throw new Error(`DATZ_LISTING_SOURCES[${index}].selectors must include card and title selectors.`);
    }
    return {
      slug: source.slug,
      url: source.url,
      dataset: source.dataset,
      selectors: {
        card: selectors.card,
        title: selectors.title,
        price: selectors.price || "",
        area: selectors.area || "",
        location: selectors.location || "",
        built_up: selectors.built_up || "",
        super_built_up: selectors.super_built_up || "",
        configuration: selectors.configuration || "",
        property_type: selectors.property_type || "",
        property_sub_type: selectors.property_sub_type || "",
        floor: selectors.floor || "",
        total_floors: selectors.total_floors || "",
        facing: selectors.facing || "",
        parking: selectors.parking || "",
        furnishing: selectors.furnishing || "",
        previous_price: selectors.previous_price || "",
        construction_stage: selectors.construction_stage || "",
        possession_date: selectors.possession_date || "",
        listed_by: selectors.listed_by || "",
        source_url: selectors.source_url || "",
        latitude: selectors.latitude || "",
        longitude: selectors.longitude || "",
      },
    };
  });
}

const FIXTURE_COORDINATES: Record<string, Array<[number, number]>> = {
  Pune: [[18.5590, 73.7868], [18.6420, 73.7560], [18.6110, 73.7800], [18.5240, 73.9280]],
  Mumbai: [[19.1150, 72.8680], [19.0760, 72.8777]],
  Bengaluru: [[12.9352, 77.6245], [12.9716, 77.5946]],
  Hyderabad: [[17.4435, 78.3772], [17.3850, 78.4867]],
  Gurugram: [[28.4595, 77.0266]],
  Noida: [[28.5355, 77.3910]],
};

function fixtureCoordinates(city: string, index: number): [number, number] {
  const points = FIXTURE_COORDINATES[city] || FIXTURE_COORDINATES.Pune;
  return points[index % points.length];
}

/** Adds the migration-003 fields to legacy fixture objects deterministically. */
function withFixtureDetails(base: BasePropertyListing, index: number): NormalizedPropertyListing {
  const carpet = base.carpetAreaSqft;
  const askingPrice = base.askingPrice;
  const previousAskingPrice = askingPrice !== null
    ? Math.round(askingPrice * (1.03 + (index % 4) * 0.01))
    : null;
  const priceChange = computePriceChange(askingPrice, previousAskingPrice);
  const isCommercial = /retail|commercial|lease|broker/i.test(base.listingSource);
  const isRera = /rera|official/i.test(base.listingSource);
  const isOwner = /owner|direct/i.test(base.listingSource);
  const listedBy: ListedBy = isRera ? "builder" : isCommercial ? "broker" : isOwner ? "owner" : "agent";
  const [latitude, longitude] = fixtureCoordinates(base.city, index);
  const possession = new Date(FIXTURE_ANCHOR_UTC + ((index % 10) + 2) * 30 * 86_400_000)
    .toISOString().slice(0, 10);

  return {
    ...base,
    builtUpAreaSqft: carpet !== null ? Math.round(carpet * 1.18) : null,
    superBuiltUpAreaSqft: carpet !== null ? Math.round(carpet * 1.35) : null,
    configuration: isCommercial ? null : `${(index % 3) + 1} BHK`,
    propertyType: isCommercial ? "Commercial" : "Residential",
    propertySubType: isCommercial ? "Retail Shop" : "Apartment",
    floorNumber: index % 12,
    totalFloors: 12 + (index % 8),
    facing: ["North", "East", "South", "West", "North East"][index % 5],
    parkingCount: (index % 2) + 1,
    furnishingStatus: ["Unfurnished", "Semi-Furnished", "Furnished"][index % 3],
    previousAskingPrice,
    priceChangeAmount: priceChange.amount,
    priceChangePercent: priceChange.percent,
    constructionStage: ["Ready to Move", "Under Construction", "Near Possession"][index % 3],
    possessionDate: possession,
    listedBy,
    sourceUrl: `https://listings.example.com/property/${encodeURIComponent(base.externalId)}`,
    latitude,
    longitude,
    rawPayload: {
      ...base.rawPayload,
      fixture: true,
      ingestedAt: FIXTURE_INGESTED_AT,
      sourceUrl: `https://listings.example.com/property/${encodeURIComponent(base.externalId)}`,
      latitude,
      longitude,
    },
  };
}

function fixtureResidential(): NormalizedPropertyListing[] {
  const puneResidential = [
    { id: "PM-PUN-001", project: "Godrej Horizon", builder: "Godrej Properties", locality: "Baner", pin: "411045", carpet: 1182, price: 14800000, rera: "P52100048211", status: "Active", dom: 12 },
    { id: "PM-PUN-002", project: "Birla Pravaah", builder: "Birla Estates", locality: "Balewadi", pin: "411045", carpet: 1420, price: 18200000, rera: "P52100051907", status: "Active", dom: 9 },
    { id: "PM-PUN-003", project: "Kalpataru Jade Residences", builder: "Kalpataru Limited", locality: "Wakad", pin: "411057", carpet: 986, price: 11200000, rera: "P52100049028", status: "Active", dom: 34 },
    { id: "PM-PUN-004", project: "Gera World of Joy", builder: "Gera Developments", locality: "Baner", pin: "411045", carpet: 1310, price: 17100000, rera: "P52100052631", status: "Under Offer", dom: 37 },
    { id: "PM-PUN-005", project: "Lodha Bellevue", builder: "Lodha Group", locality: "Kharadi", pin: "411014", carpet: 1564, price: 20800000, rera: "P52100051380", status: "Active", dom: 28 },
    { id: "PM-PUN-006", project: "Panchshil Towers", builder: "Panchshil Realty", locality: "Kharadi", pin: "411014", carpet: 2450, price: 34500000, rera: "P52100001890", status: "Active", dom: 15 },
    { id: "PM-PUN-007", project: "Kolte Patil Western Avenue", builder: "Kolte-Patil Developers", locality: "Wakad", pin: "411057", carpet: 1040, price: 11900000, rera: "P52100047812", status: "Sold", dom: 22 },
    { id: "PM-PUN-008", project: "Supreme Estia", builder: "Supreme Universal", locality: "Baner", pin: "411045", carpet: 1650, price: 22400000, rera: "P52100053910", status: "Active", dom: 18 },
    { id: "PM-PUN-009", project: "Mantra Monarch", builder: "Mantra Properties", locality: "Balewadi", pin: "411045", carpet: 1120, price: 13800000, rera: "P52100049980", status: "Sold", dom: 41 },
    { id: "PM-PUN-010", project: "VTP HiLife", builder: "VTP Realty", locality: "Wakad", pin: "411057", carpet: 890, price: 9800000, rera: "P52100048123", status: "Under Offer", dom: 14 },
    { id: "PM-PUN-011", project: "Godrej Woodsville", builder: "Godrej Properties", locality: "Hinjewadi", pin: "411057", carpet: 960, price: 9200000, rera: "P52100050811", status: "Active", dom: 8 },
    { id: "PM-PUN-012", project: "Megapolis Smart Homes", builder: "Kumar Properties", locality: "Hinjewadi", pin: "411057", carpet: 810, price: 7400000, rera: "P52100046519", status: "Active", dom: 29 },
    { id: "PM-PUN-013", project: "Nyati Equinox", builder: "Nyati Group", locality: "Bavdhan", pin: "411021", carpet: 1250, price: 14200000, rera: "P52100049811", status: "Sold", dom: 33 },
    { id: "PM-PUN-014", project: "Pride Panorama", builder: "Pride Group", locality: "Shivajinagar", pin: "411016", carpet: 1780, price: 28500000, rera: "P52100047201", status: "Active", dom: 19 },
    { id: "PM-PUN-015", project: "Marvel Edge Suites", builder: "Marvel Realtors", locality: "Viman Nagar", pin: "411014", carpet: 1480, price: 21500000, rera: "P52100051120", status: "Under Offer", dom: 26 },
  ];

  return puneResidential.map((r) => {
    const pricePerSqft = Math.round(r.price / r.carpet);
    const fingerprint = crypto.createHash("sha256").update(`${r.id}-${r.price}-${r.carpet}`).digest("hex");
    const base: BasePropertyListing = {
      externalId: r.id,
      projectName: r.project,
      builderName: r.builder,
      city: "Pune",
      locality: r.locality,
      location: `${r.locality}, Pune`,
      pinCode: r.pin,
      carpetAreaSqft: r.carpet,
      askingPrice: r.price,
      pricePerSqft,
      listingSource: "Direct Verified Owner",
      reraStatus: "Registered",
      reraId: r.rera,
      status: r.status,
      listingTimestamp: fixtureListingTimestamp(r.dom),
      daysOnMarket: r.dom,
      rawPayload: {
        fingerprint,
        verifiedOwner: true,
        puneMicroMarket: true,
        floorConfiguration: `${Math.floor(r.carpet / 450) + 1}BHK Premium`,
      },
    };
    return withFixtureDetails(base, Number(r.id.slice(-3)));
  });
}

async function scrapeConfiguredSources(
  datasetSlugs: string[] = [PUNE_DATASET_SLUG],
  sources: ListingSourceConfig[] = getConfiguredListingSources()
): Promise<NormalizedPropertyListing[]> {
  if (sources.length === 0) {
    console.warn("DATZ_LISTING_SOURCES is not configured; returning no live listings. Set it to a JSON array of {slug,url,dataset,selectors} to ingest real pages.");
    return [];
  }

  const selected: ListingSourceConfig[] = [];
  for (const source of sources) {
    const requested = datasetSlugs.some((slug) => slug.toLowerCase() === source.dataset.toLowerCase());
    if (!requested || source.dataset.toLowerCase() !== PUNE_DATASET_SLUG) {
      console.warn(`Listing source "${source.slug}" targets unknown dataset "${source.dataset}"; skipping.`);
      continue;
    }
    selected.push(source);
  }
  if (selected.length === 0) {
    console.warn(`DATZ_LISTING_SOURCES has no source for dataset(s): ${datasetSlugs.join(", ")}.`);
    return [];
  }

  const listings: NormalizedPropertyListing[] = [];
  const seen = new Set<string>();
  for (const source of selected) {
    const html = await fetchHtml(source.url);
    for (const listing of PropertyListingsScraper.parseListingHtml(html, source, source.url)) {
      if (seen.has(listing.externalId)) continue;
      seen.add(listing.externalId);
      listings.push(listing);
    }
    console.log(`Listing source "${source.slug}": parsed ${listings.length} total listing(s).`);
  }
  return listings;
}

export class PropertyListingsScraper {
  /**
   * Parses SquareYards' server-rendered Pune sale results. Each
   * `article.listing-card` carries a stable `propertyid` and a hidden
   * `.favorite-btn` whose data attributes expose the exact numeric price,
   * area, locality, property type and seller type. Exported for offline tests.
   */
  static parseSquareYardsHtml(
    html: string,
    baseUrl: string = SQUAREYARDS_SOURCE_URL
  ): NormalizedPropertyListing[] {
    const $ = cheerio.load(html);
    const listings: NormalizedPropertyListing[] = [];
    const seen = new Set<string>();

    $("article.listing-card").each((index, node) => {
      const card = $(node);
      const meta = card.find(".favorite-btn[data-price], [data-price][data-locality]").first();
      const attr = (name: string): string => cleanText(meta.attr(name));

      const rawDetailUrl = attr("data-url")
        || cleanText(card.find("h2.heading span").first().attr("data-url"))
        || cleanText(card.find("a[href]").first().attr("href"));
      let sourceUrl = "";
      if (rawDetailUrl) {
        try {
          sourceUrl = new URL(rawDetailUrl, baseUrl).toString();
        } catch {
          sourceUrl = rawDetailUrl;
        }
      }

      const propertyId = cleanText(card.attr("propertyid"))
        || attr("data-propertyid")
        || (sourceUrl.match(/\/(\d{5,})\/?$/) || ["", ""])[1];
      const title = cleanText(card.find("h2.heading span").first().text()) || attr("data-name");
      if (!propertyId || !title) return;
      if (seen.has(propertyId)) return;
      seen.add(propertyId);

      const labelled = new Map<string, string>();
      card.find("dt, .field-label, label").each((_: number, labelNode: any) => {
        const key = cleanText($(labelNode).text()).toLowerCase().replace(/[^a-z0-9]+/g, "");
        if (!key) return;
        const value = cleanText($(labelNode).next("dd").text())
          || cleanText($(labelNode).parent().find("dd, p, span").first().text());
        if (value && !labelled.has(key)) labelled.set(key, value);
      });
      const labelledValue = (...labels: string[]): string => {
        for (const label of labels) {
          const value = labelled.get(label.toLowerCase().replace(/[^a-z0-9]+/g, ""));
          if (value) return value;
        }
        return "";
      };

      const priceText = cleanText(card.find("p.listing-price").first().text()) || attr("data-totalprice");
      const areaText = cleanText(card.find(".avail-area").first().text()) || attr("data-area");
      const askingPrice = parseNumber(attr("data-price")) ?? parseInrAmount(priceText);
      const carpetAreaSqft = parseNumber(areaText);
      const pricePerSqft = askingPrice && carpetAreaSqft && carpetAreaSqft > 0
        ? Math.round(askingPrice / carpetAreaSqft)
        : null;

      const city = attr("data-city") || inferCity(attr("data-locality"), SQUAREYARDS_SOURCE_SLUG) || "Pune";
      const locality = attr("data-sublocalityname") || cleanText(attr("data-locality").split(",")[0]);
      const location = attr("data-locality") || [locality, city].filter(Boolean).join(", ");
      const pinCode = (location.match(/\b\d{6}\b/) || card.text().match(/\b\d{6}\b/) || [""])[0];

      const floors = parseFloor(labelledValue("floor", "floornumber"));
      const mapNode = card.find(".map-cta").first();
      const mapCoordinates = extractLatLon(card.html() || "");
      const latitude = coordinateOrNull(cleanText(mapNode.attr("data-lat")), 90) ?? mapCoordinates.latitude;
      const longitude = coordinateOrNull(cleanText(mapNode.attr("data-long")), 180) ?? mapCoordinates.longitude;

      const typeRaw = attr("data-type");
      let propertySubType: string | null = null;
      if (typeRaw) {
        propertySubType = /resale/i.test(typeRaw)
          ? "Resale"
          : /project/i.test(typeRaw)
            ? "New Project"
            : cleanText(typeRaw);
      }

      const reraMatch = card.text().match(/\b([PZ]\d{9,12})\b/i);
      const projectName = cleanText(card.find(".project-name").first().text())
        || attr("data-projectname")
        || title;
      const listedBy = normalizeListedBy(
        attr("data-user-type") || cleanText(card.find(".agent-name").first().text())
      );
      const constructionStage = attr("data-propstatus")
        || labelledValue("possessionstatus", "constructionstatus", "status")
        || null;
      const possessionDate = normalizeDate(labelledValue("possessiondate", "possession"));

      listings.push({
        externalId: propertyId,
        projectName,
        builderName: "",
        city,
        locality,
        location,
        pinCode,
        carpetAreaSqft,
        askingPrice,
        pricePerSqft,
        builtUpAreaSqft: null,
        superBuiltUpAreaSqft: null,
        configuration: labelledValue("config", "configuration", "bhk") || attr("data-unittype") || null,
        propertyType: attr("data-propertytype") || labelledValue("propertytype", "type") || null,
        propertySubType,
        floorNumber: floors.floorNumber,
        totalFloors: floors.totalFloors,
        facing: labelledValue("facing", "orientation") || null,
        parkingCount: parseInteger(labelledValue("parking", "parkingcount", "carparking")),
        furnishingStatus: labelledValue("furnishing", "furnishingstatus") || null,
        previousAskingPrice: null,
        priceChangeAmount: null,
        priceChangePercent: null,
        constructionStage,
        possessionDate,
        listedBy,
        sourceUrl: sourceUrl || null,
        latitude,
        longitude,
        listingSource: SQUAREYARDS_SOURCE_SLUG,
        reraStatus: reraMatch ? "Registered" : "Listed",
        reraId: reraMatch ? reraMatch[1].toUpperCase() : undefined,
        status: "Active",
        listingTimestamp: new Date().toISOString(),
        daysOnMarket: 0,
        rawPayload: {
          sourceSlug: SQUAREYARDS_SOURCE_SLUG,
          sourceUrl: SQUAREYARDS_SOURCE_URL,
          pageUrl: baseUrl,
          detailUrl: sourceUrl || null,
          propertyId,
          title,
          projectName,
          priceText: cleanText(priceText),
          areaText: cleanText(areaText),
          locationText: location,
          propertyType: attr("data-propertytype") || null,
          unitType: attr("data-unittype") || null,
          listingType: typeRaw || null,
          sellerType: attr("data-user-type") || null,
          latitude,
          longitude,
          listedBy,
          ingestedAt: new Date().toISOString(),
        },
      });
    });

    return listings;
  }

  /** Fetches the built-in SquareYards Pune sale feed, page by page. */
  static async scrapeSquareYardsPuneSale(): Promise<NormalizedPropertyListing[]> {
    const maxPages = squareYardsMaxPages();
    const listings: NormalizedPropertyListing[] = [];
    const seen = new Set<string>();

    for (let page = 1; page <= maxPages; page++) {
      const url = page === 1
        ? SQUAREYARDS_SOURCE_URL
        : `${SQUAREYARDS_SOURCE_URL}?page=${page}`;
      let html: string;
      try {
        html = await fetchHtml(url);
      } catch (error) {
        if (page === 1) throw error;
        console.warn(
          `SquareYards page ${page} failed; keeping ${listings.length} listing(s) from earlier pages:`,
          error instanceof Error ? error.message : String(error)
        );
        break;
      }

      const parsed = PropertyListingsScraper.parseSquareYardsHtml(html, url);
      if (parsed.length === 0 && page === 1) {
        throw new Error(`SquareYards parse failure: no listing cards found at ${url}.`);
      }
      for (const listing of parsed) {
        if (seen.has(listing.externalId)) continue;
        seen.add(listing.externalId);
        listings.push(listing);
      }
      console.log(`SquareYards page ${page}: parsed ${parsed.length} card(s), ${listings.length} total.`);
      if (parsed.length === 0) break;
      if (page < maxPages) await new Promise((resolve) => setTimeout(resolve, SQUAREYARDS_PAGE_DELAY_MS));
    }

    return listings;
  }

  /** Parses a configured HTML listing page. Exported for offline tests. */
  static parseListingHtml(
    html: string,
    source: ListingSourceConfig,
    baseUrl: string = source.url
  ): NormalizedPropertyListing[] {
    const $ = cheerio.load(html);
    const listings: NormalizedPropertyListing[] = [];
    const selectors = source.selectors;

    $(selectors.card).each((index, node) => {
      const card = $(node);
      const labelled = new Map<string, string>();
      card.find(".greyColor, dt, .field-label, label").each((_: number, labelNode: any) => {
        const key = cleanText($(labelNode).text()).toLowerCase().replace(/[^a-z0-9]+/g, "");
        if (!key) return;
        let value = cleanText($(labelNode).next().text());
        if (!value) value = cleanText($(labelNode).parent().find("p, span, dd").first().text());
        if (value && !labelled.has(key)) labelled.set(key, value);
      });
      const labelledValue = (...labels: string[]): string => {
        for (const label of labels) {
          const value = labelled.get(label.toLowerCase().replace(/[^a-z0-9]+/g, ""));
          if (value) return value;
        }
        return "";
      };
      const selected = (selector: string | undefined, ...labels: string[]): string => {
        const fromSelector = selector ? cleanText(card.find(selector).first().text()) : "";
        return fromSelector || labelledValue(...labels) || "";
      };
      const attrValue = (...names: string[]): string => {
        for (const name of names) {
          const value = cleanText(card.attr(name));
          if (value) return value;
        }
        return "";
      };

      const title = cleanText(
        selectors.title ? card.find(selectors.title).first().text() : card.find("h2, h3, h4, .title").first().text()
      );
      if (!title) return;

      const priceText = selectors.price ? cleanText(card.find(selectors.price).first().text())
        : cleanText(card.find(".price, [class*=price]").first().text());
      const areaText = selectors.area ? cleanText(card.find(selectors.area).first().text())
        : cleanText(card.find(".area, [class*=area]").first().text());
      const locationText = selectors.location ? cleanText(card.find(selectors.location).first().text())
        : cleanText(card.find(".location, [class*=location]").first().text());

      const carpetAreaSqft = parseNumber(areaText);
      const askingPrice = parseInrAmount(priceText);
      const pricePerSqft = carpetAreaSqft && carpetAreaSqft > 0 && askingPrice && askingPrice > 0
        ? Math.round(askingPrice / carpetAreaSqft)
        : null;

      const location = cleanText(locationText);
      const locality = location.split(",")[0].trim();
      const city = inferCity(location, source.dataset);
      const pinCode = (location.match(/\b\d{6}\b/) || card.text().match(/\b\d{6}\b/) || [""])[0];

      const cardText = card.text();
      const reraMatch = cardText.match(/\b([PZ]\d{9,12})\b/i);

      // Prefer a detail link over a maps link when deriving the source URL.
      let pageUrl = "";
      const mapsLinks: string[] = [];
      card.find("a[href]").each((_: number, node: any) => {
        const href = cleanText($(node).attr("href"));
        if (!href || /^(#|javascript:|mailto:|tel:)/i.test(href)) return;
        let resolved = href;
        try {
          resolved = new URL(href, baseUrl).toString();
        } catch {
          resolved = href;
        }
        if (/google\.[a-z.]*\/maps|maps\.google/i.test(resolved)) {
          mapsLinks.push(resolved);
          return;
        }
        if (!pageUrl) pageUrl = resolved;
      });

      const sourceSelector = selectors.source_url;
      const sourceHref = sourceSelector ? cleanText(card.find(sourceSelector).first().attr("href")) : "";
      let sourceUrl = sourceHref || selected(sourceSelector || "", "sourceurl", "listingurl", "url") || pageUrl;
      if (sourceUrl && !/^https?:\/\//i.test(sourceUrl)) {
        try {
          sourceUrl = new URL(sourceUrl, baseUrl).toString();
        } catch {
          // Keep the raw relative value rather than inventing an origin.
        }
      }

      const coordinates = extractLatLon(`${mapsLinks.join(" ")} ${card.html() || ""}`);
      const latitude = coordinateOrNull(selected(selectors.latitude || "", "latitude", "lat"), 90)
        ?? coordinates.latitude;
      const longitude = coordinateOrNull(selected(selectors.longitude || "", "longitude", "lng", "long"), 180)
        ?? coordinates.longitude;

      const floorText = selected(selectors.floor || "", "floor", "floorNumber");
      const totalFloorText = selected(selectors.total_floors || "", "totalfloors", "totalFloors");
      const floors = parseFloor(floorText);
      const previousAskingPrice = parseInrAmount(
        selected(selectors.previous_price || "", "previousaskingprice", "previousprice", "oldprice")
      );
      const priceChange = computePriceChange(askingPrice, previousAskingPrice);

      const externalId = attrValue("data-id", "data-external-id")
        || (pageUrl.match(/([A-Za-z0-9-]{6,})\/?$/) || ["", ""])[1]
        || crypto.createHash("sha256").update(`${source.slug}|${index}|${title}`).digest("hex").slice(0, 16);

      const statusText = cleanText(attrValue("data-status") || cardText);
      let status = "Active";
      if (/leased|rented/i.test(statusText)) status = "Leased";
      else if (/sold/i.test(statusText)) status = "Sold";
      else if (/under offer|fitout|pending/i.test(statusText)) status = "Under Offer";
      else if (/available|new/i.test(statusText)) status = "Available";

      const dateAttr = attrValue("data-date", "data-timestamp")
        || cleanText(card.find("time[datetime]").first().attr("datetime")) || "";
      const parsedDate = dateAttr ? new Date(dateAttr) : null;
      const listingTimestamp = parsedDate && !Number.isNaN(parsedDate.getTime())
        ? parsedDate.toISOString()
        : new Date().toISOString();
      const daysOnMarket = Number(attrValue("data-days") || 0) || 0;

      const listedBy = normalizeListedBy(selected(selectors.listed_by || "", "listedby", "seller", "ownerType"));
      const configuration = cleanText(selected(selectors.configuration || "", "configuration", "config")) || null;
      const propertyType = cleanText(selected(selectors.property_type || "", "propertytype", "type")) || null;
      const propertySubType = cleanText(selected(selectors.property_sub_type || "", "propertysubtype", "subtype")) || null;
      const facing = cleanText(selected(selectors.facing || "", "facing", "orientation")) || null;
      const furnishingStatus = cleanText(selected(selectors.furnishing || "", "furnishingstatus", "furnishing")) || null;
      const constructionStage = cleanText(selected(selectors.construction_stage || "", "constructionstage", "stage")) || null;
      const possessionDate = normalizeDate(selected(selectors.possession_date || "", "possessiondate", "possession"));

      listings.push({
        externalId,
        projectName: title,
        builderName: cleanText(card.find(".builder, .promoter, [class*=builder]").first().text()) || source.slug,
        city,
        locality,
        location: location || [locality, city].filter(Boolean).join(", "),
        pinCode,
        carpetAreaSqft,
        askingPrice,
        pricePerSqft,
        builtUpAreaSqft: parseNumber(selected(selectors.built_up || "", "builtuparea", "builtup")),
        superBuiltUpAreaSqft: parseNumber(selected(selectors.super_built_up || "", "superbuiltuparea", "superbuiltup")),
        configuration,
        propertyType,
        propertySubType,
        floorNumber: floors.floorNumber,
        totalFloors: parseInteger(totalFloorText, false) ?? floors.totalFloors,
        facing,
        parkingCount: parseInteger(selected(selectors.parking || "", "parkingcount", "parking")),
        furnishingStatus,
        previousAskingPrice,
        priceChangeAmount: priceChange.amount,
        priceChangePercent: priceChange.percent,
        constructionStage,
        possessionDate,
        listedBy,
        sourceUrl: sourceUrl || null,
        latitude,
        longitude,
        listingSource: source.slug,
        reraStatus: reraMatch ? "Registered" : "Listed",
        reraId: reraMatch ? reraMatch[1].toUpperCase() : undefined,
        status,
        listingTimestamp,
        daysOnMarket,
        rawPayload: {
          sourceSlug: source.slug,
          sourceUrl: source.url,
          pageUrl,
          detailUrl: sourceUrl || null,
          priceText: cleanText(priceText),
          areaText: cleanText(areaText),
          locationText: cleanText(locationText),
          latitude,
          longitude,
          listedBy,
          ingestedAt: new Date().toISOString(),
        },
      });
    });

    return listings;
  }

  /**
   * Scrapes the single configured dataset. Configured sources take priority;
   * when none are set, the built-in SquareYards Pune sale feed is used so the
   * pipeline performs real network ingestion out of the box.
   */
  static async scrapePuneRealEstateListings(): Promise<NormalizedPropertyListing[]> {
    if (isFixtureMode()) {
      console.warn("DATZ_FIXTURE_MODE=true: returning sample Pune real-estate listings (no network request).");
      return fixtureResidential();
    }

    const configured = getConfiguredListingSources();
    if (configured.length > 0) {
      return scrapeConfiguredSources([PUNE_DATASET_SLUG], configured);
    }

    console.log(
      `DATZ_LISTING_SOURCES is not configured; using the built-in SquareYards Pune sale feed (${SQUAREYARDS_SOURCE_URL}).`
    );
    return PropertyListingsScraper.scrapeSquareYardsPuneSale();
  }

  static async scrapeResidentialListings(): Promise<NormalizedPropertyListing[]> {
    return this.scrapePuneRealEstateListings();
  }

  static async scrapeCommercialRetail(): Promise<NormalizedPropertyListing[]> {
    return this.scrapePuneRealEstateListings();
  }

  static async scrapeBengaluruRentals(): Promise<NormalizedPropertyListing[]> {
    return this.scrapePuneRealEstateListings();
  }

  static async scrapeHyderabadPriceDrops(): Promise<NormalizedPropertyListing[]> {
    return this.scrapePuneRealEstateListings();
  }

  static async scrapeNcrOwnerLeads(): Promise<NormalizedPropertyListing[]> {
    return this.scrapePuneRealEstateListings();
  }
}
