---
title: Media
description: Uploading images to R2 safely.
sidebar:
  order: 7
---

Louise's editor uploads images (paste, drop, or the toolbar button) to a media
endpoint you own — typically **R2**. That endpoint is the trust boundary, so it
does the validation Louise can't do from the client.

## The endpoint's job

A media endpoint should be **admin-gated** and enforce, at minimum:

- **A size cap** (e.g. 10 MB).
- **Content sniffing over trust.** Validate the *actual* image bytes with a
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
  if (file.byteLength > 10 * 1024 * 1024)
    return new Response("Too large", { status: 413 });

  const type = sniffImageType(file); // magic-number sniff — reject if not a known raster type
  if (!type) return new Response("Unsupported media", { status: 415 });

  const key = `web/${crypto.randomUUID()}`;
  await env.MEDIA.put(key, file, { httpMetadata: { contentType: type } });
  return Response.json({ key, url: `${env.MEDIA_URL}/${key}` });
}
```

## Why Louise doesn't ship this route

The upload endpoint depends on *your* bucket binding, *your* key scheme, and
*your* auth — all app-specific. Louise deliberately leaves it to you and instead
guarantees the editor side: uploads go through one endpoint, and the
[sanitizer](/docs/guide/rich-text/) only lets `<img>` (with `width`/`height`)
into stored HTML.
