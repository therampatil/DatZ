export interface FetchOptions {
  timeoutMs?: number;
  headers?: Record<string, string>;
}

export interface FetchResult {
  url: string;
  finalUrl: string;
  statusCode: number;
  html: string;
  contentType: string;
}

const DEFAULT_USER_AGENTS = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
];

export async function fetchWebPage(targetUrl: string, options: FetchOptions = {}): Promise<FetchResult> {
  const timeoutMs = options.timeoutMs ?? 20_000;
  const userAgent = DEFAULT_USER_AGENTS[Math.floor(Math.random() * DEFAULT_USER_AGENTS.length)];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(targetUrl, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": userAgent,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9,hi;q=0.8",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
        ...options.headers,
      },
    });

    const contentType = response.headers.get("content-type") || "";
    const html = await response.text();

    return {
      url: targetUrl,
      finalUrl: response.url || targetUrl,
      statusCode: response.status,
      html,
      contentType,
    };
  } finally {
    clearTimeout(timer);
  }
}
