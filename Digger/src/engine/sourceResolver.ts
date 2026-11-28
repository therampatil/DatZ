export interface ResolvedSource {
  siteName: string;
  url: string;
}

// Pre-configured multi-portal search templates for Pune real estate across 14 categories
export function resolveTargetUrlsForCategory(category: string, query?: string): ResolvedSource[] {
  const q = (query || "").trim();
  const cat = (category || "").toLowerCase();

  // Clean locality or search term
  const term = q ? encodeURIComponent(q) : "pune";

  // 1. Rental Properties & PG
  if (cat.includes("rent") || cat.includes("pg") || cat.includes("co-living")) {
    return [
      {
        siteName: "SquareYards Rentals",
        url: q
          ? `https://www.squareyards.com/rent/property-for-rent-in-${term}`
          : "https://www.squareyards.com/rent/property-for-rent-in-pune",
      },
      {
        siteName: "99acres Rentals",
        url: "https://www.99acres.com/property-for-rent-in-pune-ffid",
      },
      {
        siteName: "Housing.com Rentals",
        url: "https://housing.com/in/rent/pune/pune",
      },
    ];
  }

  // 2. Co-Working & Shared Spaces
  if (cat.includes("cowork") || cat.includes("co-work") || cat.includes("shared")) {
    return [
      {
        siteName: "SquareYards Coworking",
        url: "https://www.squareyards.com/commercial-property-for-rent-in-pune",
      },
      {
        siteName: "99acres Managed Offices",
        url: "https://www.99acres.com/commercial-office-space-for-rent-in-pune-ffid",
      },
    ];
  }

  // 3. Industrial & Warehousing
  if (cat.includes("industrial") || cat.includes("warehouse") || cat.includes("midc")) {
    return [
      {
        siteName: "SquareYards Industrial",
        url: "https://www.squareyards.com/industrial-land-for-sale-in-pune",
      },
      {
        siteName: "99acres Industrial & Warehouses",
        url: "https://www.99acres.com/industrial-land-plot-in-pune-ffid",
      },
      {
        siteName: "MagicBricks Industrial",
        url: "https://www.magicbricks.com/industrial-land-for-sale-in-pune-pppfs",
      },
    ];
  }

  // 4. Retail & High-Street Shops
  if (cat.includes("retail") || cat.includes("shop") || cat.includes("showroom")) {
    return [
      {
        siteName: "SquareYards Commercial Shops",
        url: "https://www.squareyards.com/commercial-shops-for-sale-in-pune",
      },
      {
        siteName: "99acres Retail Spaces",
        url: "https://www.99acres.com/commercial-shops-for-sale-in-pune-ffid",
      },
      {
        siteName: "MagicBricks Retail",
        url: "https://www.magicbricks.com/commercial-shops-for-sale-in-pune-pppfs",
      },
    ];
  }

  // 5. Hospitality & Resorts
  if (cat.includes("hospitality") || cat.includes("resort") || cat.includes("hotel")) {
    return [
      {
        siteName: "SquareYards Resorts & Villas",
        url: "https://www.squareyards.com/villas-for-sale-in-pune",
      },
      {
        siteName: "99acres Farmhouses & Resorts",
        url: "https://www.99acres.com/farm-house-in-pune-ffid",
      },
    ];
  }

  // 6. Healthcare & Medical Spaces
  if (cat.includes("health") || cat.includes("clinic") || cat.includes("hospital") || cat.includes("medical")) {
    return [
      {
        siteName: "SquareYards Medical Suites",
        url: "https://www.squareyards.com/commercial-property-for-sale-in-pune",
      },
      {
        siteName: "MagicBricks Healthcare Spaces",
        url: "https://www.magicbricks.com/commercial-property-for-sale-in-pune-pppfs",
      },
    ];
  }

  // 7. Educational Institutes & Campus
  if (cat.includes("education") || cat.includes("school") || cat.includes("campus") || cat.includes("institute")) {
    return [
      {
        siteName: "SquareYards Institutional Spaces",
        url: "https://www.squareyards.com/commercial-property-for-sale-in-pune",
      },
      {
        siteName: "99acres Educational Hubs",
        url: "https://www.99acres.com/commercial-property-in-pune-ffid",
      },
    ];
  }

  // 8. Agricultural Land & Farmhouses
  if (cat.includes("agri") || cat.includes("farm") || cat.includes("rural")) {
    return [
      {
        siteName: "SquareYards Farmhouses",
        url: "https://www.squareyards.com/farm-house-for-sale-in-pune",
      },
      {
        siteName: "99acres Farmlands & Plots",
        url: "https://www.99acres.com/agricultural-farm-land-in-pune-ffid",
      },
    ];
  }

  // 9. Bank Auction & Distressed Assets
  if (cat.includes("auction") || cat.includes("distressed") || cat.includes("sarfaesi")) {
    return [
      {
        siteName: "SquareYards Auctions",
        url: "https://www.squareyards.com/auctions/property-for-sale-in-pune",
      },
      {
        siteName: "99acres Resale & Distress Deals",
        url: "https://www.99acres.com/resale-property-in-pune-ffid",
      },
    ];
  }

  // 10. Luxury & Penthouse Villas
  if (cat.includes("luxury") || cat.includes("penthouse") || cat.includes("villa") || cat.includes("mansion")) {
    return [
      {
        siteName: "SquareYards Luxury Collection",
        url: "https://www.squareyards.com/luxury-property-for-sale-in-pune",
      },
      {
        siteName: "99acres Luxury Apartments & Villas",
        url: "https://www.99acres.com/luxury-apartments-in-pune-ffid",
      },
    ];
  }

  // 11. Plots & Land
  if (cat.includes("plot") || cat.includes("land")) {
    return [
      {
        siteName: "SquareYards Plots",
        url: "https://www.squareyards.com/plots-for-sale-in-pune",
      },
      {
        siteName: "99acres Land & Plots",
        url: "https://www.99acres.com/plots-land-in-pune-ffid",
      },
    ];
  }

  // 12. MahaRERA Official Registry
  if (cat.includes("rera")) {
    return [
      {
        siteName: "MahaRERA Official Registry",
        url: "https://maharera.maharashtra.gov.in",
      },
    ];
  }

  // 13. Commercial Real Estate
  if (cat.includes("commercial")) {
    return [
      {
        siteName: "SquareYards Commercial",
        url: `https://www.squareyards.com/commercial-property-for-sale-in-pune`,
      },
      {
        siteName: "MagicBricks Commercial",
        url: `https://www.magicbricks.com/commercial-property-for-sale-in-pune-pppfs`,
      },
      {
        siteName: "MahaRERA Commercial Registry",
        url: "https://maharera.maharashtra.gov.in",
      },
    ];
  }

  // 14. Default: Residential Real Estate across multiple portals
  return [
    {
      siteName: "SquareYards Pune Feed",
      url: q 
        ? `https://www.squareyards.com/sale/property-for-sale-in-${term}`
        : "https://www.squareyards.com/sale/property-for-sale-in-pune",
    },
    {
      siteName: "99acres Pune Feed",
      url: "https://www.99acres.com/property-in-pune-ffid",
    },
    {
      siteName: "Housing.com Pune Feed",
      url: "https://housing.com/in/buy/pune/pune",
    },
  ];
}
