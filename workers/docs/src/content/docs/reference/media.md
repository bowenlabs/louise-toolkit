---
title: media
description: "louise-toolkit/media — verified R2 uploads, an asset registry with alt/caption/dimensions, and Image-Resizing URL transforms."
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
(`imageDimensions` — PNG/GIF/JPEG/WebP). Rejects oversize (413) / non-images
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

### Threading `mediaMeta` — a correctness footgun, not just a perf one

A section stores an image as a bare URL. The `alt` and `caption` an editor typed
live on the media **asset**, so rendering a page's images correctly means joining
every image field back to the registry.

`<Sections>` does that in **one bounded lookup for the whole page** and threads the
result down as `mediaMeta`. Render a `<MediaSlot>` outside that flow without
passing it and the image silently loses its editor-authored `alt` and `caption` —
nothing errors, the image just renders bare, and the editor's work appears not to
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

### `cfImageSrcset(url, opts)` — the load-bearing one

```ts
cfImageSrcset(url, { width, ratio?, steps?, fit?, gravity?, quality? });
```

Builds a width-descriptor `srcset` plus a default `src`, so the browser picks the
smallest derivative that covers the rendered width at the device's DPR. Reach for
this rather than hand-rolling `srcset` math over `cfImage`.

- **`steps`** defaults to `[0.5, 0.75, 1, 1.5, 2]` — multipliers of `width`,
  deduped and sorted, so one call covers half-size through retina.
- **`ratio`** (`"16/9"`) derives each derivative's height, so the CDN crop matches
  what `object-fit` shows instead of shipping pixels the layout throws away.
- **The returned `srcset` is meaningless without a `sizes` attribute** beside it.
  With no `sizes` the browser assumes `100vw` and over-fetches on every
  multi-column layout — which is the single most common way a "responsive" image
  ends up slower than a fixed one.

### `transformImage(images, input, opts?)` — when you need the bytes

Re-encodes through the Cloudflare **Images binding** and returns a `Response`
whose body is the encoded image.

**This one produces bytes and bills accordingly**, unlike the URL rewriting above.
Use it when the derivative must be materialized — persisted back to R2, handed to
an OG renderer — and prefer `cfImage`/`cfImageSrcset` for anything public and
on-the-fly.

Its `format` is a **concrete encode defaulting to `avif`**, not the `auto` that URL
rewriting serves per the request's `Accept`. You are choosing the format, so
choose deliberately.

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

Doing this with `cfImage` alone would mean building the same ladder by hand — the
thing `cfImageSrcset` exists to stop.

## Types

`MediaItem`, `MediaMeta`, `MediaReference`, `MediaRefSource`, `Crop`,
`CfImageOptions`, `CfImageSrcsetOptions`, `TransformImageOptions`,
`PutMediaResult`, `LouiseMediaEnv` (the `MEDIA` + `MEDIA_URL` binding contract;
`IMAGES` is the optional binding `transformImage` needs).
