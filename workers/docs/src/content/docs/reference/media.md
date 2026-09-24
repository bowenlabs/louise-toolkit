---
title: media
description: "louise-toolkit/media—verified R2 uploads, an asset registry with alt/caption/dimensions, and Image-Resizing URL transforms."
sidebar:
  order: 13
---

```ts
import { putMedia, listMedia, deleteMedia, cfImage, mediaMetaByUrl } from "louise-toolkit/media";
```

A site's media library: security-verified R2 uploads (magic-byte sniffed), an
asset registry carrying `alt`/`caption`/dimensions, delete-with-reference-scan,
and Cloudflare Image-Resizing URL transforms. The HTTP surface that guards these
with an editor session is [`mediaRoute`](/reference/editor/); the `media` table
lives in [`louise-toolkit/db`](/reference/db/) (`mediaColumns`). Bindings: `MEDIA`
(R2) + `MEDIA_URL`. No required peers. See the [media guide](/guide/media/).

## Uploads

```ts
function putMedia(bucket: R2Bucket, file: File, opts?): Promise<PutMediaResult>;
```

Verifies the image from its **magic bytes** (never the client `Content-Type`),
enforces a size cap (default 10 MB), stores it with the _verified_ type + an
immutable cache header, and reads intrinsic `width`/`height` from the header
(`imageDimensions`—PNG/GIF/JPEG/WebP). Rejects oversize (413) / non-images
(415) without writing. `sniffImageType` and `imageDimensions` are exported.

## Listing & metadata

```ts
function listMedia(bucket, base): Promise<MediaItem[]>; // R2, newest-first
function mediaMetaByUrl(db, tableName, base, urls?): Promise<Map<string, MediaMeta>>;
```

`mediaMetaByUrl` loads asset-level `alt`/`caption`/dimensions from the registry,
keyed by public URL, so a render pass can fill an image's `alt` from its asset
default when no per-usage override is set. **Pass `urls`** (the images a page
actually needs) to scope the query to a bounded `IN (…)` lookup instead of a
full-table scan.

### Threading `mediaMeta`—a correctness footgun, not just a perf one

A section stores an image as a bare URL. The `alt` and `caption` an editor typed
live on the media **asset**, so rendering a page's images correctly means joining
every image field back to the registry.

`<Sections>` does that in **one bounded lookup for the whole page** and threads the
result down as `mediaMeta`. Render a `<MediaSlot>` outside that flow without
passing it and the image silently loses its editor-authored `alt` and `caption`—nothing errors, the image just renders bare, and the editor's work appears not to
have saved.

The collection step is **schema-driven**: it walks the catalog for fields of
`type: "image"` (recursing into `array` fields, and into a discriminated variant's
extra fields) rather than matching field names. A new section with an image field
is picked up because it declared one, not because someone remembered to update a
list.

Pass `mediaMeta` explicitly when a layout renders sections in two places, so the
lookup happens once rather than per host.

## Delete safety

```ts
function findMediaReferences(db, key, sources): Promise<MediaReference[]>;
function deleteMedia(bucket, key): Promise<void>;
```

Before deleting, cross-reference the object key against content columns you name
(`sources`), so an in-use asset isn't silently removed. `likePattern` escapes
LIKE metacharacters; identifiers are validated + quoted.

## Transforms

```ts
function cfImage(url, opts): string; // /cdn-cgi/image/… derivative
function cfImageSrcset(url, opts): { src; srcset }; // the width-descriptor ladder
function circleImage(url, size): { src; srcset }; // square focal crop + 1x/2x
function cropStyle(crop): { objectPosition; transform; transformOrigin };
function transformImage(images, input, opts?): Promise<Response>; // Images binding re-encode
```

Pure URL rewriting against Cloudflare **Image Resizing** (per-request billing, no
new cost, no server processing). `cropStyle` maps a per-usage `{ x, y, scale }`
`Crop` to CSS. `isMediaUrl(base, value)` is the one definition of "media-backed"
the sanitizer, the sections validator, and the settings route enforce with.

### `cfImageSrcset(url, opts)`—the load-bearing one

```ts
cfImageSrcset(url, { width, ratio?, steps?, fit?, gravity?, quality? });
```

Builds a width-descriptor `srcset` plus a default `src`, so the browser picks the
smallest derivative that covers the rendered width at the device's DPR. Reach for
this rather than hand-rolling `srcset` math over `cfImage`.

- **`steps`** defaults to `[0.5, 0.75, 1, 1.5, 2]`—multipliers of `width`,
  deduped and sorted, so one call covers half-size through retina.
- **`ratio`** (`"16/9"`) derives each derivative's height, so the CDN crop matches
  what `object-fit` shows instead of shipping pixels the layout throws away.
- **The returned `srcset` is meaningless without a `sizes` attribute** beside it.
  With no `sizes` the browser assumes `100vw` and over-fetches on every
  multi-column layout—which is the single most common way a "responsive" image
  ends up slower than a fixed one.

### `transformImage(images, input, opts?)`—when you need the bytes

Re-encodes through the Cloudflare **Images binding** and returns a `Response`
whose body is the encoded image.

**This one produces bytes and bills accordingly**, unlike the URL rewriting above.
Use it when the derivative must be materialized—persisted back to R2, handed to
an OG renderer—and prefer `cfImage`/`cfImageSrcset` for anything public and
on-the-fly.

Its `format` is a **concrete encode defaulting to `avif`**, not the `auto` that URL
rewriting serves per the request's `Accept`. You are choosing the format, so
choose deliberately.

### `defineImageProxy(config)`—images on someone else's host

`cfImage` only rewrites URLs on your own zone, and `transformImage` needs the
bytes. Neither helps with a third-party image whose URL you can't change. The
common case is a **signed** URL: the size is part of the signature, so the host
serves one fixed size and a smaller request is refused. Fourthwall's product images
are like this, fixed at 1920 px, so a grid of 300 px cards downloads full-size
photos.

`defineImageProxy` fetches the original through Cloudflare with `cf.image`, which
resizes it at the edge on the way through. One config drives both the route and
the URLs your markup emits:

```ts
import { FW_IMAGE_HOST } from "louise-toolkit/commerce/fourthwall";
import { defineImageProxy } from "louise-toolkit/media";

export const productImages = defineImageProxy({
  path: "/api/img/products",
  allowHosts: [FW_IMAGE_HOST],
  widths: [320, 640, 960, 1280],
  // Signed URLs never change content, so a long cache is safe:
  cacheControl: "public, max-age=31536000, immutable",
});

// the route, mounted at `path`
export const GET = ({ request }) => productImages.handle(request);

// the markup
<img src={productImages.url(src, 640)} srcset={productImages.srcset(src)} sizes="(min-width: 60rem) 25vw, 90vw" />
```

It's deliberately narrow:

- It serves **only the hosts you list**, over https, on the default port. Anything
  else gets a 400 without a fetch, so it can't be used as an open proxy.
- It serves **only the widths you list**, so the edge caches the handful your
  `srcset` asks for.
- It serves **only raster images**: JPEG, PNG, GIF, WebP, and AVIF. The response
  comes from your own origin, and an SVG opened directly runs its scripts there.
  Cloudflare sanitizes SVG when it resizes, but where resizing doesn't run, the
  upstream bytes come back untouched. Every response also carries
  `X-Content-Type-Options: nosniff` and a sandboxing `Content-Security-Policy`.
- It **doesn't follow redirects**. An allowed host that redirects elsewhere would
  otherwise make the proxy fetch from a host you never listed.
- If resizing fails for any reason, it **redirects to the original**, so the worst
  case is the page as it was. Resizing is unavailable locally and on a zone without
  Image Resizing, so there every request takes this path. Pass
  `onFailure: "error"` to answer 502 instead.

`url` and `srcset` leave an image on any other host untouched (`srcset` returns
`undefined`), so you can call them on every image. The format is negotiated from
`Accept` (AVIF, then WebP), and the response varies on `Accept`. `quality`,
`fit`, `edgeCacheTtl`, and the query parameter names are options. The widths are
yours to choose: match them to your `sizes`.

## Worked example: a three-column image grid

The whole path, from a media-library URL to a correct `sizes` string.

The layout: full width below 640px, two columns to 1024px, three above, inside a
container that maxes out at 1200px with 24px gaps.

**Work out what one image actually renders at.** At the widest, three columns of a
1200px container minus two gaps is `(1200 - 48) / 3 ≈ 384px`. Below that the
columns are fluid, so express them as viewport fractions:

```astro
---
const sizes = "(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 384px";
---
<div class="grid">
  {items.map((item) => (
    <MediaSlot
      src={item.url}
      alt={item.alt}
      width={384}      {/* the 1× width — drives the ladder */}
      sizes={sizes}    {/* what it actually renders at */}
      ratio="4/3"      {/* reserves the box; no layout shift as they load */}
    />
  ))}
</div>
```

`width={384}` with the default `steps` gives derivatives at 192, 288, 384, 576 and
768px, so a 2× phone at `100vw` and a 1× desktop tile both get something close to
right.

The fixed `384px` in the last `sizes` clause is deliberate: above 1024px the tile
stops growing, so `33vw` would over-fetch on a 2560px monitor. **`sizes` describes
the rendered box, not the breakpoint.**

Doing this with `cfImage` alone would mean building the same ladder by hand—the
thing `cfImageSrcset` exists to stop.

## Types

`MediaItem`, `MediaMeta`, `MediaReference`, `MediaRefSource`, `Crop`,
`CfImageOptions`, `CfImageSrcsetOptions`, `TransformImageOptions`,
`PutMediaResult`, `LouiseMediaEnv` (the `MEDIA` + `MEDIA_URL` binding contract;
`IMAGES` is the optional binding `transformImage` needs).
