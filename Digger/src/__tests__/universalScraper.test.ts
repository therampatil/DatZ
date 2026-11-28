import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanHtmlToMarkdown } from "../engine/cleaner.js";
import { extractPropertiesHeuristically } from "../engine/heuristicExtractor.js";
import { ExtractedPropertySchema } from "../engine/schema.js";

test("cleanHtmlToMarkdown removes script, style, and navigation tags", () => {
  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>Pune Real Estate Portal</title>
        <script>alert("tracking");</script>
        <style>body { color: red; }</style>
      </head>
      <body>
        <nav><a href="/home">Home</a></nav>
        <header>Header content</header>
        <main>
          <h1>Baner Luxury 2 BHK Apartments</h1>
          <p>Superb 2 BHK apartment for sale in Baner, Pune. Asking price is ₹85 Lakhs. Carpet area 1050 sq.ft.</p>
        </main>
        <footer>Copyright 2026</footer>
      </body>
    </html>
  `;

  const cleaned = cleanHtmlToMarkdown(html);
  assert.equal(cleaned.title, "Pune Real Estate Portal");
  assert.ok(!cleaned.markdown.includes("tracking"), "Scripts should be stripped");
  assert.ok(!cleaned.markdown.includes("color: red"), "Styles should be stripped");
  assert.ok(!cleaned.markdown.includes("Copyright 2026"), "Footer should be stripped");
  assert.ok(cleaned.markdown.includes("Baner Luxury 2 BHK Apartments"));
  assert.ok(cleaned.markdown.includes("85 Lakhs"));
});

test("extractPropertiesHeuristically correctly extracts structured properties from markdown", () => {
  const sampleMarkdown = `
    # Godrej Horizon Baner Pune
    2 BHK Apartment in Baner, Pune
    Price: ₹ 1.25 Cr
    Carpet Area: 1150 sq.ft
    Ready to Move residential project.
  `;

  const properties = extractPropertiesHeuristically(sampleMarkdown, "https://example.com/listings", "Residential Real Estate");
  assert.ok(properties.length >= 1, "Should extract at least 1 property");

  const first = properties[0];
  assert.equal(first.locality, "Baner");
  assert.equal(first.city, "Pune");
  assert.equal(first.configuration, "2 BHK");
  assert.equal(first.askingPrice, 12500000); // 1.25 Cr = 12,500,000 INR
  assert.equal(first.carpetAreaSqft, 1150);
});

test("ExtractedPropertySchema validates valid property records", () => {
  const sample = {
    externalId: "TEST-001",
    projectName: "Pride World City",
    builderName: "Pride Group",
    city: "Pune",
    locality: "Charholi Budruk",
    carpetAreaSqft: 980,
    askingPrice: 6500000,
    configuration: "2 BHK",
    propertyType: "Residential",
    listedBy: "builder",
    sourceUrl: "https://example.com/property/1",
  };

  const parsed = ExtractedPropertySchema.safeParse(sample);
  assert.ok(parsed.success, "Schema validation should succeed for valid properties");
  if (parsed.success) {
    assert.equal(parsed.data.locality, "Charholi Budruk");
    assert.equal(parsed.data.askingPrice, 6500000);
  }
});
