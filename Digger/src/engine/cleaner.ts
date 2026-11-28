import * as cheerio from "cheerio";

export interface CleanedPage {
  title: string;
  markdown: string;
  metaDescription: string;
}

export function cleanHtmlToMarkdown(html: string, baseUrl?: string): CleanedPage {
  const $ = cheerio.load(html);

  // 1. Remove non-content elements
  $(
    "script, style, noscript, svg, canvas, iframe, video, audio, [aria-hidden='true'], link, meta"
  ).remove();
  $("nav, footer, header, [role='navigation'], [role='banner'], [role='contentinfo']").remove();
  $(".cookie-banner, .advertisement, .ad-banner, .popup, #sidebar, .sidebar").remove();

  const title = $("title").text().trim() || $("h1").first().text().trim() || "Untitled Page";
  const metaDescription =
    $('meta[name="description"]').attr("content")?.trim() ||
    $('meta[property="og:description"]').attr("content")?.trim() ||
    "";

  // 2. Normalize links to include absolute URLs if baseUrl provided
  if (baseUrl) {
    $("a[href]").each((_, el) => {
      const href = $(el).attr("href");
      if (href && !href.startsWith("http") && !href.startsWith("mailto:") && !href.startsWith("tel:")) {
        try {
          const abs = new URL(href, baseUrl).toString();
          $(el).attr("href", abs);
        } catch {
          // ignore
        }
      }
    });
  }

  // 3. Convert headers and listing blocks to markdown-like lines
  $("h1, h2, h3, h4").each((_, el) => {
    const level = el.tagName.toLowerCase();
    const prefix = level === "h1" ? "# " : level === "h2" ? "## " : "### ";
    $(el).text(`\n${prefix}${$(el).text().trim()}\n`);
  });

  $("li").each((_, el) => {
    $(el).text(`\n* ${$(el).text().trim()}\n`);
  });

  // Extract text and collapse multiple empty lines
  const rawText = $("body").text() || $.text();
  const markdown = rawText
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n/g, "\n\n")
    .trim();

  // Cap length to ~50,000 chars to avoid exceeding token limits while keeping rich listings
  const truncatedMarkdown = markdown.length > 50_000 ? markdown.slice(0, 50_000) + "\n...[Content Truncated]" : markdown;

  return {
    title,
    markdown: truncatedMarkdown,
    metaDescription,
  };
}
