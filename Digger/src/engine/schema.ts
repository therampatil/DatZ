import { z } from "zod";

/**
 * Universal Pune Real Estate Extracted Property Schema
 */
export const ExtractedPropertySchema = z.object({
  externalId: z.string().describe("Unique identifier from source or generated slug"),
  projectName: z.string().nullable().optional().describe("Project, society or building name"),
  builderName: z.string().nullable().optional().describe("Developer or promoter name"),
  city: z.string().default("Pune").describe("City (defaults to Pune)"),
  locality: z.string().describe("Locality/neighborhood, e.g. Baner, Wakad, Kharadi, Hinjawadi"),
  location: z.string().nullable().optional().describe("Full address or locality + city"),
  pinCode: z.string().nullable().optional().describe("6-digit postal code e.g. 411045"),
  carpetAreaSqft: z.number().nullable().optional().describe("Carpet area in square feet"),
  builtUpAreaSqft: z.number().nullable().optional().describe("Built-up area in square feet"),
  superBuiltUpAreaSqft: z.number().nullable().optional().describe("Super built-up area in square feet"),
  askingPrice: z.number().nullable().optional().describe("Total asking price in INR (e.g. 8500000 for 85 Lakhs)"),
  pricePerSqft: z.number().nullable().optional().describe("Price per sq.ft in INR"),
  configuration: z.string().nullable().optional().describe("Unit type: 1 BHK, 2 BHK, 3 BHK, 4 BHK, Studio, Commercial Office, Penthouse"),
  propertyType: z.string().default("Residential").describe("Residential, Commercial, Industrial, Agricultural"),
  propertySubType: z.string().nullable().optional().describe("Apartment, Villa, Row House, Penthouse, Office Space, Shop"),
  floorNumber: z.number().nullable().optional().describe("Floor number"),
  totalFloors: z.number().nullable().optional().describe("Total number of floors"),
  facing: z.string().nullable().optional().describe("East, West, North, South, North-East, etc."),
  parkingCount: z.number().nullable().optional().describe("Number of parking spaces"),
  furnishingStatus: z.string().nullable().optional().describe("Unfurnished, Semi-Furnished, Furnished"),
  constructionStage: z.string().nullable().optional().describe("Ready to Move, Under Construction, New Launch"),
  possessionDate: z.string().nullable().optional().describe("Estimated possession date (YYYY-MM-DD)"),
  listedBy: z.enum(["owner", "builder", "broker", "agent", "unknown"]).default("unknown"),
  sourceUrl: z.string().url().describe("Original URL of the listing"),
  reraId: z.string().nullable().optional().describe("MahaRERA registration ID e.g. P52100048211"),
  description: z.string().nullable().optional().describe("Brief description or key highlights"),
});

export type ExtractedProperty = z.infer<typeof ExtractedPropertySchema>;

export const ExtractionResultSchema = z.object({
  category: z.string(),
  sourceUrl: z.string(),
  extractedAt: z.string(),
  properties: z.array(ExtractedPropertySchema),
});

export type ExtractionResult = z.infer<typeof ExtractionResultSchema>;
