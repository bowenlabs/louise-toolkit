// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// Scheduled link-checking (issue #5). Crawls a set of pages, extracts their
// links, and reports the ones that don't resolve—driven from a Cron Trigger.
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
      // Unparseable href—ignore.
    }
  }
  return [...out];
}

/** An internal link that answers with a redirect, and the page that holds it. */
export interface RedirectFinding {
  /** The URL the page links to. */
  url: string;
  /** The page whose link it is: that's where the fix goes. */
  from: string;
  /** The first hop's status: 301, 302, 307, or 308. */
  status: number;
  /** Where the redirects end, or the last `Location` when they don't. */
  to: string;
  /** Redirects before the final answer. More than one is a chain. */
  hops: number;
  /** The final answer's status, or `"error"` when a hop failed or the chain ran too long. */
  finalStatus: number | "error";
}

/** Why a page's indexing directives need a look. */
export type IndexingIssue = "noindex" | "canonical-off-origin" | "canonical-elsewhere";

/** A crawled page whose robots directive or canonical link keeps it out of search. */
export interface IndexingFinding {
  url: string;
  issue: IndexingIssue;
  /** The canonical link, for the two canonical issues. */
  canonical?: string;
}

/** A title more than one crawled page shares. */
export interface DuplicateTitleFinding {
  title: string;
  pages: string[];
}

/** What a page tells a crawler about itself. */
export interface PageSignals {
  /** Every robots directive, lowercased, from the meta tag and `X-Robots-Tag`. */
  robots: string[];
  /** Whether a directive is `noindex` or `none`. */
  noindex: boolean;
  /** The canonical link, absolute, when the page has one. */
  canonical?: string;
  title?: string;
  description?: string;
}

/** Read one attribute's value from a tag's source. */
function attr(tag: string, name: string): string | undefined {
  const match = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  return match ? (match[1] ?? match[2] ?? match[3]) : undefined;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/**
 * Read a page's robots directives (the `robots` meta tag and the `X-Robots-Tag`
 * header), its canonical link, its title, and its meta description. Pure: it
 * parses the HTML text, so it runs in a test or a Worker alike.
 */
export function pageSignals(html: string, headers: Headers, url: string): PageSignals {
  const robots: string[] = [];
  const addDirectives = (value: string | null | undefined) => {
    for (const part of (value ?? "").split(",")) {
      // `X-Robots-Tag` may name a crawler first: `googlebot: noindex`.
      const directive = part
        .replace(/^[^:]*:\s*(?=\w)/, "")
        .trim()
        .toLowerCase();
      if (directive) robots.push(directive);
    }
  };
  addDirectives(headers.get("x-robots-tag"));
  let description: string | undefined;
  for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
    const name = attr(tag, "name")?.toLowerCase();
    if (name === "robots") addDirectives(attr(tag, "content"));
    else if (name === "description")
      description = decodeEntities(attr(tag, "content") ?? "").trim();
  }
  let canonical: string | undefined;
  for (const [tag] of html.matchAll(/<link\b[^>]*>/gi)) {
    const rel = attr(tag, "rel")?.toLowerCase().split(/\s+/);
    const href = attr(tag, "href");
    if (!rel?.includes("canonical") || !href) continue;
    try {
      canonical = new URL(decodeEntities(href), url).href;
    } catch {
      // An unparseable canonical is as good as none.
    }
    break;
  }
  const titleMatch = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = titleMatch
    ? decodeEntities(titleMatch[1] as string)
        .replace(/\s+/g, " ")
        .trim()
    : "";
  return {
    robots,
    noindex: robots.includes("noindex") || robots.includes("none"),
    ...(canonical !== undefined && { canonical }),
    ...(title && { title }),
    ...(description && { description }),
  };
}

export interface CheckLinksOptions {
  /** Origin the pages are served from, for example, `https://example.com`. */
  base: string;
  /** Page paths to start from, for example, `["/", "/docs/"]`. */
  paths: string[];
  /** Injectable fetch (defaults to the global). */
  fetch?: typeof fetch;
  /** Only check links on the same origin as `base`. Default `true`. */
  sameOriginOnly?: boolean;
  /**
   * Follow same-origin links from the start paths and check those pages too,
   * breadth-first. `maxPages` caps the pages read (the start paths included),
   * and `maxDepth` the links followed from a start path. Off by default: only
   * the start paths are read.
   */
  crawl?: { maxPages: number; maxDepth: number };
  /**
   * The most requests the scan makes, counting every redirect hop. A Worker's
   * subrequest limit applies to a scheduled handler too, so set it below
   * yours; the report says when the scan stopped early. Default: no cap.
   */
  maxRequests?: number;
}

/** Everything {@link crawlSite} found. */
export interface CrawlReport {
  brokenLinks: BrokenLink[];
  redirects: RedirectFinding[];
  indexing: IndexingFinding[];
  duplicateTitles: DuplicateTitleFinding[];
  /** The pages read, in the order they were read. */
  pages: string[];
  /** True when `maxRequests` stopped the scan before it finished. */
  truncated: boolean;
}

/** How many redirects to follow before calling it a loop. */
const MAX_HOPS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** `url` without its fragment, so `/a#x` and `/a` are one page. */
function withoutHash(url: string): string {
  const u = new URL(url);
  u.hash = "";
  return u.href;
}

/**
 * Read pages and check their links, reporting what a crawler would trip on:
 * links that don't resolve, internal links that redirect, pages whose robots
 * directive or canonical keeps them out of search, and titles shared by more
 * than one page. Driven from a Cron Trigger, and pure `fetch` otherwise.
 *
 * Every request uses `redirect: "manual"`, and the scan follows the hops itself,
 * so a link that reaches a live page through a redirect still counts as
 * working, but shows up in `redirects` against the page that holds it.
 */
export async function crawlSite(options: CheckLinksOptions): Promise<CrawlReport> {
  const doFetch = options.fetch ?? fetch;
  const sameOriginOnly = options.sameOriginOnly !== false;
  const baseOrigin = new URL(options.base).origin;
  const maxPages = options.crawl ? Math.max(1, options.crawl.maxPages) : Infinity;
  const maxDepth = options.crawl ? Math.max(0, options.crawl.maxDepth) : 0;
  const maxRequests = options.maxRequests ?? Infinity;

  const report: CrawlReport = {
    brokenLinks: [],
    redirects: [],
    indexing: [],
    duplicateTitles: [],
    pages: [],
    truncated: false,
  };
  let requests = 0;
  const titles = new Map<string, string[]>();
  const checked = new Set<string>();
  const queued = new Set<string>();
  const queue: { url: string; from: string; depth: number }[] = [];

  class OutOfRequests extends Error {}

  /** Fetch `url`, following redirects by hand. */
  async function resolve(url: string): Promise<{
    response?: Response;
    finalUrl: string;
    hops: { status: number; to: string }[];
    status: number | "error";
  }> {
    const hops: { status: number; to: string }[] = [];
    let current = url;
    for (;;) {
      if (requests >= maxRequests) throw new OutOfRequests();
      requests++;
      let res: Response;
      try {
        res = await doFetch(current, { redirect: "manual" });
      } catch {
        return { finalUrl: current, hops, status: "error" };
      }
      const location = res.headers.get("location");
      if (!REDIRECT_STATUSES.has(res.status) || !location) {
        return { response: res, finalUrl: current, hops, status: res.status };
      }
      const next = new URL(location, current).href;
      hops.push({ status: res.status, to: next });
      if (hops.length > MAX_HOPS) return { finalUrl: next, hops, status: "error" };
      current = next;
    }
  }

  /** Resolve a link, recording a broken link or an internal redirect against `from`. */
  async function check(url: string, from: string) {
    const result = await resolve(url);
    const ok = typeof result.status === "number" && result.status >= 200 && result.status < 300;
    if (result.hops.length > 0 && new URL(url).origin === baseOrigin) {
      report.redirects.push({
        url,
        from,
        status: (result.hops[0] as { status: number }).status,
        to: result.finalUrl,
        hops: result.hops.length,
        finalStatus: result.status,
      });
    }
    if (!ok) report.brokenLinks.push({ url, from, status: result.status });
    return ok ? result : undefined;
  }

  /** Read one page: its signals, its title, and its links. */
  async function readPage(entry: { url: string; from: string; depth: number }) {
    const result = await check(entry.url, entry.from);
    if (!result?.response) return;
    const page = withoutHash(result.finalUrl);
    report.pages.push(page);
    // A start path is a page by definition; a crawled link is read only when it
    // says it's HTML, so a feed or a download isn't parsed for links.
    const type = result.response.headers.get("content-type") ?? "text/html";
    if (entry.depth > 0 && !type.includes("html")) return;
    const html = await result.response.text();

    const signals = pageSignals(html, result.response.headers, page);
    if (signals.noindex) report.indexing.push({ url: page, issue: "noindex" });
    if (signals.canonical !== undefined) {
      const canonical = withoutHash(signals.canonical);
      if (new URL(canonical).origin !== baseOrigin) {
        report.indexing.push({ url: page, issue: "canonical-off-origin", canonical });
      } else if (new URL(canonical).pathname !== new URL(page).pathname) {
        report.indexing.push({ url: page, issue: "canonical-elsewhere", canonical });
      }
    }
    if (signals.title && !signals.noindex) {
      titles.set(signals.title, [...(titles.get(signals.title) ?? []), page]);
    }

    for (const link of extractLinks(html, page)) {
      const target = withoutHash(link);
      const sameOrigin = new URL(target).origin === baseOrigin;
      if (sameOriginOnly && !sameOrigin) continue;
      if (checked.has(target) || queued.has(target)) continue;
      const crawlable =
        options.crawl !== undefined && sameOrigin && entry.depth < maxDepth && !isAsset(target);
      if (crawlable) {
        queued.add(target);
        queue.push({ url: target, from: page, depth: entry.depth + 1 });
      } else {
        checked.add(target);
        await check(target, page);
      }
    }
  }

  for (const path of options.paths) {
    const url = withoutHash(new URL(path, options.base).href);
    if (queued.has(url)) continue;
    queued.add(url);
    queue.push({ url, from: url, depth: 0 });
  }

  try {
    let read = 0;
    while (queue.length > 0) {
      const entry = queue.shift() as { url: string; from: string; depth: number };
      if (read >= maxPages) {
        // Past the page cap: still check the link, just don't read the page.
        checked.add(entry.url);
        await check(entry.url, entry.from);
        continue;
      }
      read++;
      await readPage(entry);
    }
  } catch (err) {
    if (!(err instanceof OutOfRequests)) throw err;
    report.truncated = true;
  }

  for (const [title, pages] of titles) {
    if (pages.length > 1) report.duplicateTitles.push({ title, pages });
  }
  return report;
}

/** A URL whose path ends in a file extension that isn't a page. */
function isAsset(url: string): boolean {
  return /\.(?:css|js|mjs|json|xml|txt|ico|png|jpe?g|gif|webp|avif|svg|woff2?|pdf|zip)$/i.test(
    new URL(url).pathname,
  );
}

/**
 * The broken links {@link crawlSite} finds: a link whose final answer isn't 2xx,
 * or a request that threw. A link that redirects to a live page isn't broken.
 * Each distinct target is checked once, and a start page that fails to load is
 * reported too. Same-origin by default so an external outage doesn't spam the
 * report.
 */
export async function checkLinks(options: CheckLinksOptions): Promise<BrokenLink[]> {
  return (await crawlSite(options)).brokenLinks;
}
