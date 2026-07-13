---
title: media
description: "louise/media — verified R2 uploads, an asset registry with alt/caption/dimensions, and Image-Resizing URL transforms."
sidebar:
  order: 13
---

```ts
import { putMedia, listMedia, deleteMedia, cfImage, mediaMetaByUrl } from "louise/media";
```

A site's media library: security-verified R2 uploads (magic-byte sniffed), an
asset registry carrying `alt`/`caption`/dimensions, delete-with-reference-scan,
and Cloudflare Image-Resizing URL transforms. The HTTP surface that guards these
with an editor session is [`mediaRoute`](/reference/editor/); the `media` table
lives in [`louise/db`](/reference/db/) (`mediaColumns`). Bindings: `MEDIA`
(R2) + `MEDIA_URL`. No required peers. See the [media guide](/guide/media/).

## Uploads

```ts
function putMedia(bucket: R2Bucket, file: File, opts?): Promise<PutMediaResult>;
```

Verifies the image from its **magic bytes** (never the client `Content-Type`),
enforces a size cap (default 10 MB), stores it with the *verified* type + an
immutable cache header, and reads intrinsic `width`/`height` from the header
(`imageDimensions` — PNG/GIF/JPEG/WebP). Rejects oversize (413) / non-images
(415) without writing. `sniffImageType` and `imageDimensions` are exported.

## Listing & metadata

```ts
function listMedia(bucket, base): Promise<MediaItem[]>;               // R2, newest-first
function mediaMetaByUrl(db, tableName, base, urls?): Promise<Map<string, MediaMeta>>;
```

`mediaMetaByUrl` loads asset-level `alt`/`caption`/dimensions from the registry,
keyed by public URL, so a render pass can fill an image's `alt` from its asset
default when no per-usage override is set. **Pass `urls`** (the images a page
actually needs) to scope the query to a bounded `IN (…)` lookup instead of a
full-table scan.

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
function cfImage(url, opts): string;                 // /cdn-cgi/image/… derivative
function circleImage(url, size): { src; srcset };    // square focal crop + 1x/2x
function cropStyle(crop): { objectPosition; transform; transformOrigin };
```

Pure URL rewriting against Cloudflare **Image Resizing** (per-request billing, no
new cost, no server processing). `cropStyle` maps a per-usage `{ x, y, scale }`
`Crop` to CSS. `isMediaUrl(base, value)` is the one definition of "media-backed"
the sanitizer, the sections validator, and the settings route enforce with.

## Types

`MediaItem`, `MediaMeta`, `MediaReference`, `MediaRefSource`, `Crop`,
`CfImageOptions`, `PutMediaResult`, `LouiseMediaEnv` (the `MEDIA` + `MEDIA_URL`
binding contract).
