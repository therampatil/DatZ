import * as cheerio from "cheerio";
import type { ListedBy } from "../types/dataset.js";
import { computePriceChange, extractLatLon, parseFloor, parseInrAmount } from "./propertyListingsScraper.js";

/**
 * Normalized shape used by the pipeline. Numeric fields that the public search
 * cards do not publish are `null` (never zero), so the database CHECK
 * constraints for positive numbers are never violated by an "unknown" value.
 */
export interface NormalizedReraProject {
  reraId: string;
  projectName: string;
  promoterName: string;
  /** Explicit locality from the card, when published. */
  locality: string;
  projectType: "Commercial" | "Residential" | "Mixed Development";
  district: string;
  taluka: string;
  pinCode: string;
  location: string;
  commercialAreaSqft: number | null;
  totalBuildings: number | null;
  sanctionedFsi: number | null;
  estimatedCostInr: number | null;
  approvalDate: string;
  /** Derived from approvalDate so repeated ingestion runs keep stable history. */
  listingTimestamp: string;
  completionDeadline: string;
  escrowBank: string;
  status: "Approved" | "Under Review" | "Registered";
  litigationStatus: string;
  sourceFilingUrl: string;
  /** Migration-003 fields. Unpublished values remain null. */
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
  listedBy: ListedBy;
  sourceUrl: string;
  latitude: number | null;
  longitude: number | null;
  rawPayload: Record<string, any>;
}

const SEARCH_URL = "https://www.maharera.maharashtra.gov.in/projects-search-result";
const DEFAULT_SEARCH_TERMS = "Godrej,Panchshil,Kolte,Embassy";
const DEFAULT_MAX_RESULTS = 100;
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS = 2;
const FIXTURE_INGESTED_AT = "2026-01-01T00:00:00.000Z";
const USER_AGENT =
  "DatZ-Ingestion/1.0 (+https://datz.example.com/bot; contact: ingestion@datz.example.com)";

const RERA_ID_PATTERN = /\b([PZ]\d{9,12})\b/i;

function isFixtureMode(): boolean {
  return process.env.DATZ_FIXTURE_MODE === "true";
}

function cleanText(value: string | undefined | null): string {
  return (value || "").replace(/\s+/g, " ").trim();
}

function normalizeDate(value: string): string {
  const raw = cleanText(value);
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
}

function parseNumber(value: string): number | null {
  const raw = cleanText(value);
  if (!raw) return null;
  const match = raw.replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseInteger(value: string): number | null {
  const parsed = parseNumber(value);
  return parsed !== null && Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function looksLikeEmptyResultsPage(html: string): boolean {
  return /no\s+(matching\s+)?(projects?|records?|results?|data)\s+(found|available|matched)/i.test(html)
    || /0\s+records?\s+found/i.test(html);
}

async function fetchHtml(url: string): Promise<string> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "text/html,application/xhtml+xml",
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < MAX_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
      }
    }
  }
  const detail = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`MahaRERA request failed after ${MAX_ATTEMPTS} attempts for ${url}: ${detail}`);
}

interface ReraFixtureBase {
  reraId: string;
  projectName: string;
  promoterName: string;
  district: string;
  taluka: string;
  pinCode: string;
  location: string;
  commercialAreaSqft: number | null;
  totalBuildings: number | null;
  sanctionedFsi: number | null;
  estimatedCostInr: number | null;
  approvalDate: string;
  completionDeadline: string;
  escrowBank: string;
  status: NormalizedReraProject["status"];
  litigationStatus: string;
  sourceFilingUrl: string;
}

const FIXTURE_COORDINATES: Array<[number, number]> = [
  [18.5476, 73.9128], // Viman Nagar, Pune
  [18.5912, 73.7380], // Hinjewadi, Pune
  [18.5601, 73.7705], // Baner, Pune
  [18.5362, 73.9521], // Kharadi, Pune
  [18.5520, 73.7615], // Balewadi, Pune
  [18.5810, 73.7420], // Hinjewadi Phase 2, Pune
  [19.0596, 72.8659], // BKC, Mumbai
  [19.0350, 73.0170], // Airoli, Navi Mumbai
];

/** Small deterministic data set used only by tests (DATZ_FIXTURE_MODE=true). */
function getFixtureProjects(): NormalizedReraProject[] {
  const statutoryRegistry: ReraFixtureBase[] = [
    {
      reraId: "P52100054812",
      projectName: "Panchshil Business Bay Phase 2",
      promoterName: "Panchshil Corporate Park Pvt Ltd",
      district: "Pune",
      taluka: "Haveli",
      pinCode: "411014",
      location: "Viman Nagar, Pune",
      commercialAreaSqft: 285000,
      totalBuildings: 2,
      sanctionedFsi: 2.85,
      estimatedCostInr: 4200000000,
      approvalDate: "2026-08-14",
      completionDeadline: "2028-12-31",
      escrowBank: "HDFC Bank Ltd",
      status: "Approved",
      litigationStatus: "Clear - No Litigations",
      sourceFilingUrl: "https://maharera.maharashtra.gov.in/project/P52100054812",
    },
    {
      reraId: "P52100052304",
      projectName: "EON Free Zone Hinjewadi Phase 3",
      promoterName: "Kolte-Patil Developers Ltd",
      district: "Pune",
      taluka: "Mulshi",
      pinCode: "411057",
      location: "Hinjewadi Phase 3, Pune",
      commercialAreaSqft: 520000,
      totalBuildings: 3,
      sanctionedFsi: 2.75,
      estimatedCostInr: 6800000000,
      approvalDate: "2026-10-10",
      completionDeadline: "2029-03-31",
      escrowBank: "Axis Bank Ltd",
      status: "Registered",
      litigationStatus: "Clear - MIDC Approved",
      sourceFilingUrl: "https://maharera.maharashtra.gov.in/project/P52100052304",
    },
    {
      reraId: "P52100056190",
      projectName: "Amar Business Park Baner",
      promoterName: "Amar Builders & Developers",
      district: "Pune",
      taluka: "Haveli",
      pinCode: "411045",
      location: "Baner Highway Junction, Pune",
      commercialAreaSqft: 175000,
      totalBuildings: 1,
      sanctionedFsi: 2.6,
      estimatedCostInr: 2800000000,
      approvalDate: "2026-11-04",
      completionDeadline: "2028-09-30",
      escrowBank: "HDFC Bank Ltd",
      status: "Under Review",
      litigationStatus: "Clear - Town Planning Approved",
      sourceFilingUrl: "https://maharera.maharashtra.gov.in/project/P52100056190",
    },
    {
      reraId: "P52100057201",
      projectName: "Gera Commerzone Kharadi Tower 3",
      promoterName: "Gera Developments Pvt Ltd",
      district: "Pune",
      taluka: "Haveli",
      pinCode: "411014",
      location: "Kharadi EON Corridor, Pune",
      commercialAreaSqft: 430000,
      totalBuildings: 1,
      sanctionedFsi: 3.1,
      estimatedCostInr: 5400000000,
      approvalDate: "2026-07-22",
      completionDeadline: "2028-11-30",
      escrowBank: "ICICI Bank Ltd",
      status: "Approved",
      litigationStatus: "Clear - IT SEZ Title",
      sourceFilingUrl: "https://maharera.maharashtra.gov.in/project/P52100057201",
    },
    {
      reraId: "P52100058310",
      projectName: "Balewadi Corporate Bay",
      promoterName: "Supreme Universal Builders",
      district: "Pune",
      taluka: "Haveli",
      pinCode: "411045",
      location: "Balewadi High Street, Pune",
      commercialAreaSqft: 210000,
      totalBuildings: 1,
      sanctionedFsi: 2.7,
      estimatedCostInr: 3100000000,
      approvalDate: "2026-09-18",
      completionDeadline: "2028-06-30",
      escrowBank: "Kotak Mahindra Bank",
      status: "Approved",
      litigationStatus: "Clear - Freehold Land",
      sourceFilingUrl: "https://maharera.maharashtra.gov.in/project/P52100058310",
    },
    {
      reraId: "P52100059420",
      projectName: "Hinjewadi Megatech Hub Phase 2",
      promoterName: "Paranjape Schemes (Construction) Ltd",
      district: "Pune",
      taluka: "Mulshi",
      pinCode: "411057",
      location: "Hinjewadi Phase 2, Pune",
      commercialAreaSqft: 360000,
      totalBuildings: 2,
      sanctionedFsi: 2.8,
      estimatedCostInr: 4600000000,
      approvalDate: "2026-05-30",
      completionDeadline: "2029-01-31",
      escrowBank: "State Bank of India",
      status: "Registered",
      litigationStatus: "Clear - MIDC Leasehold 99yr",
      sourceFilingUrl: "https://maharera.maharashtra.gov.in/project/P52100059420",
    },
    {
      reraId: "P51800051299",
      projectName: "Godrej Origins Grade-A Suites",
      promoterName: "Godrej Properties Limited",
      district: "Mumbai",
      taluka: "Kurla",
      pinCode: "400051",
      location: "Bandra Kurla Complex (BKC), Mumbai",
      commercialAreaSqft: 340000,
      totalBuildings: 1,
      sanctionedFsi: 4.0,
      estimatedCostInr: 7800000000,
      approvalDate: "2026-09-02",
      completionDeadline: "2028-06-30",
      escrowBank: "ICICI Bank Ltd",
      status: "Approved",
      litigationStatus: "Clear - Institutional Title",
      sourceFilingUrl: "https://maharera.maharashtra.gov.in/project/P51800051299",
    },
    {
      reraId: "P51700049281",
      projectName: "Mindspace Tech Hub Tower 5",
      promoterName: "K Raheja Corp Real Estate Pvt Ltd",
      district: "Navi Mumbai",
      taluka: "Thane",
      pinCode: "400708",
      location: "Airoli Knowledge Park, Navi Mumbai",
      commercialAreaSqft: 480000,
      totalBuildings: 1,
      sanctionedFsi: 3.5,
      estimatedCostInr: 5900000000,
      approvalDate: "2026-07-28",
      completionDeadline: "2028-03-31",
      escrowBank: "State Bank of India",
      status: "Approved",
      litigationStatus: "Clear - MIDC Allotted",
      sourceFilingUrl: "https://maharera.maharashtra.gov.in/project/P51700049281",
    },
  ];

  return statutoryRegistry.map((project, index) => {
    const fingerprint = cryptoFingerprint(
      `${project.reraId}-${project.commercialAreaSqft}-${project.estimatedCostInr}`
    );
    const previousAskingPrice = project.estimatedCostInr !== null
      ? Math.round(project.estimatedCostInr * (1.02 + (index % 3) * 0.01))
      : null;
    const priceChange = computePriceChange(project.estimatedCostInr, previousAskingPrice);
    const [latitude, longitude] = FIXTURE_COORDINATES[index % FIXTURE_COORDINATES.length];
    return {
      ...project,
      locality: project.location.split(",")[0].trim(),
      projectType: "Commercial" as const,
      approvalDate: project.approvalDate,
      listingTimestamp: new Date(project.approvalDate).toISOString(),
      builtUpAreaSqft: project.commercialAreaSqft,
      superBuiltUpAreaSqft: project.commercialAreaSqft !== null
        ? Math.round(project.commercialAreaSqft * 1.2)
        : null,
      configuration: "Open Plan",
      propertyType: "Commercial",
      propertySubType: ["Grade-A Office", "IT Park", "Business Park"][index % 3],
      floorNumber: 2 + (index % 8),
      totalFloors: 12 + (index % 6),
      facing: ["North", "East", "West", "South"][index % 4],
      parkingCount: 20 + (index % 40),
      furnishingStatus: index % 2 === 0 ? "Fitted Out" : "Unfurnished",
      previousAskingPrice,
      priceChangeAmount: priceChange.amount,
      priceChangePercent: priceChange.percent,
      constructionStage: ["Under Construction", "Ready to Move", "Near Possession"][index % 3],
      possessionDate: project.completionDeadline,
      listedBy: "builder" as const,
      sourceUrl: project.sourceFilingUrl,
      latitude,
      longitude,
      rawPayload: {
        fingerprint,
        fixture: true,
        sanctionedFsi: project.sanctionedFsi,
        escrowBank: project.escrowBank,
        litigationStatus: project.litigationStatus,
        authority: "MahaRERA (Maharashtra Real Estate Regulatory Authority)",
        puneCluster: project.district === "Pune",
        sourceUrl: project.sourceFilingUrl,
        latitude,
        longitude,
        ingestedAt: FIXTURE_INGESTED_AT,
      },
    };
  });
}

function cryptoFingerprint(value: string): string {
  // Lightweight non-cryptographic fingerprint is enough for a test fixture;
  // production content hashes are computed with node:crypto in the pipeline.
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export class MahaRERAScraper {
  /**
   * Scrapes the official MahaRERA public search for each configured brand term.
   * Live mode is the default; fixture mode is opt-in via DATZ_FIXTURE_MODE=true.
   */
  static async scrapeCommercialProjects(): Promise<NormalizedReraProject[]> {
    if (isFixtureMode()) {
      console.warn("DATZ_FIXTURE_MODE=true: returning fixture MahaRERA projects (no network request).");
      return getFixtureProjects();
    }

    const terms = (process.env.MAHARERA_SEARCH_TERMS || DEFAULT_SEARCH_TERMS)
      .split(",")
      .map((term) => term.trim())
      .filter(Boolean);
    if (terms.length === 0) {
      throw new Error("MAHARERA_SEARCH_TERMS is set but contains no search terms.");
    }

    const configuredMax = Number(process.env.MAHARERA_MAX_RESULTS);
    const maxResults = Number.isFinite(configuredMax) && configuredMax > 0
      ? Math.floor(configuredMax)
      : DEFAULT_MAX_RESULTS;

    // The public search is state-wide. Keep the Pune dataset coherent by
    // matching the configured district (default "Pune"); set it to "all" to
    // ingest every Maharashtra result.
    const districtFilter = cleanText(process.env.MAHARERA_DISTRICT || "Pune");
    const matchesDistrict = (project: NormalizedReraProject): boolean => {
      if (!districtFilter || /^all$/i.test(districtFilter)) return true;
      const haystack = [project.district, project.taluka, project.locality, project.location]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(districtFilter.toLowerCase());
    };

    const projects: NormalizedReraProject[] = [];
    const seen = new Set<string>();
    let filteredOut = 0;

    for (const term of terms) {
      const url = `${SEARCH_URL}?project_name=${encodeURIComponent(term)}&project_state=27`;
      const html = await fetchHtml(url);
      const parsed = MahaRERAScraper.parseSearchResults(html, url);
      if (parsed.length === 0 && !looksLikeEmptyResultsPage(html)) {
        throw new Error(
          `MahaRERA parse failure for term "${term}": no project cards found in the search response from ${url}.`
        );
      }
      console.log(`MahaRERA term "${term}": parsed ${parsed.length} project card(s).`);
      for (const project of parsed) {
        if (projects.length >= maxResults) break;
        if (seen.has(project.reraId)) continue;
        if (!matchesDistrict(project)) {
          filteredOut++;
          continue;
        }
        seen.add(project.reraId);
        projects.push(project);
      }
      if (projects.length >= maxResults) break;
    }
    if (filteredOut > 0) {
      console.log(`MahaRERA: skipped ${filteredOut} project(s) outside the "${districtFilter}" district.`);
    }

    return projects;
  }

  /**
   * Parses the public search results HTML. Exported so tests can exercise the
   * real parser with local fixture strings, without network access.
   */
  static parseSearchResults(html: string, baseUrl: string = SEARCH_URL): NormalizedReraProject[] {
    const $ = cheerio.load(html);
    const projects: NormalizedReraProject[] = [];
    const seen = new Set<string>();

    const cardCandidates: any[] = [];
    const remember = (card: any) => {
      if (card && card.length && !cardCandidates.some((existing) => existing.html() === card.html())) {
        cardCandidates.push(card);
      }
    };

    /**
     * Climbs from a title/id node to the full result card. The live markup puts
     * the project name and the RERA id in one column and the district/pincode
     * fields in sibling columns, so stopping at the first ancestor containing
     * the id loses most of the record. Require both the id and field labels.
     */
    const findCard = (node: any): any => {
      let card = $(node);
      let best = $(node).parent();
      for (let depth = 0; depth < 8 && card.length; depth++) {
        const hasId = RERA_ID_PATTERN.test(card.text());
        const hasFields = card.find(".greyColor, dt, .field-label, label").length > 0;
        if (hasId && hasFields) return card;
        if (hasId) best = card;
        card = card.parent();
      }
      return best;
    };

    $("h4.title4, h4.title, h3.title4, h3.title").each((_, node) => remember(findCard(node)));
    $("p, span, div")
      .filter((_, node) => /^\s*#?\s*[PZ]\d{9,12}\s*$/i.test(cleanText($(node).text())))
      .each((_, node) => remember(findCard(node)));

    for (const card of cardCandidates) {
      const cardText = card.text();
      const idMatch = cardText.match(RERA_ID_PATTERN);
      if (!idMatch) continue;
      const reraId = idMatch[1].toUpperCase();
      if (seen.has(reraId)) continue;

      const fields = new Map<string, string>();
      card.find(".greyColor, dt, .field-label, label").each((_: number, node: any) => {
        const label = cleanText($(node).text()).toLowerCase().replace(/[^a-z0-9]+/g, "");
        if (!label) return;
        let value = cleanText($(node).next().text());
        if (!value) value = cleanText($(node).parent().find("p, span, dd").first().text());
        if (value && !fields.has(label)) fields.set(label, value);
      });

      const field = (...labels: string[]): string => {
        for (const label of labels) {
          const key = label.toLowerCase().replace(/[^a-z0-9]+/g, "");
          const value = fields.get(key);
          if (value) return value;
        }
        return "";
      };

      const projectName = cleanText(
        card.find("h4.title4 strong, h4.title4, h4 strong, h3 strong, h3.title4").first().text()
      ) || field("projectname", "project");
      if (!projectName) continue;

      const promoterName = cleanText(
        card.find("p.darkBlue.bold, p.darkBlue, .promoter-name, .builder-name").first().text()
      ) || field("promoter", "promotername", "developer");

      const district = field("district", "districtname");
      const taluka = field("taluka", "tehsil", "subdistrict");
      const pinCode = field("pincode", "pin") || (cardText.match(/\b\d{6}\b/) || [""])[0];
      const address = field("address", "projectaddress", "locality");
      const locality = field("locality", "localityname", "area") || address.split(",")[0].trim();
      const location = address || [locality, taluka, district].filter(Boolean).join(", ");
      const rawApproval = field("lastmodified", "modifieddate", "approvaldate", "dateofregistration", "registrationdate");
      const approvalDate = normalizeDate(rawApproval);
      const listingTimestamp = approvalDate
        ? `${approvalDate}T00:00:00.000Z`
        : new Date().toISOString();

      const typeText = field("projecttype", "typeofproject", "propertytype") || cardText;
      let projectType: NormalizedReraProject["projectType"] = "Commercial";
      if (/mixed\s*development/i.test(typeText)) projectType = "Mixed Development";
      else if (/residential/i.test(typeText)) projectType = "Residential";

      let propertyType: string | null = null;
      if (/mixed\s*development/i.test(typeText)) propertyType = "Mixed Development";
      else if (/residential/i.test(typeText)) propertyType = "Residential";
      else if (/commercial/i.test(typeText)) propertyType = "Commercial";

      const statusText = field("status", "projectstatus") || cardText;
      let status: NormalizedReraProject["status"] = "Registered";
      if (/under\s*review|scrutiny/i.test(statusText)) status = "Under Review";
      else if (/approved|sanctioned/i.test(statusText)) status = "Approved";

      let sourceFilingUrl = "";
      card.find("a[href]").each((_: number, node: any) => {
        if (sourceFilingUrl) return;
        const href = $(node).attr("href") || "";
        if (!href || href === "#" || /^(javascript:|mailto:|tel:)/i.test(href)) return;
        if (/google\.[a-z.]*\/maps|maps\.google/i.test(href)) return;
        if (!/\/project|rera|\b[PZ]\d{9,12}\b/i.test(href)) return;
        try {
          sourceFilingUrl = new URL(href, baseUrl).toString();
        } catch {
          sourceFilingUrl = href;
        }
      });

      const mapsHrefs: string[] = [];
      card.find("a[href]").each((_: number, node: any) => {
        const href = $(node).attr("href") || "";
        if (/google\.[a-z.]*\/maps|maps\.google|maps\.app\.goo/i.test(href)) mapsHrefs.push(href);
      });
      const coordinates = extractLatLon(`${mapsHrefs.join(" ")} ${card.html() || ""}`);

      const previousAskingPrice = parseInrAmount(
        field("previousaskingprice", "previousprice", "oldprice", "lastaskingprice")
      );
      const estimatedCostInr = parseInrAmount(field("estimatedcost", "projectcost"));
      const askingPriceForChange = field("askingprice", "price")
        ? parseInrAmount(field("askingprice", "price"))
        : estimatedCostInr;
      const priceChange = computePriceChange(askingPriceForChange, previousAskingPrice);
      const completionDeadline = normalizeDate(field("completiondeadline", "completiondate"));
      const floors = parseFloor(field("floor", "floornumber"));

      const rawPayload: Record<string, unknown> = {
        authority: "MahaRERA (Maharashtra Real Estate Regulatory Authority)",
        projectId: reraId,
        searchResultUrl: baseUrl,
        sourceUrl: sourceFilingUrl || null,
        latitude: coordinates.latitude,
        longitude: coordinates.longitude,
        listedBy: "builder",
        ingestedAt: new Date().toISOString(),
      };
      for (const [key, value] of fields.entries()) rawPayload[key] = value;

      seen.add(reraId);
      projects.push({
        reraId,
        projectName,
        promoterName,
        locality,
        projectType,
        district,
        taluka,
        pinCode,
        location,
        commercialAreaSqft: parseNumber(field("commercialarea", "carpetarea", "builtuparea", "area")),
        totalBuildings: parseNumber(field("totalbuildings", "noofbuildings", "buildings")),
        sanctionedFsi: parseNumber(field("sanctionedfsi", "fsi")),
        estimatedCostInr,
        approvalDate,
        listingTimestamp,
        completionDeadline,
        escrowBank: field("escrowbank", "bankname"),
        status,
        litigationStatus: field("litigationstatus", "litigations"),
        sourceFilingUrl,
        builtUpAreaSqft: parseNumber(field("builtuparea", "builtup")),
        superBuiltUpAreaSqft: parseNumber(field("superbuiltuparea", "superbuiltup", "superarea")),
        configuration: cleanText(field("configuration", "config", "bhk")) || null,
        propertyType,
        propertySubType: cleanText(field("propertysubtype", "subtype", "unittype")) || null,
        floorNumber: floors.floorNumber,
        totalFloors: parseInteger(field("totalfloors", "nooffloors")) ?? floors.totalFloors,
        facing: cleanText(field("facing", "orientation")) || null,
        parkingCount: parseInteger(field("parking", "parkingcount", "carparking")),
        furnishingStatus: cleanText(field("furnishingstatus", "furnishing")) || null,
        previousAskingPrice,
        priceChangeAmount: priceChange.amount,
        priceChangePercent: priceChange.percent,
        constructionStage: cleanText(field("constructionstage", "constructionstatus", "stage")) || null,
        possessionDate: normalizeDate(field("possessiondate", "expectedpossession", "possession")) || null,
        listedBy: "builder",
        sourceUrl: sourceFilingUrl,
        latitude: coordinates.latitude,
        longitude: coordinates.longitude,
        rawPayload,
      });
    }

    return projects;
  }
}
