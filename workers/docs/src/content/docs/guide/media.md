---
title: Media
description: Uploading images to R2 safely.
sidebar:
  order: 9
---

Louise's editor uploads images (paste, drop, or the toolbar button) to a media
endpoint you own — typically **R2**. That endpoint is the trust boundary, so it
does the validation Louise can't do from the client.

## The endpoint's job

A media endpoint should be **admin-gated** and enforce, at minimum:

- **A size cap** (e.g. 10 MB).
- **Content sniffing over trust.** Validate the _actual_ image bytes with a
  magic-number check rather than trusting the client's `Content-Type`. Store and
  serve the verified type — not the claimed one.
- **No SVG.** The bucket is a public domain; hosting arbitrary SVG/HTML is a
  content-injection risk. Accept raster formats only.

It returns the stored object's key and public URL, which the editor inserts as
an `<img>`:

```ts
// POST /api/louise/media  (your route)
export async function POST({ request, locals, env }) {
  if (!locals.editor) return new Response("Forbidden", { status: 403 });
  const file = await request.arrayBuffer();
  if (file.byteLength > 10 * 1024 * 1024) return new Response("Too large", { status: 413 });

  const type = sniffImageType(file); // magic-number sniff — reject if not a known raster type
  if (!type) return new Response("Unsupported media", { status: 415 });

  const key = `web/${crypto.randomUUID()}`;
  await env.MEDIA.put(key, file, { httpMetadata: { contentType: type } });
  return Response.json({ key, url: `${env.MEDIA_URL}/${key}` });
}
```

## Why Louise doesn't ship this route

The upload endpoint depends on _your_ bucket binding, _your_ key scheme, and
_your_ auth — all app-specific. Louise deliberately leaves it to you and instead
guarantees the editor side: uploads go through one endpoint, and the
[sanitizer](/guide/rich-text/) only lets `<img>` (with `width`/`height`)
into stored HTML.

## Strict media: every image from the library

By default the editor's image controls only produce a **media-hosted URL** — an
asset uploaded to R2 (your `MEDIA_URL` base), never an external hotlink. That
keeps images stable (no link rot, no hotlink breakage) and gives you one library
as the source of truth. Two things make it strict:

- **Every selector offers the library.** `ImageField` (drawer settings) and the
  section `image` control both pair an **Upload** button with a **Choose from
  media** picker over `/api/louise/media`. There's no free-form URL box — opt one
  back in per field with `ImageField`'s `allowUrl` if a site knowingly wants it.
- **The API is the enforcement point.** Pass your `MEDIA_URL` base and non-media
  values are rejected/stripped on write, so a forged request can't slip a hotlink
  past the UI:

  ```ts
  // sections — reject an image field that isn't a media asset (422)
  await assertValidSections(catalog, data.sections, { operation, mediaBase: env.MEDIA_URL });

  // settings — reject an external logo/favicon/share-image (422)
  settingsRoute({ table, resolveEditor, columns, imageKeys: ["logoUrl", "faviconUrl", "defaultOgImageUrl"], mediaBase: env.MEDIA_URL });

  // rich-text body — drop a pasted remote <img> (keeps media-hosted ones)
  sanitizeRichHtml(html, { mediaBase: env.MEDIA_URL });
  ```

Each `mediaBase` knob is optional and back-compatible: omit it and the old
behavior (any safe `http(s)`/relative image) is unchanged.
