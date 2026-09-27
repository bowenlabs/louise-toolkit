// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise-toolkit/seo—a page row plus site settings, turned into head tags.
//
// The Settings panel stores a meta description, a default share image, a
// favicon, and "Hide from search engines", and every page row has an SEO
// title, description, share image, and `noindex`. None of it does anything
// until a page prints it. `pageHead` decides every tag from those rows and the
// request, and `renderHeadTags` serializes the result with every value
// escaped. Framework-agnostic: a site's template prints the string.
//
// What stays a site parameter: the origin, the title template, the home slug,
// the share card URL, and any query parameters a page's content depends on.

import { metaDescription } from "../security/text.js";
import { filterQuery } from "./query.js";
import { shareImageSource } from "./share.js";

export { SEO_DESCRIPTION_MAX, SEO_TITLE_MAX } from "./limits.js";
export { type ShareImageInput, type ShareImageSource, shareImageSource } from "./share.js";
export { type RobotsTxtOptions, robotsTxt, type SitemapEntry, sitemapXml } from "./sitemap.js";

/** The page fields the head reads. A `pages` row fits as it is. */
export interface PageHeadPage {
  slug: string;
  title: string;
  /** Rich HTML; the description falls back to its text. */
  body?: string | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
  ogImage?: string | null;
  noindex?: boolean | null;
}

/** The site settings fields the head reads. A `site_settings` row fits as it is. */
export interface PageHeadSettings {
  siteName?: string | null;
  faviconUrl?: string | null;
  metaDescription?: string | null;
  defaultOgImageUrl?: string | null;
  disableIndexing?: boolean | null;
}

export interface PageHeadInput {
  page: PageHeadPage;
  settings?: PageHeadSettings | null;
  /** The site's origin, for example, `https://example.com`. */
  origin: string;
  /** The request's path, with or without its query string. */
  path: string;
  /**
   * Builds the `<title>` from the page's title and the site name. Omit to use
   * the page's title as it is. The separator is the site's choice; the house
   * style is a pipe, as in `About | Example Organization`.
   */
  titleTemplate?: (pageTitle: string, siteName: string | undefined) => string;
  /** The slug a site serves at `/`. Its canonical URL is the origin's root. */
  homeSlug?: string;
  /**
   * Query parameters the page's content depends on. The canonical URL keeps
   * these, sorted, and drops every other parameter. Default: none.
   */
  keepParams?: readonly string[];
  /**
   * The URL of the site's generated share card for a page, given its slug and
   * its SEO title or title. Omit when the site renders no cards. A relative URL
   * resolves against `origin`.
   */
  shareCardUrl?: (slug: string, title: string) => string;
  /** The favicon when the settings have none. */
  icon?: string;
  /** `og:type`. Default `"website"`. */
  ogType?: string;
}

/** Everything a page's head declares. Serialize it with {@link renderHeadTags}. */
export interface PageHead {
  /** The `<title>`, after the site's title template. */
  title: string;
  /** Omitted rather than empty when nothing describes the page. */
  description?: string;
  robots?: "noindex";
  canonical: string;
  icon?: string;
  og: {
    /** The page's own title, without the site name. */
    title: string;
    description?: string;
    url: string;
    type: string;
    siteName?: string;
    /** Absolute. */
    image?: string;
  };
  twitterCard: "summary" | "summary_large_image";
}

/** `value` trimmed, or `undefined` when it's empty. */
function present(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/** `src` as an absolute HTTP or HTTPS URL against `origin`, or `undefined`. */
function absoluteUrl(src: string, origin: string): string | undefined {
  try {
    const url = new URL(src, origin);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The canonical URL for a request: the origin plus the path, with every query
 * parameter dropped except `keepParams`, which stay sorted. A page's content
 * doesn't vary by its query string, so without this every `?utm_source=…` or
 * `?ref=…` variant is another indexable copy.
 */
export function canonicalUrl(
  origin: string,
  path: string,
  keepParams: readonly string[] = [],
): string {
  const keep = new Set(keepParams);
  const url = filterQuery(new URL(path, origin), (name) => keep.has(name));
  url.hash = "";
  return url.toString();
}

/**
 * The head of a content page, from its row, the site settings, and the
 * request. Pure, so it runs the same in any framework or a unit test.
 *
 * - **Title:** the page's SEO title, then its title, through `titleTemplate`.
 * - **Description:** the SEO description, then the body's text (clamped to
 *   `SEO_DESCRIPTION_MAX`), then the site-wide meta description. Omitted when
 *   none of them has text, never `content=""`.
 * - **Robots:** `noindex` when the page or the site's "Hide from search
 *   engines" says so.
 * - **Canonical:** see {@link canonicalUrl}; the home slug maps to `/`.
 * - **Share image:** see {@link shareImageSource}.
 */
export function pageHead(input: PageHeadInput): PageHead {
  const { page, origin } = input;
  const settings = input.settings ?? {};
  const siteName = present(settings.siteName);
  const pageTitle = present(page.seoTitle) ?? page.title;
  const title = input.titleTemplate ? input.titleTemplate(pageTitle, siteName) : pageTitle;
  const description =
    present(page.seoDescription) ?? metaDescription(page.body) ?? present(settings.metaDescription);

  const isHome = input.homeSlug !== undefined && page.slug === input.homeSlug;
  const canonical = isHome
    ? canonicalUrl(origin, "/")
    : canonicalUrl(origin, input.path, input.keepParams);

  const source = shareImageSource({
    ogImage: page.ogImage,
    cards: input.shareCardUrl !== undefined,
    defaultImage: settings.defaultOgImageUrl,
  });
  const imageSrc =
    source.kind === "image"
      ? source.src
      : source.kind === "card"
        ? input.shareCardUrl?.(page.slug, pageTitle)
        : undefined;
  const image = imageSrc === undefined ? undefined : absoluteUrl(imageSrc, origin);

  const noindex = Boolean(page.noindex) || Boolean(settings.disableIndexing);
  const icon = present(settings.faviconUrl) ?? present(input.icon);

  return {
    title,
    ...(description !== undefined && { description }),
    ...(noindex && { robots: "noindex" as const }),
    canonical,
    ...(icon !== undefined && { icon }),
    og: {
      title: pageTitle,
      ...(description !== undefined && { description }),
      url: canonical,
      type: input.ogType ?? "website",
      ...(siteName !== undefined && { siteName }),
      ...(image !== undefined && { image }),
    },
    twitterCard: image === undefined ? "summary" : "summary_large_image",
  };
}

/** Escape a value for an HTML attribute or text node. */
function escape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * {@link PageHead} as HTML: `<title>`, the description, robots, canonical,
 * icon, Open Graph, and Twitter tags, one per line, every value escaped. Print
 * it inside `<head>` as raw HTML; the charset and viewport stay the page's own.
 */
export function renderHeadTags(head: PageHead): string {
  const meta = (attr: "name" | "property", key: string, content: string | undefined): string[] =>
    content === undefined ? [] : [`<meta ${attr}="${key}" content="${escape(content)}">`];
  return [
    `<title>${escape(head.title)}</title>`,
    ...meta("name", "description", head.description),
    ...meta("name", "robots", head.robots),
    `<link rel="canonical" href="${escape(head.canonical)}">`,
    ...(head.icon === undefined ? [] : [`<link rel="icon" href="${escape(head.icon)}">`]),
    ...meta("property", "og:title", head.og.title),
    ...meta("property", "og:description", head.og.description),
    ...meta("property", "og:url", head.og.url),
    ...meta("property", "og:type", head.og.type),
    ...meta("property", "og:site_name", head.og.siteName),
    ...meta("property", "og:image", head.og.image),
    ...meta("name", "twitter:card", head.twitterCard),
  ].join("\n");
}
