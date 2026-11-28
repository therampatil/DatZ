import { GoogleGenAI, Type } from "@google/genai";
import { ExtractedProperty, ExtractedPropertySchema } from "./schema.js";
import { extractPropertiesHeuristically } from "./heuristicExtractor.js";

export async function extractPropertiesWithAI(
  markdown: string,
  sourceUrl: string,
  categoryName: string
): Promise<{ properties: ExtractedProperty[]; method: "ai" | "heuristic" }> {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

  if (!apiKey) {
    console.warn("[extractor] No GEMINI_API_KEY found in environment. Using heuristic pattern extraction fallback.");
    return {
      properties: extractPropertiesHeuristically(markdown, sourceUrl, categoryName),
      method: "heuristic",
    };
  }

  try {
    const ai = new GoogleGenAI({ apiKey });

    const prompt = `You are an expert real estate data extraction assistant for Pune, India.
Analyze the following webpage markdown text from "${sourceUrl}" targeting the category "${categoryName}".

Extract all property listings mentioned on the page. For each property listing, output:
- externalId: unique identifier string (or slug based on title/project/url)
- projectName: project name or society name
- builderName: promoter or developer name (or null)
- city: "Pune"
- locality: the neighborhood/locality (e.g. Baner, Wakad, Kharadi, Hinjawadi, Kothrud, Hadapsar)
- location: locality, city
- pinCode: 6-digit postal code if found (e.g. 411045) or null
- carpetAreaSqft: carpet area in sq ft as integer or null
- builtUpAreaSqft: built-up area in sq ft as integer or null
- superBuiltUpAreaSqft: super built-up area in sq ft as integer or null
- askingPrice: total asking price in INR as integer (e.g. 8500000 for 85 Lakhs, 15000000 for 1.5 Cr) or null
- pricePerSqft: price per sq ft in INR or null
- configuration: e.g. "1 BHK", "2 BHK", "Commercial Office", "Coworking Desks", "Industrial Shed", "Retail Shop", "Farmhouse"
- propertyType: "Residential", "Commercial", "Industrial", "Land", "Hospitality", "Agricultural", "Distressed"
- propertySubType: "Apartment", "Villa", "Office Space", "Warehouse", "Coworking", "Showroom", "Farmhouse", "Clinic", "School", etc.
- floorNumber: integer or null
- totalFloors: integer or null
- facing: e.g. "East", "West", "North", "South" or null
- parkingCount: integer or null
- furnishingStatus: "Unfurnished", "Semi-Furnished", or "Furnished"
- constructionStage: "Ready to Move", "Under Construction", or "New Launch"
- possessionDate: YYYY-MM-DD or null
- listedBy: "owner", "builder", "broker", "agent", or "unknown"
- sourceUrl: the listing URL or the page URL (${sourceUrl})
- reraId: MahaRERA registration number (e.g. P521000...) or null
- description: brief summary

Return a JSON array of extracted properties. If no explicit properties are found, return an empty array.

Webpage Content:
${markdown.slice(0, 30_000)}`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
      },
    });

    const text = response.text || "[]";
    const parsed = JSON.parse(text);
    const rawList = Array.isArray(parsed) ? parsed : parsed.properties || [];

    const validProperties: ExtractedProperty[] = [];
    for (const item of rawList) {
      const result = ExtractedPropertySchema.safeParse({
        ...item,
        sourceUrl: item.sourceUrl || sourceUrl,
      });
      if (result.success) {
        validProperties.push(result.data);
      } else {
        console.warn("[extractor] Skipped invalid AI property:", result.error.format());
      }
    }

    if (validProperties.length > 0) {
      return { properties: validProperties, method: "ai" };
    }

    // If AI found 0, fall back to heuristic
    console.log("[extractor] AI returned 0 listings; applying heuristic fallback.");
    return {
      properties: extractPropertiesHeuristically(markdown, sourceUrl, categoryName),
      method: "heuristic",
    };
  } catch (error) {
    console.error("[extractor] AI extraction failed, falling back to heuristic:", error);
    return {
      properties: extractPropertiesHeuristically(markdown, sourceUrl, categoryName),
      method: "heuristic",
    };
  }
}
