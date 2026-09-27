---
title: seo
description: "louise-toolkit/seo—a page row and site settings turned into head tags, plus sitemap.xml and robots.txt builders."
sidebar:
  order: 15.6
---

```ts
import {
  breadcrumbJsonLd,
  canonicalUrl,
  jsonLdScript,
  localBusinessJsonLd,
  organizationJsonLd,
  pageHead,
  productJsonLd,
  renderHeadTags,
  robotsTxt,
  SEO_DESCRIPTION_MAX,
  SEO_TITLE_MAX,
  shareImageSource,
  sitemapXml,
  type PageHead,
  type PageHeadInput,
} from "louise-toolkit/seo";
```

The Settings panel stores a meta description, a default share image, a favicon,
and **Hide from search engines**, and every page row has an SEO title,
description, share image, and `noindex`. None of them does anything until a page
prints it. `pageHead` decides every head tag from those rows and the request, and
`renderHeadTags` serializes the result with every value escaped. It's pure, with
no bindings, so it runs in any framework and in a unit test.

## `pageHead(input)`

```ts
function pageHead(input: PageHeadInput): PageHead;
```

| Input           | What it is                                                                                 |
| --------------- | ------------------------------------------------------------------------------------------ |
| `page`          | The page row. A `pages` row fits as it is.                                                 |
| `settings`      | The `site_settings` row, or `null`.                                                        |
| `origin`        | The site's origin, for example, `https://example.com`.                                     |
| `path`          | The request's path, with or without its query string.                                      |
| `titleTemplate` | `(pageTitle, siteName) => string`. Omit to use the page's title as it is.                  |
| `homeSlug`      | The slug the site serves at `/`. Its canonical URL is the origin's root.                   |
| `keepParams`    | Query parameters the page's content depends on. The canonical URL keeps these, sorted.     |
| `shareCardUrl`  | `(slug, title) => string`, the site's generated share card. Omit when it renders no cards. |
| `icon`          | The favicon when the settings have none.                                                   |
| `ogType`        | `og:type`. Default `"website"`.                                                            |

Each tag falls back in a fixed order:

- **Title:** the SEO title, then the title, through `titleTemplate`. The
  separator is the site's choice; the house style is a pipe, as in
  `About | Example Organization`. `og:title` is the page's own title, without
  the site name, which goes in `og:site_name`.
- **Description:** the SEO description, then the body's text clamped to
  `SEO_DESCRIPTION_MAX`, then the site-wide meta description. When none of them
  has text, the tag is left out rather than printed as `content=""`.
- **Robots:** `noindex` when the page's `noindex` or the site's **Hide from
  search engines** is on.
- **Canonical:** see [`canonicalUrl`](#canonicalurlorigin-path-keepparams).
- **Share image:** see [`shareImageSource`](#shareimagesourceinput). The result
  is an absolute URL, and anything that isn't `http` or `https` is dropped.
  `twitter:card` is `summary_large_image` with an image and `summary` without.
- **Icon:** the settings' favicon, then `icon`.

## `renderHeadTags(head)`

```ts
function renderHeadTags(head: PageHead): string;
```

The head as HTML, one tag per line: `<title>`, the description, robots,
canonical, icon, Open Graph, and `twitter:card`. Every value is escaped. Print
it inside `<head>` as raw HTML; the charset and viewport stay the page's own.

## `canonicalUrl(origin, path, keepParams?)`

The origin plus the path, with every query parameter dropped except
`keepParams`, which stay sorted, and the fragment removed. A page's content
doesn't vary by its query string, so without it every `?utm_source=…` variant is
another indexable copy. It shares its query handling with the edge cache key.

## `shareImageSource(input)`

```ts
function shareImageSource(input: {
  ogImage?: string | null;
  cards?: boolean;
  defaultImage?: string | null;
}): { kind: "image"; src: string } | { kind: "card" } | { kind: "none" };
```

What a share of a page shows, in order: the page's own `ogImage`, then the
site's generated card when it renders one, then the site-wide default image.
The Pages panel's share preview uses the same function, so the preview shows
what a share gets. Pass `ogCard: false` in the Settings config when your site
renders no cards, and the preview falls back to the default image the way a
share does.

<<<<<<< HEAD
## JSON-LD structured data

Search engines read schema.org markup to learn outright what a page is about.
Each builder takes its facts from the settings row or an argument, and supplies
none of its own: no default business type, currency, or country. A missing fact
is left out, not guessed.

| Builder                                            | Node                                                                                                           |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `organizationJsonLd(settings, { origin })`         | `Organization`: name, home URL, logo, tagline, email, phone, and social links as `sameAs`                      |
| `localBusinessJsonLd(settings, facts, { origin })` | The organization's facts, plus `facts.type`, the address parts, opening hours, price range, and location       |
| `productJsonLd(product, { origin })`               | `Product`, with an `Offer` in major units at the currency's own precision when it has a price                  |
| `breadcrumbJsonLd(trail, { origin })`              | `BreadcrumbList` from `[{ name, path }]`                                                                       |
| `jsonLdScript(node)`                               | The `<script type="application/ld+json">` element, with `<`, `>`, and `&` escaped so owner text can't close it |

The two organization builders return `undefined` when the settings have no site
name. Pass the nodes to `pageHead` as `jsonLd`, and `renderHeadTags` prints each
one after the other tags, skipping an `undefined` one:

```ts
const head = pageHead({
  page,
  settings,
  origin,
  path,
  jsonLd: [organizationJsonLd(settings, { origin })],
});
```

Mark up only what the page visibly shows. A structured address, opening hours,
and business type have no `site_settings` column yet: keep them in the row's
`custom` JSON, and render the visible address and hours from the same values,
so the text and the markup can't disagree.
=======
## `sitemapXml(entries)` and `robotsTxt(options?)`

Two pure builders. `sitemapXml` turns `{ loc, lastmod? }` entries into a
`sitemap.xml` document, in the order given, with every value escaped; a
`lastmod` that isn't a valid date is left out. `robotsTxt({ sitemapUrl?,
disallow? })` writes a `robots.txt` for every crawler, allowing everything
unless you list paths.

Don't disallow a `noindex` page. A crawler that can't fetch a page never sees its
`noindex`, so the page can still be indexed from links to it.

To serve both from the published pages, mount
[`sitemapRoute`](/reference/editor/#the-sitemap-route) from
`louise-toolkit/editor`.
>>>>>>> origin/main

## Limits

`SEO_TITLE_MAX` (60) and `SEO_DESCRIPTION_MAX` (155) are where search results
cut off. `metaDescription()`, `suggestSeo`, `pageHead`, and the Pages panel's
character counts all read them. `louise-toolkit/ai` exports the same two
constants.

## With Astro

`@louise-toolkit/astro` exports `seoHead(Astro, input)`, which fills `origin`
and `path` from the request and returns the rendered tags. The origin is
`input.origin`, then the configured `site`, then the request's own origin; set
`site` in `astro.config` so a preview host can't leak into the canonical URL.

```astro
---
import { seoHead } from "@louise-toolkit/astro";

const head = seoHead(Astro, {
  page,
  settings,
  homeSlug: "home",
  titleTemplate: (title, site) => (site ? `${title} | ${site}` : title),
  shareCardUrl: (slug, title) =>
    `/og.png?slug=${encodeURIComponent(slug)}&title=${encodeURIComponent(title)}`,
  icon: "/favicon.svg",
});
---

<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <Fragment set:html={head} />
</head>
```

Build `shareCardUrl` from the same slug and title your publish step warms, so
the first share of a page is a cache hit.
