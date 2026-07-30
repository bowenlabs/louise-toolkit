---
title: browser
description: "louise-toolkit/browser — per-page OG images behind one renderer contract, a content-hashed cache, and a scheduled link checker."
sidebar:
  order: 14
---

```ts
import {
  ogCardSvg,
  ogCacheKey,
  ogImage,
  createResvgRenderer,
  checkLinks,
} from "louise-toolkit/browser";
```

Edge rendering: per-page Open Graph cards and a scheduled link check. Binding:
`BROWSER` (Browser Rendering) — **only** for the Puppeteer renderer and only when
it actually runs. Optional peers: `@resvg/resvg-wasm`, `@cloudflare/puppeteer`.

## Two renderers, one contract

```ts
type OgRenderer = (html: string) => Promise<Uint8Array>;
```

Everything that rasterizes a card satisfies that one type, which is what lets the
caching layer stay ignorant of how bytes get made — and lets a test inject a stub
instead of a browser.

|                                                  |                                                                                                                                                                                                    |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`createResvgRenderer(options)`**               | The default hot path. Rasterizes an **SVG** string via resvg/WASM — a static card is text on a field, so this is pure SVG→PNG, roughly 100× cheaper than a browser session and with no cold start. |
| **`createPuppeteerRenderer(browser, options?)`** | Drives Browser Rendering and screenshots **HTML**. Keep it for genuine full-page work — live previews, anything needing real layout or web fonts.                                                  |

Note the input differs: resvg takes SVG, Puppeteer takes HTML. `ogCardSvg`
produces the former.

**Both peers are optional and dynamically imported, and that is load-bearing.**
Neither package is pulled into a bundle unless a render actually happens, so a
site that never generates a card pays nothing. The instinct to "just add the
import" at the top of your worker undoes exactly this.

`createResvgRenderer` needs two things Workers can't supply on its own:

```ts
const render = createResvgRenderer({
  wasm, // the compiled index_bg.wasm
  fonts: [robotoFlexBuffer], // at least one — Workers has no system fonts
  defaultFontFamily: "Roboto Flex",
});
```

**Without a font, text does not render** — the card comes back as a background
with nothing on it, and nothing errors. Set `defaultFontFamily` to the family you
actually pass, so a single supplied font is used no matter what the SVG asks for.
WASM init is global to the isolate and initializing twice throws; the renderer
guards that internally, so constructing one per request is fine.

## The cache is the point

```ts
function ogCacheKey(slug: string, content: string, opts?): Promise<string>;
function ogImage(opts: OgImageOptions): Promise<{ bytes: Uint8Array; cached: boolean }>;
```

An OG card is deterministic for a given page plus its content, so the key is
`<prefix>/<safe-slug>-<contentHash>.<ext>` and `ogImage` **renders only on a
miss**. On a hit the stored bytes come back with `cached: true` and the renderer
is never called — no browser session, no WASM init.

Editing a page mints a new key and the old card falls out naturally; an unchanged
page always resolves to the same one. There is no invalidation step to forget.

`OgImageCache` is declared structurally — `get`/`put` — so an R2 bucket or a KV
namespace both satisfy it without the module depending on either. Omit `cache`
and every call renders.

```ts
const key = await ogCacheKey(slug, `${title}\n${body}`);
const { bytes, cached } = await ogImage({
  cacheKey: key,
  markup: ogCardSvg(title, { brand: "louise", footer: "louisetoolkit.com" }),
  render,
  cache: ogCacheStore(env),
});
```

`ogCardSvg(title, opts?)` builds the card (1200×630 by default) and `wrapTitle`
breaks a title across lines. `fontFamily` must match a family the renderer
loaded, or you get the empty-card failure above.

## Link checking

```ts
function extractLinks(html: string, base: string): string[];
function checkLinks(opts: CheckLinksOptions): Promise<BrokenLink[]>;
```

Crawls `paths`, collects their links, and returns the ones that don't resolve.
**No browser session** — reading anchors is a regex over HTML, so this is plain
`fetch` and cheap enough for a daily cron. Each distinct target is checked once,
and a page that itself fails to load is reported too.

`sameOriginOnly` defaults to `true`, so someone else's outage doesn't fill your
report with failures you can't fix. `fetch` is injectable, which is how this is
unit-tested without the network.

`BrokenLink` carries `{ url, from, status }`, where `status` is `"error"` for a
request that threw (DNS, timeout) rather than returned. Feed the result to
[`health`](/reference/health/), which folds it into the dashboard snapshot.

## Types

`OgRenderer`, `OgImageCache`, `LouiseBrowserEnv`, `OgImageOptions`,
`OgImageResult`, `OgCacheKeyOptions`, `OgCardOptions`, `WrapTitleOptions`,
`ResvgRendererOptions`, `PuppeteerRendererOptions`, `CheckLinksOptions`,
`BrokenLink`.
