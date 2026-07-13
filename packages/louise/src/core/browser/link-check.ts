// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// Scheduled link-checking (issue #5). Crawls a set of pages, extracts their
// links, and reports the ones that don't resolve — driven from a Cron Trigger.
// Pure `fetch` (no browser session needed to read anchors), with an injectable
// `fetch` so it's unit-testable without the network.

/** A link that failed to resolve, and the page it was found on. */
export interface BrokenLink {
  url: string;
  from: string;
  /** HTTP status, or `"error"` when the request threw (DNS/timeout/etc). */
  status: number | "error";
}

/** Extract resolvable, absolute link targets from an HTML string. Skips
 *  in-page anchors and non-HTTP schemes (`mailto:`/`tel:`/`javascript:`). */
export function extractLinks(html: string, base: string): string[] {
  const out = new Set<string>();
  for (const match of html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) {
    const href = match[1];
    if (/^(#|mailto:|tel:|javascript:|data:)/i.test(href)) continue;
    try {
      out.add(new URL(href, base).href);
    } catch {
      // Unparseable href — ignore.
    }
  }
  return [...out];
}

export interface CheckLinksOptions {
  /** Origin the pages are served from, e.g. `https://louisetoolkit.com`. */
  base: string;
  /** Page paths to crawl, e.g. `["/docs/", "/docs/guide/"]`. */
  paths: string[];
  /** Injectable fetch (defaults to the global). */
  fetch?: typeof fetch;
  /** Only check links on the same origin as `base`. Default `true`. */
  sameOriginOnly?: boolean;
}

/**
 * Crawl `paths`, collect their links, and return the ones that don't resolve
 * (non-2xx/3xx or a thrown request). Each distinct target is checked once. A
 * page that itself fails to load is reported too. Same-origin by default so an
 * external outage doesn't spam the report.
 */
export async function checkLinks(options: CheckLinksOptions): Promise<BrokenLink[]> {
  const doFetch = options.fetch ?? fetch;
  const sameOriginOnly = options.sameOriginOnly !== false;
  const baseOrigin = new URL(options.base).origin;

  const broken: BrokenLink[] = [];
  const checked = new Set<string>();

  for (const path of options.paths) {
    const pageUrl = new URL(path, options.base).href;
    let html: string;
    try {
      const res = await doFetch(pageUrl);
      if (!res.ok) {
        broken.push({ url: pageUrl, from: pageUrl, status: res.status });
        continue;
      }
      html = await res.text();
    } catch {
      broken.push({ url: pageUrl, from: pageUrl, status: "error" });
      continue;
    }

    for (const link of extractLinks(html, options.base)) {
      if (sameOriginOnly && new URL(link).origin !== baseOrigin) continue;
      if (checked.has(link)) continue;
      checked.add(link);
      try {
        const res = await doFetch(link);
        if (!res.ok) broken.push({ url: link, from: pageUrl, status: res.status });
      } catch {
        broken.push({ url: link, from: pageUrl, status: "error" });
      }
    }
  }

  return broken;
}
