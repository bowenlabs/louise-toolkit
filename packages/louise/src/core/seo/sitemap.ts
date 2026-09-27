// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise-toolkit/seo—`sitemap.xml` and `robots.txt`, as pure builders. The route
// that serves them from the published pages is `sitemapRoute` in
// louise-toolkit/editor; these two only turn values into text, so a site that
// builds its own list can use them too.

/** One URL in a sitemap. */
export interface SitemapEntry {
  /** The absolute URL. */
  loc: string;
  /** When the page last changed. A `Date` or an ISO 8601 string; left out when absent. */
  lastmod?: Date | string | null;
}

const XML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};

function escapeXml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => XML_ESCAPES[ch] as string);
}

function lastmodOf(value: Date | string | null | undefined): string | undefined {
  if (value == null) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/**
 * Build a `sitemap.xml` document from `entries`, in the order given, with every
 * value escaped. An entry whose `lastmod` isn't a valid date is listed without
 * one.
 */
export function sitemapXml(entries: readonly SitemapEntry[]): string {
  const urls = entries.map((entry) => {
    const lastmod = lastmodOf(entry.lastmod);
    return `  <url><loc>${escapeXml(entry.loc)}</loc>${
      lastmod ? `<lastmod>${lastmod}</lastmod>` : ""
    }</url>`;
  });
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    "</urlset>",
    "",
  ].join("\n");
}

export interface RobotsTxtOptions {
  /** The sitemap's absolute URL, listed as `Sitemap:`. */
  sitemapUrl?: string;
  /**
   * Paths no crawler should fetch, such as an API prefix. Don't list a page
   * that's `noindex`: a crawler that can't fetch a page never sees its
   * `noindex`, so a blocked page can still be indexed from links to it.
   */
  disallow?: readonly string[];
}

/**
 * Build a `robots.txt` for every crawler. With no `disallow`, it allows
 * everything.
 */
export function robotsTxt(options: RobotsTxtOptions = {}): string {
  const disallow = options.disallow ?? [];
  const lines = ["User-agent: *"];
  if (disallow.length === 0) lines.push("Disallow:");
  for (const path of disallow) lines.push(`Disallow: ${path.replace(/[\r\n]/g, "")}`);
  if (options.sitemapUrl) lines.push("", `Sitemap: ${options.sitemapUrl.replace(/[\r\n]/g, "")}`);
  return `${lines.join("\n")}\n`;
}
